-- V123~V134 일정 DB가 적용된 프로젝트에 실행합니다.
BEGIN;
create or replace function public.staff_can_view_schedule() returns boolean language sql stable security invoker set search_path=public as $$
 select exists(select 1 from public.pjt_profiles where id=auth.uid() and approved and can_use_staff_portal)
$$;
create or replace function public.staff_can_view_all_schedule() returns boolean language sql stable security invoker set search_path=public as $$
 select exists(select 1 from public.pjt_profiles where id=auth.uid() and approved and can_use_staff_portal and (role='admin' or can_view_staff_schedule or can_edit_staff_schedule))
$$;
create or replace function public.staff_schedule_visible(p_inspectors text) returns boolean language sql stable security invoker set search_path=public as $$
 select exists(select 1 from public.pjt_profiles p where p.id=auth.uid() and p.approved and p.can_use_staff_portal and
 (p.role='admin' or p.can_view_staff_schedule or p.can_edit_staff_schedule or
 (nullif(trim(p.name),'') is not null and trim(p.name)=any(regexp_split_to_array(trim(coalesce(p_inspectors,'')),'[[:space:],/;·ㆍ、，()（）]+')))))
$$;
create or replace function public.staff_schedule_scope() returns jsonb language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null or not public.staff_can_view_schedule() then raise exception '승인된 직원만 점검일정을 조회할 수 있습니다.' using errcode='42501';end if;
 return (select jsonb_build_object('scope_version',135,'all',public.staff_can_view_all_schedule(),'name',coalesce(name,''),'user_id',id) from public.pjt_profiles where id=auth.uid());
end $$;
-- Restrictive policy protects against additional permissive read policies.
drop policy if exists schedule_read on public.staff_inspection_schedule;
create policy schedule_read on public.staff_inspection_schedule for select to authenticated using(public.staff_can_view_schedule());
drop policy if exists schedule_person_scope on public.staff_inspection_schedule;
create policy schedule_person_scope on public.staff_inspection_schedule as restrictive for select to authenticated using(public.staff_schedule_visible(inspectors));
create or replace function public.staff_schedule_list(p_year integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
 if auth.uid() is null or not public.staff_can_view_schedule() then raise exception '점검일정 조회 권한이 없습니다.' using errcode='42501';end if;
 if p_year is null or p_year not between 2000 and 2050 then raise exception '조회 연도는 2000~2050년입니다.';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.plan_start,x.source_id),'[]'::jsonb) into v_result from (
  select s.source_id,t.site_name,s.plan_start,s.plan_end,s.inspectors,s.updated_at
  from public.staff_inspection_schedule s join public.staff_site_source t on t.id=s.source_id
  where s.plan_start<=make_date(p_year,12,31) and s.plan_end>=make_date(p_year,1,1)
   and public.staff_schedule_visible(s.inspectors)
 ) x;return v_result;
end $$;
-- Recheck scope explicitly even if the owner or an older policy could bypass RLS.
create or replace function public.staff_schedule_get(p_source_id bigint) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null or not public.staff_can_view_schedule() then raise exception '점검일정 조회 권한이 없습니다.' using errcode='42501';end if;
 return (select jsonb_build_object('plan_start',s.plan_start,'plan_end',s.plan_end,'inspectors',s.inspectors) from public.staff_inspection_schedule s where s.source_id=p_source_id and public.staff_schedule_visible(s.inspectors));
end $$;
revoke all on function public.staff_can_view_all_schedule(),public.staff_schedule_visible(text),public.staff_schedule_scope(),public.staff_can_view_schedule(),public.staff_schedule_list(integer),public.staff_schedule_get(bigint) from public,anon;
grant execute on function public.staff_can_view_all_schedule(),public.staff_schedule_visible(text),public.staff_schedule_scope(),public.staff_can_view_schedule(),public.staff_schedule_list(integer),public.staff_schedule_get(bigint) to authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
