-- V223: 연차(종일)와 반차(오전/오후)를 분리하고 수정·삭제를 지원합니다.
begin;
alter table public.staff_inspection_leaves add column if not exists leave_type text not null default 'full';
update public.staff_inspection_leaves set leave_type='full' where leave_type is null or leave_type='';
alter table public.staff_inspection_leaves drop constraint if exists staff_inspection_leaves_type_check;
alter table public.staff_inspection_leaves drop constraint if exists staff_inspection_leaves_pkey;
alter table public.staff_inspection_leaves add constraint staff_inspection_leaves_type_check check (leave_type in ('full','am','pm'));
alter table public.staff_inspection_leaves add primary key (leave_date, inspector, leave_type);

create or replace function public.staff_schedule_leave_save(p_date date,p_inspector text,p_leave_type text default 'full') returns jsonb
language plpgsql security invoker set search_path=public as $$
declare v_name text:=trim(p_inspector); v_type text:=coalesce(nullif(trim(p_leave_type),'') ,'full');
begin
 if auth.uid() is null or not coalesce(public.staff_can_manage_leave(v_name),false) then raise exception '해당 점검원의 휴가를 등록할 권한이 없습니다.' using errcode='42501';end if;
 if p_date is null or p_date<date '2000-01-01' or p_date>date '2050-12-31' or v_name is null or length(v_name) not between 1 and 100 or v_type not in ('full','am','pm') then raise exception '날짜·점검원·휴가 유형을 확인하세요.';end if;
 insert into public.staff_inspection_leaves(leave_date,inspector,leave_type) values(p_date,v_name,v_type) on conflict (leave_date,inspector,leave_type) do nothing;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.staff_schedule_leave_delete(p_date date,p_inspector text,p_leave_type text default 'full') returns jsonb
language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null or not coalesce(public.staff_can_manage_leave(trim(p_inspector)),false) then raise exception '해당 점검원의 휴가를 삭제할 권한이 없습니다.' using errcode='42501';end if;
 delete from public.staff_inspection_leaves where leave_date=p_date and inspector=trim(p_inspector) and leave_type=coalesce(nullif(trim(p_leave_type),''),'full');
 return jsonb_build_object('ok',true,'deleted',found);
end $$;
revoke all on function public.staff_schedule_leave_save(date,text,text),public.staff_schedule_leave_delete(date,text,text) from public,anon;
grant execute on function public.staff_schedule_leave_save(date,text,text),public.staff_schedule_leave_delete(date,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
