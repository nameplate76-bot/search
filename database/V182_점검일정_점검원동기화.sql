-- V182: 일정 RPC의 기존 권한 검사를 유지하며 같은 트랜잭션에서 현장점검원을 동기화합니다.
BEGIN;
CREATE OR REPLACE FUNCTION public.staff_schedule_sync_site_inspector()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_name text:=trim(coalesce(NEW.inspectors,''));
BEGIN
 UPDATE public.staff_site_source SET
  field_inspector=nullif(v_name,''),
  full_values=CASE WHEN jsonb_typeof(full_values)='array' AND jsonb_array_length(full_values)>30
   THEN jsonb_set(full_values,'{30}',to_jsonb(v_name),false) ELSE full_values END,
  safe_values=CASE WHEN jsonb_typeof(safe_values)='array' AND jsonb_array_length(safe_values)>30
   THEN jsonb_set(safe_values,'{30}',to_jsonb(v_name),false) ELSE safe_values END,
  updated_at=now()
 WHERE id=NEW.source_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.staff_schedule_sync_site_inspector() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS staff_schedule_sync_site_inspector ON public.staff_inspection_schedule;
CREATE TRIGGER staff_schedule_sync_site_inspector
 AFTER INSERT OR UPDATE OF inspectors,plan_start,plan_end ON public.staff_inspection_schedule
 FOR EACH ROW EXECUTE FUNCTION public.staff_schedule_sync_site_inspector();
-- 삭제 시 계획 테이블의 날짜/달력 표시만 삭제. 현장 및 기록된 점검원/실제 점검 이력은 유지.
COMMIT;
