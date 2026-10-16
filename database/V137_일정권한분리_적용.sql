BEGIN;
create or replace function public.staff_can_view_all_schedule() returns boolean language sql stable security invoker set search_path=public as $$
 select exists(select 1 from public.pjt_profiles where id=auth.uid() and approved and can_use_staff_portal and (role='admin' or can_view_staff_schedule))
$$;
create or replace function public.staff_schedule_visible(p_inspectors text) returns boolean language sql stable security invoker set search_path=public as $$
 select exists(select 1 from public.pjt_profiles p where p.id=auth.uid() and p.approved and p.can_use_staff_portal and
 (p.role='admin' or p.can_view_staff_schedule or (nullif(trim(p.name),'') is not null and trim(p.name)=any(regexp_split_to_array(trim(coalesce(p_inspectors,'')),'[[:space:],/;·ㆍ、，()（）]+')))))
$$;
create or replace function public.staff_schedule_save(p_source_id bigint,p_start date,p_end date,p_inspectors text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_old text;v_exists boolean;
begin
 if auth.uid() is null or not public.staff_can_edit_schedule() then raise exception '점검일정 수정 권한이 없습니다.' using errcode='42501';end if;
 if p_start is null or p_end is null or p_end<p_start then raise exception '점검 계획 시작일·종료일을 확인하세요.';end if;
 perform 1 from public.staff_site_source where id=p_source_id for update;if not found then raise exception '등록할 현장을 찾을 수 없습니다.';end if;
 select inspectors into v_old from public.staff_inspection_schedule where source_id=p_source_id for update;v_exists:=found;
 if not public.staff_can_view_all_schedule() then
  if not public.staff_schedule_visible(p_inspectors) then raise exception '본인이 점검원인 일정만 저장할 수 있습니다.' using errcode='42501';end if;
  if v_exists then
   if not public.staff_schedule_visible(v_old) then raise exception '다른 직원의 일정은 수정할 수 없습니다.' using errcode='42501';end if;
  elsif not exists(select 1 from public.staff_site_source where id=p_source_id and public.staff_schedule_visible(field_inspector)) then
   raise exception '본인이 현장점검원인 현장만 등록할 수 있습니다.' using errcode='42501';
  end if;
 end if;
 insert into public.staff_inspection_schedule(source_id,plan_start,plan_end,inspectors,updated_by) values(p_source_id,p_start,p_end,trim(coalesce(p_inspectors,'')),auth.uid())
 on conflict(source_id) do update set plan_start=excluded.plan_start,plan_end=excluded.plan_end,inspectors=excluded.inspectors,updated_by=auth.uid(),updated_at=now();
 return jsonb_build_object('ok',true,'source_id',p_source_id);
end $$;
create or replace function public.staff_schedule_delete(p_source_id bigint) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_old text;
begin
 if auth.uid() is null or not public.staff_can_edit_schedule() then raise exception '점검일정 수정 권한이 없습니다.' using errcode='42501';end if;
 perform 1 from public.staff_site_source where id=p_source_id for update;
 select inspectors into v_old from public.staff_inspection_schedule where source_id=p_source_id for update;
 if found and not public.staff_schedule_visible(v_old) then raise exception '다른 직원의 일정은 삭제할 수 없습니다.' using errcode='42501';end if;
 delete from public.staff_inspection_schedule where source_id=p_source_id;return jsonb_build_object('ok',true);
end $$;
create or replace function public.staff_schedule_sites(p_query text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
 if auth.uid() is null or not public.staff_can_edit_schedule() then raise exception '점검일정 수정 권한이 없습니다.' using errcode='42501';end if;
 if length(trim(coalesce(p_query,'')))<1 then return '[]'::jsonb;end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_result from (
 select t.id as source_id,t.site_name,t.sn,coalesce(s.inspectors,t.field_inspector,'') as inspectors from public.staff_site_source t left join public.staff_inspection_schedule s on s.source_id=t.id
 where (position(lower(trim(p_query)) in lower(coalesce(t.site_name,'')))>0 or position(lower(trim(p_query)) in lower(coalesce(t.sn,'')))>0)
 and (public.staff_can_view_all_schedule() or (s.source_id is not null and public.staff_schedule_visible(s.inspectors)) or (s.source_id is null and public.staff_schedule_visible(t.field_inspector)))
 order by t.site_name,t.id limit 100) x;return v_result;
end $$;
revoke all on function public.staff_can_view_all_schedule(),public.staff_schedule_visible(text),public.staff_schedule_save(bigint,date,date,text),public.staff_schedule_delete(bigint),public.staff_schedule_sites(text) from public,anon;
grant execute on function public.staff_can_view_all_schedule(),public.staff_schedule_visible(text),public.staff_schedule_save(bigint,date,date,text),public.staff_schedule_delete(bigint),public.staff_schedule_sites(text) to authenticated;
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


revoke all on function public.staff_save_user_permissions(uuid,jsonb) from public,anon;
grant execute on function public.staff_save_user_permissions(uuid,jsonb) to authenticated;
create or replace function public.staff_schedule_scope() returns jsonb language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null or not public.staff_can_view_schedule() then raise exception '승인된 직원만 점검일정을 조회할 수 있습니다.' using errcode='42501';end if;
 return (select jsonb_build_object('scope_version',137,'all',public.staff_can_view_all_schedule(),'name',coalesce(name,''),'user_id',id) from public.pjt_profiles where id=auth.uid());
end $$;

NOTIFY pgrst,'reload schema';
COMMIT;
