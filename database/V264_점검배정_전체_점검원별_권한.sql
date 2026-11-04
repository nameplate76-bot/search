BEGIN;
-- V264 점검배정 권한/현장 범위 적용
-- 기존 V235 권한 컬럼을 그대로 사용합니다.
-- can_view_all_staff_assignment: 전체 점검배정 (조회/수정/저장)
-- can_view_staff_assignment: 점검원별 점검배정 (본인 배정분 조회/계획등록)

DO $$ BEGIN
  IF to_regclass('public.pjt_profiles') IS NULL
     OR to_regclass('public.staff_site_source') IS NULL
     OR to_regclass('public.staff_inspection_schedule') IS NULL
     OR to_regprocedure('public.staff_can_view_assignment()') IS NULL
     OR to_regprocedure('public.staff_can_view_all_assignment()') IS NULL THEN
    RAISE EXCEPTION 'V235 점검배정 권한 분리 SQL을 먼저 적용하세요.';
  END IF;
END $$;

ALTER TABLE public.pjt_profiles
  ADD COLUMN IF NOT EXISTS can_view_staff_assignment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_all_staff_assignment boolean NOT NULL DEFAULT false;
UPDATE public.pjt_profiles
SET can_view_staff_assignment=true, can_view_all_staff_assignment=true
WHERE role='admin';

-- 전체 권한에는 모든 미등록 계획/미입력 점검원 행을 반환하고,
-- 점검원별 권한에는 로그인 사용자 이름이 배정된 행만 반환합니다.
CREATE OR REPLACE FUNCTION public.staff_schedule_assignment_rows()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_all boolean := false;
  v_name text;
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
  WHERE v_all OR (
    v_name IS NOT NULL AND v_name=ANY(regexp_split_to_array(
      btrim(coalesce(nullif(s.inspectors,''),t.field_inspector,'')),
      '[[:space:],/;·ㆍ、，()（）]+'
    ))
  );

  RETURN jsonb_build_object(
    'rows',v_result,'scope_all',v_all,'scope_name',coalesce(v_name,''),
    'scope_total',jsonb_array_length(v_result),
    'scope_missing',(SELECT count(*)
      FROM public.staff_site_source t
      LEFT JOIN public.staff_inspection_schedule s ON s.source_id=t.id
      WHERE (v_all OR (v_name IS NOT NULL AND v_name=ANY(regexp_split_to_array(
        btrim(coalesce(nullif(s.inspectors,''),t.field_inspector,'')),
        '[[:space:],/;·ㆍ、，()（）]+'
      ))))
      AND coalesce(s.plan_status,'')<>'완료'
      AND (s.plan_start IS NULL OR s.plan_end IS NULL OR
           nullif(btrim(coalesce(nullif(s.inspectors,''),t.field_inspector,'')),'') IS NULL)
    )
  );
END $$;

-- 배정 목록에서 계획 날짜 없이 점검원만 입력해 저장할 수 있게 합니다.
-- 점검원별 권한 사용자는 본인 이름이 기존 배정에 포함되고 저장 후에도 유지되어야 합니다.
CREATE OR REPLACE FUNCTION public.staff_assignment_plan_save(
  p_source_id bigint,
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL,
  p_inspectors text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_all boolean;
  v_name text;
  v_old_inspectors text;
  v_field_inspector text;
  v_final_names text := btrim(coalesce(p_inspectors,''));
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can_view_assignment() THEN
    RAISE EXCEPTION '점검배정 권한이 없습니다.' USING errcode='42501';
  END IF;
  v_all := public.staff_can_view_all_assignment();
  SELECT coalesce(nullif(btrim(p.name),''),p.user_id)
    INTO v_name FROM public.pjt_profiles p WHERE p.id=auth.uid();

  IF (p_start IS NULL) <> (p_end IS NULL) THEN
    RAISE EXCEPTION '점검 시작일과 종료일은 함께 입력하세요.';
  END IF;
  IF p_start IS NOT NULL AND p_end < p_start THEN
    RAISE EXCEPTION '점검 종료일은 시작일 이후여야 합니다.';
  END IF;
  IF p_start IS NULL AND nullif(v_final_names,'') IS NULL THEN
    RAISE EXCEPTION '계획 날짜 또는 점검원을 입력하세요.';
  END IF;

  SELECT t.field_inspector, s.inspectors
    INTO v_field_inspector,v_old_inspectors
    FROM public.staff_site_source t
    LEFT JOIN public.staff_inspection_schedule s ON s.source_id=t.id
    WHERE t.id=p_source_id
    FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION '현장을 찾을 수 없습니다.'; END IF;

  IF NOT v_all THEN
    IF v_name IS NULL OR NOT v_name=ANY(regexp_split_to_array(
         btrim(coalesce(nullif(v_old_inspectors,''),v_field_inspector,'')),
         '[[:space:],/;·ㆍ、，()（）]+'
       )) THEN
      RAISE EXCEPTION '점검원별 권한은 본인 이름으로 배정된 현장만 수정할 수 있습니다.' USING errcode='42501';
    END IF;
    IF NOT v_name=ANY(regexp_split_to_array(v_final_names,'[[:space:],/;·ㆍ、，()（）]+')) THEN
      RAISE EXCEPTION '저장할 점검원에 본인 이름을 포함하세요.' USING errcode='42501';
    END IF;
  END IF;

  INSERT INTO public.staff_inspection_schedule(source_id,plan_start,plan_end,inspectors,updated_by)
  VALUES(p_source_id,p_start,p_end,v_final_names,auth.uid())
  ON CONFLICT(source_id) DO UPDATE
    SET plan_start=excluded.plan_start,
        plan_end=excluded.plan_end,
        inspectors=excluded.inspectors,
        updated_by=auth.uid(),
        updated_at=now();

  RETURN jsonb_build_object('ok',true,'source_id',p_source_id,
    'plan_start',p_start,'plan_end',p_end,'inspectors',v_final_names);
END $$;

REVOKE ALL ON FUNCTION public.staff_schedule_assignment_rows() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_schedule_assignment_rows() TO authenticated;
REVOKE ALL ON FUNCTION public.staff_assignment_plan_save(bigint,date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_assignment_plan_save(bigint,date,date,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
