BEGIN;

-- '미점검'은 날짜가 아니므로 일정 상태로 보관하고 날짜 칸은 NULL로 둡니다.
ALTER TABLE public.staff_inspection_schedule
  DROP CONSTRAINT IF EXISTS staff_schedule_status_dates;
ALTER TABLE public.staff_inspection_schedule
  ADD CONSTRAINT staff_schedule_status_dates CHECK (
    (plan_status = '완료' AND plan_start IS NULL AND plan_end IS NULL)
    OR (plan_status = '미점검' AND plan_start IS NULL AND plan_end IS NULL)
    OR (plan_status = '' AND plan_start IS NULL AND plan_end IS NULL)
    OR (plan_status = '' AND plan_start IS NOT NULL AND plan_end IS NOT NULL
        AND plan_end >= plan_start
        AND plan_start >= DATE '2000-01-01'
        AND plan_end <= DATE '2050-12-31')
  );

-- 일정 수정/배정 권한을 가진 사용자가 미점검 상태를 등록합니다.
-- 계획일자 상태와 실제 시작·종료일자를 함께 동기화하고 기존 일정은 제거합니다.
CREATE OR REPLACE FUNCTION public.staff_schedule_mark_uninspected(
  p_source_id bigint,
  p_inspectors text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_schedule_edit boolean := false;
  v_assignment boolean := false;
  v_all boolean := false;
  v_name text;
  v_old_names text;
  v_names text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING errcode='42501';
  END IF;
  v_schedule_edit := public.staff_can_edit_schedule();
  v_assignment := public.staff_can_view_assignment();
  v_all := public.staff_can_view_all_assignment();
  IF NOT v_schedule_edit AND NOT v_assignment THEN
    RAISE EXCEPTION '점검일정 또는 점검배정 수정 권한이 필요합니다.' USING errcode='42501';
  END IF;

  SELECT coalesce(nullif(btrim(p.name),''),p.user_id)
    INTO v_name FROM public.pjt_profiles p WHERE p.id=auth.uid();
  SELECT coalesce(nullif(s.inspectors,''),t.field_inspector,''),t.field_inspector
    INTO v_old_names,v_names
    FROM public.staff_site_source t
    LEFT JOIN public.staff_inspection_schedule s ON s.source_id=t.id
    WHERE t.id=p_source_id
    FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION '현장을 찾을 수 없습니다.'; END IF;

  v_names := coalesce(nullif(btrim(p_inspectors),''),nullif(btrim(v_old_names),''),'');
  IF v_assignment AND NOT v_schedule_edit AND NOT v_all THEN
    IF v_name IS NULL OR NOT v_name=ANY(regexp_split_to_array(
      btrim(coalesce(v_old_names,'')),'[[:space:],/;·ㆍ、，()（）]+'
    )) THEN
      RAISE EXCEPTION '점검원별 권한은 본인에게 배정된 현장만 수정할 수 있습니다.' USING errcode='42501';
    END IF;
    IF NOT v_name=ANY(regexp_split_to_array(v_names,'[[:space:],/;·ㆍ、，()（）]+')) THEN
      RAISE EXCEPTION '저장할 점검원에 본인 이름을 포함하세요.' USING errcode='42501';
    END IF;
  END IF;

  UPDATE public.staff_site_source t
  SET field_plan_start='미점검',
      field_plan_end='미점검',
      field_end='미점검',
      field_inspector=v_names,
      full_values=jsonb_set(
        jsonb_set(jsonb_set(jsonb_set(coalesce(t.full_values,'[]'::jsonb),'{27}','"미점검"'::jsonb,true),'{28}','"미점검"'::jsonb,true),
          '{29}','"미점검"'::jsonb,true),'{30}',to_jsonb(v_names),true),
      safe_values=jsonb_set(
        jsonb_set(jsonb_set(jsonb_set(coalesce(t.safe_values,'[]'::jsonb),'{27}','"미점검"'::jsonb,true),'{28}','"미점검"'::jsonb,true),
          '{29}','"미점검"'::jsonb,true),'{30}',to_jsonb(v_names),true),
      updated_by=auth.uid(),updated_at=now()
  WHERE t.id=p_source_id;

  INSERT INTO public.staff_inspection_schedule(
    source_id,plan_start,plan_end,plan_status,inspectors,updated_by,updated_at
  ) VALUES (p_source_id,NULL,NULL,'미점검',v_names,auth.uid(),now())
  ON CONFLICT(source_id) DO UPDATE SET
    plan_start=NULL,plan_end=NULL,plan_status='미점검',inspectors=EXCLUDED.inspectors,
    updated_by=auth.uid(),updated_at=now();

  RETURN jsonb_build_object('ok',true,'source_id',p_source_id,'plan_status','미점검','inspectors',v_names);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_schedule_mark_uninspected(bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_schedule_mark_uninspected(bigint,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_site_plan_dates(p_source_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.pjt_profiles p
    WHERE p.id=auth.uid() AND p.approved AND p.can_use_staff_portal
  ) THEN
    RAISE EXCEPTION '승인된 포털 사용자만 계획일자를 조회할 수 있습니다.' USING errcode='42501';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'source_id',s.source_id,
      'plan_start',CASE WHEN s.plan_status IN ('완료','미점검') THEN s.plan_status ELSE s.plan_start::text END,
      'plan_end',CASE WHEN s.plan_status IN ('완료','미점검') THEN s.plan_status ELSE s.plan_end::text END,
      'plan_status',s.plan_status
    ) ORDER BY s.source_id),'[]'::jsonb)
    FROM public.staff_inspection_schedule s
    WHERE p_source_id IS NULL OR s.source_id=p_source_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.staff_site_plan_dates(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_site_plan_dates(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_schedule_list(p_year integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can_view_schedule() THEN
    RAISE EXCEPTION '점검일정 조회 권한이 없습니다.' USING errcode='42501';
  END IF;
  IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2050 THEN
    RAISE EXCEPTION '조회 연도는 2000~2050년입니다.';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.plan_start,x.source_id),'[]'::jsonb)
    INTO v_result
  FROM (
    SELECT s.source_id,t.site_name,s.plan_start,s.plan_end,s.inspectors,s.updated_at
    FROM public.staff_inspection_schedule s
    JOIN public.staff_site_source t ON t.id=s.source_id
    WHERE s.plan_status<>'미점검'
      AND coalesce(t.field_plan_start,'')<>'미점검'
      AND coalesce(t.field_plan_end,'')<>'미점검'
      AND coalesce(t.field_end,'')<>'미점검'
      AND s.plan_start<=make_date(p_year,12,31)
      AND s.plan_end>=make_date(p_year,1,1)
      AND public.staff_schedule_visible(s.inspectors)
  ) x;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_schedule_list(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_schedule_list(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_schedule_sites(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can_edit_schedule() THEN
    RAISE EXCEPTION '점검일정 수정 권한이 없습니다.' USING errcode='42501';
  END IF;
  IF length(trim(coalesce(p_query,'')))<1 THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_result
  FROM (
    SELECT t.id AS source_id,t.site_name,t.sn,coalesce(s.inspectors,t.field_inspector,'') AS inspectors
    FROM public.staff_site_source t
    LEFT JOIN public.staff_inspection_schedule s ON s.source_id=t.id
    WHERE (position(lower(trim(p_query)) in lower(coalesce(t.site_name,'')))>0
        OR position(lower(trim(p_query)) in lower(coalesce(t.sn,'')))>0)
      AND coalesce(s.plan_status,'')<>'미점검'
      AND coalesce(t.field_plan_start,'')<>'미점검'
      AND coalesce(t.field_plan_end,'')<>'미점검'
      AND coalesce(t.field_end,'')<>'미점검'
      AND (public.staff_can_view_all_schedule()
        OR (s.source_id IS NOT NULL AND public.staff_schedule_visible(s.inspectors))
        OR (s.source_id IS NULL AND public.staff_schedule_visible(t.field_inspector)))
    ORDER BY t.site_name,t.id LIMIT 100
  ) x;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_schedule_sites(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_schedule_sites(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_schedule_assignment_rows()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result jsonb; v_all boolean := false; v_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can_view_assignment() THEN
    RAISE EXCEPTION '점검배정 조회 권한이 없습니다.' USING errcode='42501';
  END IF;
  v_all := public.staff_can_view_all_assignment();
  SELECT coalesce(nullif(btrim(p.name),''),p.user_id)
    INTO v_name FROM public.pjt_profiles p WHERE p.id=auth.uid();

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'source_id',t.id,'site_name',t.site_name,'sn',t.sn,
    'plan_start',s.plan_start,'plan_end',s.plan_end,
    'plan_status',coalesce(s.plan_status,''),
    'inspectors',coalesce(nullif(s.inspectors,''),t.field_inspector,''),
    'field_inspector',coalesce(t.field_inspector,''),
    'field_plan_start',coalesce(t.field_plan_start,''),
    'field_plan_end',coalesce(t.field_plan_end,''),
    'report_complete_date',coalesce(t.report_complete_date,''),
    'performance_contract',coalesce(t.full_values->>9,''),
    'performance_plan_count',coalesce(t.full_values->>10,''),
    'maintenance_contract',coalesce(t.full_values->>11,''),
    'maintenance_plan_count',coalesce(t.full_values->>12,''),
    'manager_contract',coalesce(t.full_values->>13,''),
    'region',coalesce(t.region,''),
    'monthly_contract',coalesce(t.full_values->>14,''),
    'corporation',coalesce(t.full_values->>23,'')
  ) ORDER BY t.id),'[]'::jsonb)
  INTO v_result
  FROM public.staff_site_source t
  LEFT JOIN public.staff_inspection_schedule s ON s.source_id=t.id
  WHERE coalesce(s.plan_status,'')<>'미점검'
    AND coalesce(t.field_plan_start,'')<>'미점검'
    AND coalesce(t.field_plan_end,'')<>'미점검'
    AND coalesce(t.field_end,'')<>'미점검'
    AND (v_all OR (v_name IS NOT NULL AND v_name=ANY(regexp_split_to_array(
      btrim(coalesce(nullif(s.inspectors,''),t.field_inspector,'')),
      '[[:space:],/;·ㆍ、，()（）]+'
    ))));

  RETURN jsonb_build_object(
    'rows',v_result,'scope_all',v_all,'scope_name',coalesce(v_name,''),
    'scope_total',jsonb_array_length(v_result),
    'scope_missing',(SELECT count(*)
      FROM public.staff_site_source t
      LEFT JOIN public.staff_inspection_schedule s ON s.source_id=t.id
      WHERE coalesce(s.plan_status,'')<>'미점검'
        AND coalesce(t.field_plan_start,'')<>'미점검'
        AND coalesce(t.field_plan_end,'')<>'미점검'
        AND coalesce(t.field_end,'')<>'미점검'
        AND (v_all OR (v_name IS NOT NULL AND v_name=ANY(regexp_split_to_array(
          btrim(coalesce(nullif(s.inspectors,''),t.field_inspector,'')),
          '[[:space:],/;·ㆍ、，()（）]+'
        ))))
        AND coalesce(s.plan_status,'')<>'완료'
        AND (s.plan_start IS NULL OR s.plan_end IS NULL OR
             nullif(btrim(coalesce(nullif(s.inspectors,''),t.field_inspector,'')),'') IS NULL)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.staff_schedule_assignment_rows() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_schedule_assignment_rows() TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
