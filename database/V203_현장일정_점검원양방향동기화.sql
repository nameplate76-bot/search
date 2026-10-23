-- V203: 기존 저장 RPC의 권한 검사를 유지하고 같은 저장 트랜잭션에서 점검원을 양방향 반영합니다.
BEGIN;
CREATE OR REPLACE FUNCTION public.staff_schedule_sync_site_inspector()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_name text:=trim(coalesce(NEW.inspectors,''));
BEGIN
 UPDATE public.staff_site_source SET
  field_inspector=nullif(v_name,''),
  full_values=CASE WHEN jsonb_typeof(full_values)='array' AND jsonb_array_length(full_values)>30 THEN jsonb_set(full_values,'{30}',to_jsonb(v_name),false) ELSE full_values END,
  safe_values=CASE WHEN jsonb_typeof(safe_values)='array' AND jsonb_array_length(safe_values)>30 THEN jsonb_set(safe_values,'{30}',to_jsonb(v_name),false) ELSE safe_values END,
  updated_at=now()
 WHERE id=NEW.source_id AND (field_inspector IS DISTINCT FROM nullif(v_name,'')
  OR (jsonb_typeof(full_values)='array' AND jsonb_array_length(full_values)>30 AND full_values->>30 IS DISTINCT FROM v_name)
  OR (jsonb_typeof(safe_values)='array' AND jsonb_array_length(safe_values)>30 AND safe_values->>30 IS DISTINCT FROM v_name));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.staff_schedule_sync_site_inspector() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS staff_schedule_sync_site_inspector ON public.staff_inspection_schedule;
CREATE TRIGGER staff_schedule_sync_site_inspector AFTER INSERT OR UPDATE OF inspectors,plan_start,plan_end ON public.staff_inspection_schedule FOR EACH ROW EXECUTE FUNCTION public.staff_schedule_sync_site_inspector();

CREATE OR REPLACE FUNCTION public.staff_site_sync_schedule_inspector()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_name text:=trim(coalesce(NEW.field_inspector,''));
BEGIN
 -- 계획일은 변경하지 않고, 일정이 없는 현장의 일정을 새로 만들지 않습니다.
 UPDATE public.staff_inspection_schedule SET inspectors=v_name,updated_at=now()
 WHERE source_id=NEW.id AND inspectors IS DISTINCT FROM v_name;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.staff_site_sync_schedule_inspector() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS staff_site_sync_schedule_inspector ON public.staff_site_source;
CREATE TRIGGER staff_site_sync_schedule_inspector AFTER UPDATE OF field_inspector ON public.staff_site_source FOR EACH ROW
 WHEN (OLD.field_inspector IS DISTINCT FROM NEW.field_inspector)
 EXECUTE FUNCTION public.staff_site_sync_schedule_inspector();

-- 기존 달력 점검원 공란만 복구합니다. 이미 입력된 달력 담당자와 계획일·실적·금액은 보존합니다.
WITH source_names AS (
 SELECT id,coalesce(nullif(trim(field_inspector),''),nullif(trim(full_values->>30),''),nullif(trim(safe_values->>30),'')) AS name
 FROM public.staff_site_source
)
UPDATE public.staff_inspection_schedule s SET inspectors=n.name,updated_at=now()
 FROM source_names n WHERE n.id=s.source_id AND nullif(trim(s.inspectors),'') IS NULL AND n.name IS NOT NULL;
COMMIT;
-- 현장에는 점검원이 있으나 일정은 공란인 잔여 건수: 정상 적용 후 0건.
SELECT count(*) AS remaining_blank_inspector_count
FROM public.staff_inspection_schedule s JOIN public.staff_site_source t ON t.id=s.source_id
WHERE nullif(trim(s.inspectors),'') IS NULL AND coalesce(nullif(trim(t.field_inspector),''),nullif(trim(t.full_values->>30),''),nullif(trim(t.safe_values->>30),'')) IS NOT NULL;
