-- V145: 승인된 포털 직원에게 계획일자만 공개. 달력/수정 RLS는 변경하지 않습니다.
begin;
create or replace function public.staff_site_plan_dates(p_source_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.pjt_profiles p where p.id=auth.uid() and p.approved and p.can_use_staff_portal) then
 raise exception '승인된 포털 사용자만 계획일자를 조회할 수 있습니다.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('source_id',s.source_id,'plan_start',s.plan_start,'plan_end',s.plan_end) order by s.source_id),'[]'::jsonb) from public.staff_inspection_schedule s where p_source_id is null or s.source_id=p_source_id);
end;$$;
revoke all on function public.staff_site_plan_dates(bigint) from public,anon;
grant execute on function public.staff_site_plan_dates(bigint) to authenticated;
commit;
