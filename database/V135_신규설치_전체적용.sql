-- V123: 전화번호입력칸디자인 V121 기존 DB에서 실행. 기존 점검일/현장/보고서 연결값은 변경하지 않습니다.
BEGIN;
alter table public.pjt_profiles add column if not exists can_view_staff_schedule boolean not null default false;
alter table public.pjt_profiles add column if not exists can_edit_staff_schedule boolean not null default false;
update public.pjt_profiles set can_view_staff_schedule=true,can_edit_staff_schedule=true where role='admin';
create or replace function public.staff_can_view_schedule() returns boolean language sql stable security invoker set search_path=public as $$
 select exists(select 1 from public.pjt_profiles where id=auth.uid() and approved and can_use_staff_portal and (role='admin' or can_view_staff_schedule or can_edit_staff_schedule))
$$;
create or replace function public.staff_can_edit_schedule() returns boolean language sql stable security invoker set search_path=public as $$
 select exists(select 1 from public.pjt_profiles where id=auth.uid() and approved and can_use_staff_portal and (role='admin' or can_edit_staff_schedule))
$$;
revoke all on function public.staff_can_view_schedule(),public.staff_can_edit_schedule() from public,anon;
grant execute on function public.staff_can_view_schedule(),public.staff_can_edit_schedule() to authenticated;
create table if not exists public.staff_inspection_schedule (
 source_id bigint primary key references public.staff_site_source(id) on delete cascade,
 plan_start date not null,plan_end date not null,inspectors text not null default '',
 updated_at timestamptz not null default now(),updated_by uuid default auth.uid(),
 constraint staff_schedule_order check(plan_end>=plan_start),
 constraint staff_schedule_range check(plan_start>='2000-01-01' and plan_end<='2050-12-31'),
 constraint staff_schedule_inspectors_length check(length(inspectors)<=500)
);
create index if not exists staff_schedule_start_idx on public.staff_inspection_schedule(plan_start);
create index if not exists staff_schedule_end_idx on public.staff_inspection_schedule(plan_end);
alter table public.staff_inspection_schedule enable row level security;
revoke all on public.staff_inspection_schedule from public,anon,authenticated;
grant select on public.staff_inspection_schedule to authenticated;
drop policy if exists schedule_read on public.staff_inspection_schedule;
create policy schedule_read on public.staff_inspection_schedule for select to authenticated using(public.staff_can_view_schedule());
create table if not exists public.staff_inspection_holidays (
 holiday_date date primary key,name text not null check(length(name) between 1 and 100),is_holiday boolean not null default true,
 updated_at timestamptz not null default now(),updated_by uuid default auth.uid(),
 constraint staff_holiday_range check(holiday_date between '2000-01-01' and '2050-12-31')
);
alter table public.staff_inspection_holidays enable row level security;
revoke all on public.staff_inspection_holidays from public,anon,authenticated;
grant select on public.staff_inspection_holidays to authenticated;
drop policy if exists schedule_holidays_read on public.staff_inspection_holidays;
create policy schedule_holidays_read on public.staff_inspection_holidays for select to authenticated using(public.staff_can_view_schedule());
-- These guarded APIs intentionally expose only site name/inspector to schedule-only users,
-- without granting raw staff_site_source or financial data access.
create or replace function public.staff_schedule_sites(p_query text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
 if auth.uid() is null or not public.staff_can_edit_schedule() then raise exception '점검일정 수정 권한이 없습니다.' using errcode='42501'; end if;
 if length(trim(coalesce(p_query,'')))<1 then return '[]'::jsonb; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_result from (
  select id as source_id,site_name,sn,coalesce(field_inspector,'') as inspectors from public.staff_site_source
  where position(lower(trim(p_query)) in lower(coalesce(site_name,'')))>0 or position(lower(trim(p_query)) in lower(coalesce(sn,'')))>0
  order by site_name,id limit 100
 ) x;return v_result;
end $$;
create or replace function public.staff_schedule_list(p_year integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
 if auth.uid() is null or not public.staff_can_view_schedule() then raise exception '점검일정 조회 권한이 없습니다.' using errcode='42501'; end if;
 if p_year is null or p_year not between 2000 and 2050 then raise exception '조회 연도는 2000~2050년입니다.';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.plan_start,x.source_id),'[]'::jsonb) into v_result from (
 select s.source_id,t.site_name,s.plan_start,s.plan_end,s.inspectors,s.updated_at from public.staff_inspection_schedule s
 join public.staff_site_source t on t.id=s.source_id
 where s.plan_start<=make_date(p_year,12,31) and s.plan_end>=make_date(p_year,1,1)
 ) x;return v_result;
end $$;
create or replace function public.staff_schedule_save(p_source_id bigint,p_start date,p_end date,p_inspectors text) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.staff_can_edit_schedule() then raise exception '점검일정 수정 권한이 없습니다.' using errcode='42501';end if;
 if p_start is null or p_end is null or p_end<p_start then raise exception '점검 계획 시작일·종료일을 확인하세요.';end if;
 if not exists(select 1 from public.staff_site_source where id=p_source_id) then raise exception '등록할 현장을 찾을 수 없습니다.';end if;
 insert into public.staff_inspection_schedule(source_id,plan_start,plan_end,inspectors,updated_by)
 values(p_source_id,p_start,p_end,trim(coalesce(p_inspectors,'')),auth.uid())
 on conflict(source_id) do update set plan_start=excluded.plan_start,plan_end=excluded.plan_end,inspectors=excluded.inspectors,updated_by=auth.uid(),updated_at=now();
 return jsonb_build_object('ok',true,'source_id',p_source_id);
end $$;
create or replace function public.staff_schedule_delete(p_source_id bigint) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.staff_can_edit_schedule() then raise exception '점검일정 수정 권한이 없습니다.' using errcode='42501';end if;
 delete from public.staff_inspection_schedule where source_id=p_source_id;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.staff_schedule_holidays(p_year integer) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null or not public.staff_can_view_schedule() then raise exception '점검일정 조회 권한이 없습니다.' using errcode='42501';end if;
 if p_year is null or p_year not between 2000 and 2050 then raise exception '조회 연도는 2000~2050년입니다.';end if;
 return (select coalesce(jsonb_agg(to_jsonb(h) order by holiday_date),'[]'::jsonb) from public.staff_inspection_holidays h where holiday_date between make_date(p_year,1,1) and make_date(p_year,12,31));
end $$;
create or replace function public.staff_schedule_holiday_save(p_date date,p_name text,p_holiday boolean) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.staff_can_edit_schedule() then raise exception '점검일정 수정 권한이 없습니다.' using errcode='42501';end if;
 insert into public.staff_inspection_holidays(holiday_date,name,is_holiday,updated_by) values(p_date,trim(p_name),p_holiday,auth.uid())
 on conflict(holiday_date) do update set name=excluded.name,is_holiday=excluded.is_holiday,updated_at=now(),updated_by=auth.uid();
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.staff_schedule_sites(text),public.staff_schedule_list(integer),public.staff_schedule_save(bigint,date,date,text),public.staff_schedule_delete(bigint),public.staff_schedule_holidays(integer),public.staff_schedule_holiday_save(date,text,boolean) from public,anon;
grant execute on function public.staff_schedule_sites(text),public.staff_schedule_list(integer),public.staff_schedule_save(bigint,date,date,text),public.staff_schedule_delete(bigint),public.staff_schedule_holidays(integer),public.staff_schedule_holiday_save(date,text,boolean) to authenticated;
CREATE OR REPLACE FUNCTION public.staff_save_user_permissions(p_user_id uuid, p_permissions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_admin boolean := public.staff_is_admin();
  v_role text;
  v_approved boolean;
  v_portal boolean;
  v_view_sites boolean;
  v_create_sites boolean;
  v_edit_sites boolean;
  v_export_sites boolean;
  v_view_money boolean;
  v_create_money boolean;
  v_edit_money boolean;
  v_view_sales boolean;
  v_export_sales boolean;
  v_print_sales boolean;
  v_import_sites boolean;
  v_manage_users boolean;
  v_unwritten boolean;
  v_schedule_view boolean;
  v_schedule_edit boolean;
begin
  if not public.staff_can_manage_users() then
    raise exception '사용자 관리 권한이 없습니다.' using errcode='42501';
  end if;

  select role,approved,can_use_staff_portal,can_view_staff_sites,can_create_staff_sites,
         can_edit_staff_sites,can_export_staff_sites,can_view_money,can_create_money,can_edit_money,
         can_view_staff_sales,can_export_staff_sales,can_print_staff_sales,can_import_staff_sites,
         can_manage_staff_users
  into v_role,v_approved,v_portal,v_view_sites,v_create_sites,
       v_edit_sites,v_export_sites,v_view_money,v_create_money,v_edit_money,
       v_view_sales,v_export_sales,v_print_sales,v_import_sites,v_manage_users
  from public.pjt_profiles
  where id=p_user_id;

  if not found then raise exception '사용자를 찾을 수 없습니다.'; end if;

  if v_caller_admin then
    v_role := coalesce(nullif(p_permissions->>'role',''),v_role);
    if v_role not in ('admin','viewer') then v_role := 'viewer'; end if;
    v_approved := coalesce((p_permissions->>'approved')::boolean,v_approved);
    v_view_money := coalesce((p_permissions->>'can_view_money')::boolean,v_view_money);
    v_create_money := coalesce((p_permissions->>'can_create_money')::boolean,v_create_money);
    v_edit_money := coalesce((p_permissions->>'can_edit_money')::boolean,v_edit_money);
  end if;

  select can_view_staff_unwritten into v_unwritten from public.pjt_profiles where id=p_user_id;
  v_unwritten := coalesce((p_permissions->>'can_view_staff_unwritten')::boolean,v_unwritten);

  select can_view_staff_schedule,can_edit_staff_schedule into v_schedule_view,v_schedule_edit from public.pjt_profiles where id=p_user_id;
  v_schedule_view:=coalesce((p_permissions->>'can_view_staff_schedule')::boolean,v_schedule_view);
  v_schedule_edit:=coalesce((p_permissions->>'can_edit_staff_schedule')::boolean,v_schedule_edit);
  if v_schedule_edit then v_schedule_view:=true;end if;
  if v_schedule_view then v_portal:=true;end if;
  v_portal := coalesce((p_permissions->>'can_use_staff_portal')::boolean,v_portal);
  v_view_sites := coalesce((p_permissions->>'can_view_staff_sites')::boolean,v_view_sites);
  v_create_sites := coalesce((p_permissions->>'can_create_staff_sites')::boolean,v_create_sites);
  v_edit_sites := coalesce((p_permissions->>'can_edit_staff_sites')::boolean,v_edit_sites);
  v_export_sites := coalesce((p_permissions->>'can_export_staff_sites')::boolean,v_export_sites);
  v_view_sales := coalesce((p_permissions->>'can_view_staff_sales')::boolean,v_view_sales);
  v_export_sales := coalesce((p_permissions->>'can_export_staff_sales')::boolean,v_export_sales);
  v_print_sales := coalesce((p_permissions->>'can_print_staff_sales')::boolean,v_print_sales);
  v_import_sites := coalesce((p_permissions->>'can_import_staff_sites')::boolean,v_import_sites);
  v_manage_users := coalesce((p_permissions->>'can_manage_staff_users')::boolean,v_manage_users);

  if v_role='admin' then
    v_schedule_view:=true; v_schedule_edit:=true; v_unwritten:=true; v_approved:=true; v_portal:=true; v_view_sites:=true; v_create_sites:=true; v_edit_sites:=true;
    v_export_sites:=true; v_view_money:=true; v_create_money:=true; v_edit_money:=true;
    v_view_sales:=true; v_export_sales:=true; v_print_sales:=true; v_import_sites:=true; v_manage_users:=true;
  else
    if v_create_money then v_view_money:=true; v_create_sites:=true; end if;
    if v_edit_money then v_view_money:=true; v_edit_sites:=true; end if;
    if v_view_money then v_view_sites:=true; end if;
    if v_create_sites or v_edit_sites or v_export_sites or v_import_sites then v_view_sites:=true; end if;

    if not v_view_sites then
      v_create_sites:=false; v_edit_sites:=false; v_export_sites:=false; v_import_sites:=false;
      v_view_money:=false; v_create_money:=false; v_edit_money:=false;
    end if;
    if not v_create_sites then v_create_money:=false; end if;
    if not v_edit_sites then v_edit_money:=false; end if;

    if v_export_sales or v_print_sales then v_view_sales:=true; end if;
    if not v_view_sales then v_export_sales:=false; v_print_sales:=false; end if;
    if v_view_sites or v_view_sales or v_manage_users or v_unwritten or v_schedule_view or v_schedule_edit then v_portal:=true; end if;
  end if;

  update public.pjt_profiles
  set can_view_staff_schedule=v_schedule_view,can_edit_staff_schedule=v_schedule_edit,can_view_staff_unwritten=v_unwritten,role=v_role,approved=v_approved,can_use_staff_portal=v_portal,
      can_view_staff_sites=v_view_sites,can_create_staff_sites=v_create_sites,
      can_edit_staff_sites=v_edit_sites,can_export_staff_sites=v_export_sites,
      can_view_money=v_view_money,can_create_money=v_create_money,can_edit_money=v_edit_money,
      can_view_staff_sales=v_view_sales,can_export_staff_sales=v_export_sales,
      can_print_staff_sales=v_print_sales,can_import_staff_sites=v_import_sites,
      can_manage_staff_users=v_manage_users,updated_at=now()
  where id=p_user_id;

  return jsonb_build_object(
    'can_view_staff_schedule',v_schedule_view,'can_edit_staff_schedule',v_schedule_edit,'can_view_staff_unwritten',v_unwritten,'ok',true,'id',p_user_id,'role',v_role,'approved',v_approved,
    'can_use_staff_portal',v_portal,'can_view_staff_sites',v_view_sites,
    'can_create_staff_sites',v_create_sites,'can_edit_staff_sites',v_edit_sites,
    'can_export_staff_sites',v_export_sites,'can_view_money',v_view_money,
    'can_create_money',v_create_money,'can_edit_money',v_edit_money,
    'can_view_staff_sales',v_view_sales,'can_export_staff_sales',v_export_sales,
    'can_print_staff_sales',v_print_sales,'can_import_staff_sites',v_import_sites,
    'can_manage_staff_users',v_manage_users
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.staff_user_admin_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows jsonb;
begin
  if not public.staff_can_manage_users() then
    raise exception '사용자 관리 권한이 없습니다.' using errcode='42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'can_view_staff_schedule',p.can_view_staff_schedule,'can_edit_staff_schedule',p.can_edit_staff_schedule,
        'can_view_staff_unwritten',p.can_view_staff_unwritten,
        'id',p.id,
        'name',p.name,
        'user_id',p.user_id,
        'phone',p.phone,
        'role',p.role,
        'approved',p.approved,
        'can_use_staff_portal',p.can_use_staff_portal,
        'can_view_staff_sites',p.can_view_staff_sites,
        'can_create_staff_sites',p.can_create_staff_sites,
        'can_edit_staff_sites',p.can_edit_staff_sites,
        'can_export_staff_sites',p.can_export_staff_sites,
        'can_view_money',p.can_view_money,
        'can_create_money',p.can_create_money,
        'can_edit_money',p.can_edit_money,
        'can_view_staff_sales',p.can_view_staff_sales,
        'can_export_staff_sales',p.can_export_staff_sales,
        'can_print_staff_sales',p.can_print_staff_sales,
        'can_import_staff_sites',p.can_import_staff_sites,
        'can_manage_staff_users',p.can_manage_staff_users
      )
      order by coalesce(p.name,''),coalesce(p.user_id,'')
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.pjt_profiles p;

  return v_rows;
end;
$function$;


revoke all on function public.staff_save_user_permissions(uuid,jsonb),public.staff_user_admin_list() from public,anon;
grant execute on function public.staff_save_user_permissions(uuid,jsonb),public.staff_user_admin_list() to authenticated;
-- Shared plan API. Uses the same schedule table as the calendar.
create or replace function public.staff_schedule_get(p_source_id bigint) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null or not public.staff_can_view_schedule() then raise exception '점검일정 조회 권한이 없습니다.' using errcode='42501';end if;
 return (select jsonb_build_object('plan_start',s.plan_start,'plan_end',s.plan_end,'inspectors',s.inspectors) from public.staff_inspection_schedule s where source_id=p_source_id);
end $$;
create or replace function public.staff_update_site_with_schedule(p_source_id bigint,p_data jsonb,p_start date,p_end date,p_inspectors text) returns bigint language plpgsql security invoker set search_path=public as $$
declare v_id bigint;
begin
 if auth.uid() is null or not public.staff_can_edit_schedule() or not public.staff_can_edit_sites() then raise exception '현장 수정 및 점검일정 수정 권한이 필요합니다.' using errcode='42501';end if;
 if (p_start is null)<>(p_end is null) or p_end<p_start then raise exception '점검 계획 시작일·종료일을 확인하세요.';end if;
 v_id:=public.staff_update_site(p_source_id,p_data);
 if p_start is null then perform public.staff_schedule_delete(v_id);else perform public.staff_schedule_save(v_id,p_start,p_end,p_inspectors);end if;
 return v_id;
end $$;
create or replace function public.staff_create_site_with_schedule(p_data jsonb,p_start date,p_end date,p_inspectors text) returns bigint language plpgsql security invoker set search_path=public as $$
declare v_id bigint;
begin
 if auth.uid() is null or not public.staff_can_edit_schedule() or not public.staff_can_create_sites() then raise exception '현장 등록 및 점검일정 수정 권한이 필요합니다.' using errcode='42501';end if;
 if (p_start is null)<>(p_end is null) or p_end<p_start then raise exception '점검 계획 시작일·종료일을 확인하세요.';end if;
 v_id:=public.staff_create_site(p_data);
 if p_start is not null then perform public.staff_schedule_save(v_id,p_start,p_end,p_inspectors);end if;
 return v_id;
end $$;
revoke all on function public.staff_schedule_get(bigint),public.staff_update_site_with_schedule(bigint,jsonb,date,date,text),public.staff_create_site_with_schedule(jsonb,date,date,text) from public,anon;
grant execute on function public.staff_schedule_get(bigint),public.staff_update_site_with_schedule(bigint,jsonb,date,date,text),public.staff_create_site_with_schedule(jsonb,date,date,text) to authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;

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
