-- V137 일정권한 분리 적용 상태에서 실행. 연락처는 조회만 제공합니다.
BEGIN;
create schema if not exists staff_schedule_private;
revoke all on schema staff_schedule_private from public,anon;
grant usage on schema staff_schedule_private to authenticated;
create or replace function staff_schedule_private.contact_detail(p_source_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
 if auth.uid() is null or not public.staff_can_view_schedule() then raise exception '승인된 직원만 일정 연락처를 조회할 수 있습니다.' using errcode='42501';end if;
 select jsonb_build_object('source_id',t.id,'site_name',coalesce(t.site_name,''),
 'client_manager',coalesce(t.client_manager,''),'client_phone',coalesce(t.client_phone,''),
 'client_email',coalesce(t.client_email,''),'site_address',coalesce(t.site_address,'')) into v_result
 from public.staff_site_source t where t.id=p_source_id and (
 public.staff_can_view_all_schedule() or
 exists(select 1 from public.staff_inspection_schedule s where s.source_id=t.id and public.staff_schedule_visible(s.inspectors)) or
 (public.staff_can_edit_schedule() and not exists(select 1 from public.staff_inspection_schedule s where s.source_id=t.id) and public.staff_schedule_visible(t.field_inspector))
 );
 if v_result is null then raise exception '이 현장의 일정 연락처를 조회할 권한이 없거나 현장이 없습니다.' using errcode='42501';end if;
 return v_result;
end $$;
revoke all on function staff_schedule_private.contact_detail(bigint) from public,anon;
grant execute on function staff_schedule_private.contact_detail(bigint) to authenticated;
create or replace function public.staff_schedule_contact(p_source_id bigint) returns jsonb
 language sql stable security invoker set search_path='' as $$select staff_schedule_private.contact_detail(p_source_id)$$;
revoke all on function public.staff_schedule_contact(bigint) from public,anon;
grant execute on function public.staff_schedule_contact(bigint) to authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
