-- 같은 학교명(괄호 뒤 계약/점검정보 제외)에 관리주체 이메일을 함께 반영합니다.
-- 호출자의 기존 RLS 권한을 유지하고, 기존 등록 이메일을 일괄 변경하지 않습니다.
create or replace function public.staff_sync_school_email(p_source_id bigint,p_previous_email text,p_created boolean default false)
returns jsonb language plpgsql security invoker set search_path=public
as $fn$
declare
 v_source public.staff_site_source%rowtype;
 v_target record;
 v_base text;
 v_email text;
 v_contact text;
 v_matched integer:=0;
 v_updated integer:=0;
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 if not (public.staff_is_admin() or (p_created and public.staff_can_create_sites()) or (not p_created and public.staff_can_edit_sites())) then
   return jsonb_build_object('synced',false,'reason','email_permission','updated',0,'matched',0);
 end if;
 select * into v_source from public.staff_site_source where id=p_source_id for update;
 if not found then raise exception '이메일을 반영할 현장을 찾을 수 없습니다.'; end if;
 v_base:=public.staff_site_name_base(v_source.site_name);
 if position('학교' in v_base)=0 then
   return jsonb_build_object('synced',false,'reason','not_school','updated',0,'matched',0);
 end if;
 v_email:=trim(coalesce(v_source.client_email,''));
 if v_email='' or (not p_created and v_email=trim(coalesce(p_previous_email,''))) then
   return jsonb_build_object('synced',false,'reason','no_email_change','updated',0,'matched',0);
 end if;
 for v_target in
   select id,client_phone,client_email from public.staff_site_source
   where id<>p_source_id and public.staff_site_name_base(site_name)=v_base order by id for update
 loop
   v_matched:=v_matched+1;
   if v_target.client_email is distinct from v_email then
     v_contact:=trim(concat_ws(' ',nullif(v_target.client_phone,''),v_email));
     update public.staff_site_source set client_email=v_email,client_contact=v_contact,
       full_values=case when jsonb_typeof(full_values)='array' and jsonb_array_length(full_values)>42 then jsonb_set(full_values,'{42}',to_jsonb(v_contact),true) else full_values end,
       safe_values=case when jsonb_typeof(safe_values)='array' and jsonb_array_length(safe_values)>42 then jsonb_set(safe_values,'{42}',to_jsonb(v_contact),true) else safe_values end,
       updated_by=auth.uid(),updated_at=now() where id=v_target.id;
     v_updated:=v_updated+1;
   end if;
 end loop;
 return jsonb_build_object('synced',true,'base_name',v_base,'updated',v_updated,'matched',v_matched);
end;
$fn$;
revoke all on function public.staff_sync_school_email(bigint,text,boolean) from public,anon;
grant execute on function public.staff_sync_school_email(bigint,text,boolean) to authenticated,service_role;
