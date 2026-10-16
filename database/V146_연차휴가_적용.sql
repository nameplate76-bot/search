-- V145 및 V137 권한 분리 적용 후 실행. 기존 일정/공휴일 자료는 변경하지 않습니다.
BEGIN;
create table if not exists public.staff_inspection_leaves (
 leave_date date not null check(leave_date between date '2000-01-01' and date '2050-12-31'),
 inspector text not null check(length(trim(inspector)) between 1 and 100 and inspector=trim(inspector)),
 primary key(leave_date,inspector)
);
alter table public.staff_inspection_leaves enable row level security;
revoke all on public.staff_inspection_leaves from public,anon,authenticated;
grant select,insert,delete on public.staff_inspection_leaves to authenticated;

-- 본인 연차는 직접 등록/취소. 다른 직원의 연차는 전체조회+일정수정 권한 필요.
create or replace function public.staff_can_manage_leave(p_inspector text) returns boolean
 language sql stable security invoker set search_path=public as $$
 select auth.uid() is not null and public.staff_can_view_schedule() and
 ((public.staff_can_view_all_schedule() and public.staff_can_edit_schedule()) or
 exists(select 1 from public.pjt_profiles where id=auth.uid() and approved and can_use_staff_portal
 and nullif(trim(name),'')=p_inspector))
$$;
revoke all on function public.staff_can_manage_leave(text) from public,anon;
grant execute on function public.staff_can_manage_leave(text) to authenticated;
drop policy if exists leave_read on public.staff_inspection_leaves;
drop policy if exists leave_insert on public.staff_inspection_leaves;
drop policy if exists leave_delete on public.staff_inspection_leaves;
create policy leave_read on public.staff_inspection_leaves for select to authenticated
 using(public.staff_can_view_schedule() and public.staff_schedule_visible(inspector));
create policy leave_insert on public.staff_inspection_leaves for insert to authenticated
 with check(public.staff_can_manage_leave(inspector));
create policy leave_delete on public.staff_inspection_leaves for delete to authenticated
 using(public.staff_can_manage_leave(inspector));

create or replace function public.staff_schedule_leaves(p_year integer) returns jsonb
 language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null or not public.staff_can_view_schedule() then raise exception '승인된 직원만 연차 휴가를 조회할 수 있습니다.' using errcode='42501';end if;
 if p_year is null or p_year<2000 or p_year>2050 then raise exception '조회 연도를 확인하세요.';end if;
 return (select coalesce(jsonb_agg(to_jsonb(t) order by t.leave_date,t.inspector),'[]'::jsonb)
 from public.staff_inspection_leaves t where leave_date>=make_date(p_year,1,1) and leave_date<make_date(p_year+1,1,1));
end $$;
create or replace function public.staff_schedule_leave_save(p_date date,p_inspector text) returns jsonb
 language plpgsql security invoker set search_path=public as $$
declare v_name text:=trim(p_inspector);
begin
 if auth.uid() is null or not coalesce(public.staff_can_manage_leave(v_name),false) then raise exception '해당 점검원의 연차 휴가를 등록할 권한이 없습니다.' using errcode='42501';end if;
 if p_date is null or p_date<date '2000-01-01' or p_date>date '2050-12-31' or v_name is null or length(v_name) not between 1 and 100 then raise exception '날짜와 점검원 이름을 확인하세요.';end if;
 insert into public.staff_inspection_leaves(leave_date,inspector) values(p_date,v_name) on conflict do nothing;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.staff_schedule_leave_delete(p_date date,p_inspector text) returns jsonb
 language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null or not coalesce(public.staff_can_manage_leave(trim(p_inspector)),false) then raise exception '해당 점검원의 연차 휴가를 취소할 권한이 없습니다.' using errcode='42501';end if;
 delete from public.staff_inspection_leaves where leave_date=p_date and inspector=trim(p_inspector);
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.staff_schedule_leaves(integer),public.staff_schedule_leave_save(date,text),public.staff_schedule_leave_delete(date,text) from public,anon;
grant execute on function public.staff_schedule_leaves(integer),public.staff_schedule_leave_save(date,text),public.staff_schedule_leave_delete(date,text) to authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
