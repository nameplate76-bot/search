-- 실제 점검일자(legacy source fields)와 점검계획(staff_inspection_schedule)을 분리합니다.
-- 실제일자 삭제가 DB 일정 트리거에 의해 복원되지 않도록 합니다.
-- 계획을 수정할 때 실제일자가 이전 계획과 동일한 경우에만 실제일자도 함께 변경합니다.
BEGIN;

CREATE OR REPLACE FUNCTION public.staff_schedule_sync_site_inspector()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_name text := btrim(coalesce(NEW.inspectors,''));
  v_start text := '';
  v_end text := '';
  v_old_start text := '';
  v_old_end text := '';
  v_current_start text := '';
  v_current_end text := '';
  v_next_start text := '';
  v_next_end text := '';
  v_current_inspector text := '';
BEGIN
  IF NEW.plan_status = '미점검' THEN
    v_start := '미점검';
    v_end := '미점검';
  ELSIF NEW.plan_status = '완료' THEN
    -- 완료 상태로 바뀌어도 기록된 실제일자 값은 그대로 보존합니다.
    v_start := NULL;
    v_end := NULL;
  ELSE
    v_start := coalesce(NEW.plan_start::text,'');
    v_end := coalesce(NEW.plan_end::text,'');
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.plan_status = '미점검' THEN
      v_old_start := '미점검'; v_old_end := '미점검';
    ELSE
      v_old_start := coalesce(OLD.plan_start::text,'');
      v_old_end := coalesce(OLD.plan_end::text,'');
    END IF;
  END IF;

  SELECT coalesce(field_plan_start,''),coalesce(field_plan_end,''),coalesce(field_inspector,'')
    INTO v_current_start,v_current_end,v_current_inspector
    FROM public.staff_site_source WHERE id=NEW.source_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_next_start := v_current_start;
  v_next_end := v_current_end;
  -- 실제일자가 이전 계획일을 그대로 반영 중일 때만 계획 변경을 따라갑니다.
  -- 공란은 직접 삭제했을 수 있으므로 INSERT/UPDATE 어느 경우에도 자동 입력하지 않습니다.
  IF NEW.plan_status <> '완료' AND TG_OP='UPDATE' AND v_old_start<>'' AND
     v_current_start IS NOT DISTINCT FROM v_old_start THEN
    v_next_start := coalesce(v_start,'');
  END IF;
  IF NEW.plan_status <> '완료' AND TG_OP='UPDATE' AND v_old_end<>'' AND
     v_current_end IS NOT DISTINCT FROM v_old_end THEN
    v_next_end := coalesce(v_end,'');
  END IF;

  UPDATE public.staff_site_source SET
    field_inspector = nullif(v_name,''),
    field_plan_start = nullif(v_next_start,''),
    field_plan_end = nullif(v_next_end,''),
    full_values = CASE
      WHEN jsonb_typeof(full_values)='array' AND jsonb_array_length(full_values)>30 THEN
        jsonb_set(jsonb_set(jsonb_set(full_values,'{27}',to_jsonb(v_next_start),true),'{28}',to_jsonb(v_next_end),true),'{30}',to_jsonb(v_name),true)
      ELSE full_values END,
    safe_values = CASE
      WHEN jsonb_typeof(safe_values)='array' AND jsonb_array_length(safe_values)>30 THEN
        jsonb_set(jsonb_set(jsonb_set(safe_values,'{27}',to_jsonb(v_next_start),true),'{28}',to_jsonb(v_next_end),true),'{30}',to_jsonb(v_name),true)
      ELSE safe_values END,
    updated_by = coalesce(auth.uid(),updated_by),
    updated_at = now()
  WHERE id=NEW.source_id
    AND (field_inspector IS DISTINCT FROM nullif(v_name,'')
      OR field_plan_start IS DISTINCT FROM nullif(v_next_start,'')
      OR field_plan_end IS DISTINCT FROM nullif(v_next_end,'')
      OR (jsonb_typeof(full_values)='array' AND jsonb_array_length(full_values)>30 AND
          (full_values->>27 IS DISTINCT FROM v_next_start OR full_values->>28 IS DISTINCT FROM v_next_end OR full_values->>30 IS DISTINCT FROM v_name))
      OR (jsonb_typeof(safe_values)='array' AND jsonb_array_length(safe_values)>30 AND
          (safe_values->>27 IS DISTINCT FROM v_next_start OR safe_values->>28 IS DISTINCT FROM v_next_end OR safe_values->>30 IS DISTINCT FROM v_name)));
  RETURN NEW;
END
$function$;

-- 삭제 시에는 이전 계획일자와 아직 같은 값만 지웁니다. 별도로 수정한 실제일자는 보존합니다.
CREATE OR REPLACE FUNCTION public.staff_schedule_clear_site_plan_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_old_start text;
  v_old_end text;
BEGIN
  IF OLD.plan_status='완료' OR coalesce(btrim((SELECT report_complete_date FROM public.staff_site_source WHERE id=OLD.source_id)), '')<>'' THEN
    RETURN OLD;
  END IF;
  IF OLD.plan_status='미점검' THEN
    v_old_start := '미점검'; v_old_end := '미점검';
  ELSE
    v_old_start := coalesce(OLD.plan_start::text,'');
    v_old_end := coalesce(OLD.plan_end::text,'');
  END IF;
  UPDATE public.staff_site_source SET
    field_plan_start = CASE WHEN coalesce(field_plan_start,'')=v_old_start THEN NULL ELSE field_plan_start END,
    field_plan_end = CASE WHEN coalesce(field_plan_end,'')=v_old_end THEN NULL ELSE field_plan_end END,
    full_values = CASE WHEN jsonb_typeof(full_values)='array' AND jsonb_array_length(full_values)>28
      THEN jsonb_set(jsonb_set(full_values,'{27}',to_jsonb(CASE WHEN coalesce(field_plan_start,'')=v_old_start THEN '' ELSE coalesce(field_plan_start,'') END),true),'{28}',to_jsonb(CASE WHEN coalesce(field_plan_end,'')=v_old_end THEN '' ELSE coalesce(field_plan_end,'') END),true) ELSE full_values END,
    safe_values = CASE WHEN jsonb_typeof(safe_values)='array' AND jsonb_array_length(safe_values)>28
      THEN jsonb_set(jsonb_set(safe_values,'{27}',to_jsonb(CASE WHEN coalesce(field_plan_start,'')=v_old_start THEN '' ELSE coalesce(field_plan_start,'') END),true),'{28}',to_jsonb(CASE WHEN coalesce(field_plan_end,'')=v_old_end THEN '' ELSE coalesce(field_plan_end,'') END),true) ELSE safe_values END,
    updated_by = coalesce(auth.uid(),updated_by),
    updated_at = now()
  WHERE id=OLD.source_id
    AND (coalesce(field_plan_start,'')=v_old_start OR coalesce(field_plan_end,'')=v_old_end);
  RETURN OLD;
END
$function$;

-- 현장 원본의 실제일자 입력/삭제는 계획 테이블에 전파하지 않습니다.
-- 점검원 변경만 일정과 양방향 동기화합니다.
CREATE OR REPLACE FUNCTION public.staff_site_sync_schedule_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_name text := btrim(coalesce(NEW.field_inspector,''));
BEGIN
  INSERT INTO public.staff_inspection_schedule
    (source_id,plan_start,plan_end,plan_status,inspectors,updated_by,updated_at)
  VALUES (NEW.id,NULL,NULL,'',v_name,coalesce(auth.uid(),NEW.updated_by),now())
  ON CONFLICT(source_id) DO UPDATE SET
    inspectors=EXCLUDED.inspectors,
    updated_by=EXCLUDED.updated_by,
    updated_at=now()
  WHERE public.staff_inspection_schedule.inspectors IS DISTINCT FROM EXCLUDED.inspectors;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.staff_schedule_clear_site_plan_on_delete() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.staff_site_sync_schedule_plan() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS staff_site_sync_schedule_plan ON public.staff_site_source;
CREATE TRIGGER staff_site_sync_schedule_plan
AFTER UPDATE OF field_inspector ON public.staff_site_source
FOR EACH ROW WHEN (OLD.field_inspector IS DISTINCT FROM NEW.field_inspector)
EXECUTE FUNCTION public.staff_site_sync_schedule_plan();

COMMIT;
