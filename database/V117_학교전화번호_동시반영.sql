-- V117: 기본정보 저장 시 같은 학교 일반전화번호만 원자적으로 반영합니다.
-- 기존 전화번호를 일괄 정리하지 않으며, 엑셀 가져오기에는 자동 동기화를 적용하지 않습니다.
create or replace function public.staff_school_phone_numbers(p_phone text)
returns text[] language sql immutable security invoker set search_path = public
as $fn$
 with matches as (
   select m[1] as raw, ord from regexp_matches(coalesce(p_phone,''),
     '(?<![0-9])((?:\+82[-.[:space:]]?0?|0)(?:1[016789]|2|[3-6][1-5]|70)[-.[:space:]]?[0-9]{3,4}[-.[:space:]]?[0-9]{4})(?![0-9])', 'g') with ordinality as r(m,ord)
 ), digits as (
   select ord, regexp_replace(raw,'[^0-9]','','g') as n from matches
 ), local_numbers as (
   select ord, case when n like '82%' then '0'||substring(n from 3) else n end as n from digits
 ), formatted as (
   select min(ord) as ord, case when n like '02%' then
     '02-'||substring(n from 3 for length(n)-6)||'-'||right(n,4)
     else left(n,3)||'-'||substring(n from 4 for length(n)-7)||'-'||right(n,4) end as phone
   from local_numbers where n ~ '^(02[0-9]{7,8}|01[016789][0-9]{7,8}|0[3-6][1-5][0-9]{7,8}|070[0-9]{8})$'
   group by n
 ) select coalesce(array_agg(phone order by ord),'{}'::text[]) from formatted;
$fn$;

create or replace function public.staff_school_phone_is_landline(p_phone text)
returns boolean language sql immutable security invoker set search_path = public
as $fn$
 select regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') ~
 '^(02[0-9]{7,8}|0(31|32|33|41|42|43|44|51|52|53|54|55|61|62|63|64)[0-9]{7,8}|070[0-9]{8})$';
$fn$;

create or replace function public.staff_sync_school_landline(p_source_id bigint, p_previous_phone text, p_created boolean default false)
returns jsonb language plpgsql security invoker set search_path = public
as $fn$
declare
 v_source public.staff_site_source%rowtype;
 v_target record;
 v_base text;
 v_lines text[];
 v_old_lines text[];
 v_numbers text[];
 v_other text[];
 v_phone text;
 v_contact text;
 v_matched integer := 0;
 v_updated integer := 0;
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 if not (public.staff_is_admin() or (p_created and public.staff_can_create_sites())) then
   return jsonb_build_object('synced',false,'reason','phone_permission','updated',0,'matched',0);
 end if;
 -- SECURITY INVOKER: 직접 호출해도 기존 테이블 RLS를 우회하지 않습니다.
 select * into v_source from public.staff_site_source where id=p_source_id for update;
 if not found then raise exception '전화번호를 반영할 현장을 찾을 수 없습니다.'; end if;
 v_base := public.staff_site_name_base(v_source.site_name);
 if position('학교' in v_base)=0 then
   return jsonb_build_object('synced',false,'reason','not_school','updated',0,'matched',0);
 end if;
 select coalesce(array_agg(n order by n),'{}'::text[]) into v_lines
 from unnest(public.staff_school_phone_numbers(v_source.client_phone)) n where public.staff_school_phone_is_landline(n);
 select coalesce(array_agg(n order by n),'{}'::text[]) into v_old_lines
 from unnest(public.staff_school_phone_numbers(p_previous_phone)) n where public.staff_school_phone_is_landline(n);
 if cardinality(v_lines)=0 or (not p_created and v_lines=v_old_lines) then
   return jsonb_build_object('synced',false,'reason','no_landline_change','updated',0,'matched',0);
 end if;
 for v_target in
   select id,client_phone,client_email,full_values,safe_values from public.staff_site_source
   where id<>p_source_id and public.staff_site_name_base(site_name)=v_base order by id for update
 loop
   v_matched:=v_matched+1;
   v_numbers:=public.staff_school_phone_numbers(v_target.client_phone);
   select coalesce(array_agg(n),'{}'::text[]) into v_other from unnest(v_numbers) n
   where not public.staff_school_phone_is_landline(n);
   v_phone:=array_to_string(v_lines||v_other,' / ');
   -- 해석하지 못하는 기존 연락처를 지우지 않습니다.
   if cardinality(v_numbers)=0 and trim(coalesce(v_target.client_phone,''))<>'' then
     v_phone:=v_phone||' / '||trim(v_target.client_phone);
   end if;
   v_contact:=trim(concat_ws(' ',nullif(v_phone,''),nullif(v_target.client_email,'')));
   if v_target.client_phone is distinct from v_phone then
     update public.staff_site_source set client_phone=v_phone,client_contact=v_contact,
       full_values=case when jsonb_typeof(full_values)='array' and jsonb_array_length(full_values)>42 then jsonb_set(full_values,'{42}',to_jsonb(v_contact),true) else full_values end,
       safe_values=case when jsonb_typeof(safe_values)='array' and jsonb_array_length(safe_values)>42 then jsonb_set(safe_values,'{42}',to_jsonb(v_contact),true) else safe_values end,
       updated_by=auth.uid(),updated_at=now()
     where id=v_target.id;
     v_updated:=v_updated+1;
   end if;
 end loop;
 return jsonb_build_object('synced',true,'updated',v_updated,'matched',v_matched,'base_name',v_base);
end;
$fn$;

create or replace function public.staff_update_site_contact(p_source_id bigint,p_phone text,p_email text,p_address text)
returns jsonb language plpgsql security invoker set search_path = public
as $fn$
declare
 v_old_phone text;
 v_phone text := array_to_string(public.staff_school_phone_numbers(p_phone),' / ');
 v_email text := trim(coalesce(p_email,''));
 v_address text := trim(coalesce(p_address,''));
 v_region text := public.staff_region_from_address(p_address);
 v_contact text;
 v_sync jsonb;
begin
 if auth.uid() is null or not public.staff_is_admin() then
   raise exception '관리자만 연락처를 수정할 수 있습니다.' using errcode='42501';
 end if;
 if v_address='' then raise exception '주소를 입력하세요.'; end if;
 select client_phone into v_old_phone from public.staff_site_source where id=p_source_id for update;
 if not found then raise exception '수정할 현장을 찾을 수 없습니다.'; end if;
 v_contact:=trim(concat_ws(' ',nullif(v_phone,''),nullif(v_email,'')));
 update public.staff_site_source set client_phone=nullif(v_phone,''),client_email=nullif(v_email,''),
   client_contact=v_contact,site_address=v_address,region=case when v_region<>'' then v_region else region end,
   full_values=case when jsonb_typeof(full_values)='array' and jsonb_array_length(full_values)>42 then jsonb_set(full_values,'{42}',to_jsonb(v_contact),true) else full_values end,
   safe_values=case when jsonb_typeof(safe_values)='array' and jsonb_array_length(safe_values)>42 then jsonb_set(safe_values,'{42}',to_jsonb(v_contact),true) else safe_values end,
   updated_by=auth.uid(),updated_at=now() where id=p_source_id;
 v_sync:=public.staff_sync_school_landline(p_source_id,v_old_phone,false);
 return jsonb_build_object('ok',true,'source_id',p_source_id,'school_phone',v_sync);
end;
$fn$;

revoke all on function public.staff_school_phone_numbers(text) from public,anon;
revoke all on function public.staff_school_phone_is_landline(text) from public,anon;
revoke all on function public.staff_sync_school_landline(bigint,text,boolean) from public,anon;
revoke all on function public.staff_update_site_contact(bigint,text,text,text) from public,anon;
grant execute on function public.staff_school_phone_numbers(text),public.staff_school_phone_is_landline(text),public.staff_sync_school_landline(bigint,text,boolean),public.staff_update_site_contact(bigint,text,text,text) to authenticated,service_role;
