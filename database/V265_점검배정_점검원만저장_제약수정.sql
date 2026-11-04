BEGIN;
-- V265: 계획 날짜 없이 점검원만 저장할 수 있도록 상태/날짜 CHECK 제약을 확장합니다.
-- 기존 유효 상태(미등록 계획: 빈 상태 + 두 날짜 NULL, 완료: 완료 + 두 날짜 NULL,
-- 계획 입력: 빈 상태 + 두 날짜 입력)를 모두 명시적으로 허용합니다.
DO $$ BEGIN
  IF to_regclass('public.staff_inspection_schedule') IS NULL
     OR to_regprocedure('public.staff_assignment_plan_save(bigint,date,date,text)') IS NULL THEN
    RAISE EXCEPTION '점검배정 기능(V264) SQL을 먼저 적용하세요.';
  END IF;
END $$;

ALTER TABLE public.staff_inspection_schedule
  DROP CONSTRAINT IF EXISTS staff_schedule_status_dates;
ALTER TABLE public.staff_inspection_schedule
  ADD CONSTRAINT staff_schedule_status_dates CHECK (
    (plan_status = '완료' AND plan_start IS NULL AND plan_end IS NULL)
    OR
    (plan_status = '' AND plan_start IS NULL AND plan_end IS NULL)
    OR
    (plan_status = '' AND plan_start IS NOT NULL AND plan_end IS NOT NULL
      AND plan_end >= plan_start
      AND plan_start >= DATE '2000-01-01'
      AND plan_end <= DATE '2050-12-31')
  );

-- 날짜가 없을 때에도 plan_status를 빈 문자열로 명시해 기본값/트리거 변경에 의존하지 않습니다.
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

  INSERT INTO public.staff_inspection_schedule(
    source_id,plan_start,plan_end,plan_status,inspectors,updated_by
  ) VALUES (
    p_source_id,p_start,p_end,'',v_final_names,auth.uid()
  )
  ON CONFLICT(source_id) DO UPDATE
    SET plan_start=excluded.plan_start,
        plan_end=excluded.plan_end,
        plan_status='',
        inspectors=excluded.inspectors,
        updated_by=auth.uid(),
        updated_at=now();

  RETURN jsonb_build_object('ok',true,'source_id',p_source_id,
    'plan_start',p_start,'plan_end',p_end,'plan_status','',
    'inspectors',v_final_names);
END $$;

REVOKE ALL ON FUNCTION public.staff_assignment_plan_save(bigint,date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_assignment_plan_save(bigint,date,date,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
