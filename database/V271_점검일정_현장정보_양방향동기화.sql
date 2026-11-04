-- 점검일정(직원 일정 테이블) 저장 내용을 현장 원본 열과 검색/보고 데이터에도 즉시 반영합니다.
-- 점검원 동기화 동작은 유지하며 계획 시작·종료일도 동기화합니다.
BEGIN;
CREATE OR REPLACE FUNCTION public.staff_schedule_sync_site_inspector()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_name text;
  v_start text;
  v_end text;
BEGIN
  v_name := btrim(coalesce(NEW.inspectors,''));
  IF NEW.plan_status = '미점검' THEN
    v_start := '미점검';
    v_end := '미점검';
  ELSE
    v_start := coalesce(NEW.plan_start::text,'');
    v_end := coalesce(NEW.plan_end::text,'');
  END IF;

  UPDATE public.staff_site_source SET
    field_inspector = nullif(v_name,''),
    field_plan_start = nullif(v_start,''),
    field_plan_end = nullif(v_end,''),
    full_values = CASE
      WHEN jsonb_typeof(full_values)='array' AND jsonb_array_length(full_values)>30 THEN
        jsonb_set(jsonb_set(jsonb_set(full_values,'{27}',to_jsonb(v_start),true),'{28}',to_jsonb(v_end),true),'{30}',to_jsonb(v_name),true)
      ELSE full_values END,
    safe_values = CASE
      WHEN jsonb_typeof(safe_values)='array' AND jsonb_array_length(safe_values)>30 THEN
        jsonb_set(jsonb_set(jsonb_set(safe_values,'{27}',to_jsonb(v_start),true),'{28}',to_jsonb(v_end),true),'{30}',to_jsonb(v_name),true)
      ELSE safe_values END,
    updated_by = coalesce(auth.uid(),updated_by),
    updated_at = now()
  WHERE id=NEW.source_id
    AND (field_inspector IS DISTINCT FROM nullif(v_name,'')
      OR field_plan_start IS DISTINCT FROM nullif(v_start,'')
      OR field_plan_end IS DISTINCT FROM nullif(v_end,'')
      OR (jsonb_typeof(full_values)='array' AND jsonb_array_length(full_values)>30 AND
          (full_values->>27 IS DISTINCT FROM v_start OR full_values->>28 IS DISTINCT FROM v_end OR full_values->>30 IS DISTINCT FROM v_name))
      OR (jsonb_typeof(safe_values)='array' AND jsonb_array_length(safe_values)>30 AND
          (safe_values->>27 IS DISTINCT FROM v_start OR safe_values->>28 IS DISTINCT FROM v_end OR safe_values->>30 IS DISTINCT FROM v_name)));
  RETURN NEW;
END
$function$;

-- 일정 삭제 시 미완료 현장의 현장 원본 계획일자도 비웁니다.
-- 보고서 완료일이 있는 과거 완료 현장의 이력값은 보존합니다.
CREATE OR REPLACE FUNCTION public.staff_schedule_clear_site_plan_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.staff_site_source SET
    field_plan_start = NULL,
    field_plan_end = NULL,
    full_values = CASE WHEN jsonb_typeof(full_values)='array' AND jsonb_array_length(full_values)>28
      THEN jsonb_set(jsonb_set(full_values,'{27}','""'::jsonb,true),'{28}','""'::jsonb,true) ELSE full_values END,
    safe_values = CASE WHEN jsonb_typeof(safe_values)='array' AND jsonb_array_length(safe_values)>28
      THEN jsonb_set(jsonb_set(safe_values,'{27}','""'::jsonb,true),'{28}','""'::jsonb,true) ELSE safe_values END,
    updated_by = coalesce(auth.uid(),updated_by),
    updated_at = now()
  WHERE id=OLD.source_id AND coalesce(btrim(report_complete_date),'')='';
  RETURN OLD;
END
$function$;

DROP TRIGGER IF EXISTS staff_schedule_clear_site_plan_on_delete ON public.staff_inspection_schedule;
CREATE TRIGGER staff_schedule_clear_site_plan_on_delete
AFTER DELETE ON public.staff_inspection_schedule
FOR EACH ROW EXECUTE FUNCTION public.staff_schedule_clear_site_plan_on_delete();

REVOKE ALL ON FUNCTION public.staff_schedule_clear_site_plan_on_delete() FROM PUBLIC, anon, authenticated;

-- 현장 정보 수정 및 엑셀 갱신에서 현장 원본 계획일자를 바꾸면
-- 기존 일정도 같은 트랜잭션에서 갱신합니다. 일정이 없는 현장에 유효한
-- 계획일이 입력되면 일정을 생성해 달력/배정 화면과 일치시킵니다.
CREATE OR REPLACE FUNCTION public.staff_site_sync_schedule_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_start_raw text := btrim(coalesce(NEW.field_plan_start,''));
  v_end_raw text := btrim(coalesce(NEW.field_plan_end,''));
  v_start date;
  v_end date;
  v_status text := '';
  v_inspectors text := btrim(coalesce(NEW.field_inspector,''));
BEGIN
  -- 담당자만 바뀐 경우에는 이미 저장된 계획일을 보존합니다.
  IF OLD.field_plan_start IS NOT DISTINCT FROM NEW.field_plan_start
     AND OLD.field_plan_end IS NOT DISTINCT FROM NEW.field_plan_end THEN
    INSERT INTO public.staff_inspection_schedule
      (source_id,plan_start,plan_end,plan_status,inspectors,updated_by,updated_at)
    VALUES (NEW.id,NULL,NULL,'',v_inspectors,coalesce(auth.uid(),NEW.updated_by),now())
    ON CONFLICT(source_id) DO UPDATE SET
      inspectors=EXCLUDED.inspectors,
      updated_by=EXCLUDED.updated_by,
      updated_at=now()
    WHERE public.staff_inspection_schedule.inspectors IS DISTINCT FROM EXCLUDED.inspectors;
    RETURN NEW;
  END IF;

  IF v_start_raw='미점검' OR v_end_raw='미점검' THEN
    v_status := '미점검';
  ELSIF (v_start_raw='완료' AND v_end_raw='완료')
     OR (v_start_raw='' AND v_end_raw='' AND btrim(coalesce(NEW.report_complete_date,''))<>'') THEN
    v_status := '완료';
  ELSE
    v_start := public.staff_assignment_parse_date(v_start_raw);
    v_end := public.staff_assignment_parse_date(v_end_raw);
    IF v_start IS NULL OR v_end IS NULL OR v_end<v_start
       OR v_start<date '2000-01-01' OR v_end>date '2050-12-31' THEN
      v_start := NULL;
      v_end := NULL;
    END IF;
  END IF;

  IF v_start IS NULL AND v_end IS NULL AND v_status='' AND v_start_raw='' AND v_end_raw='' THEN
    DELETE FROM public.staff_inspection_schedule
      WHERE source_id=NEW.id AND plan_status<>'완료';
  ELSE
    INSERT INTO public.staff_inspection_schedule
      (source_id,plan_start,plan_end,plan_status,inspectors,updated_by,updated_at)
    VALUES
      (NEW.id,v_start,v_end,v_status,v_inspectors,coalesce(auth.uid(),NEW.updated_by),now())
    ON CONFLICT(source_id) DO UPDATE SET
      plan_start=EXCLUDED.plan_start,
      plan_end=EXCLUDED.plan_end,
      plan_status=EXCLUDED.plan_status,
      inspectors=EXCLUDED.inspectors,
      updated_by=EXCLUDED.updated_by,
      updated_at=now()
    WHERE public.staff_inspection_schedule.plan_start IS DISTINCT FROM EXCLUDED.plan_start
       OR public.staff_inspection_schedule.plan_end IS DISTINCT FROM EXCLUDED.plan_end
       OR public.staff_inspection_schedule.plan_status IS DISTINCT FROM EXCLUDED.plan_status
       OR public.staff_inspection_schedule.inspectors IS DISTINCT FROM EXCLUDED.inspectors;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.staff_site_sync_schedule_plan() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS staff_site_sync_schedule_plan ON public.staff_site_source;
CREATE TRIGGER staff_site_sync_schedule_plan
AFTER UPDATE OF field_plan_start,field_plan_end,field_inspector ON public.staff_site_source
FOR EACH ROW
WHEN (OLD.field_plan_start IS DISTINCT FROM NEW.field_plan_start
   OR OLD.field_plan_end IS DISTINCT FROM NEW.field_plan_end
   OR OLD.field_inspector IS DISTINCT FROM NEW.field_inspector)
EXECUTE FUNCTION public.staff_site_sync_schedule_plan();
COMMIT;
