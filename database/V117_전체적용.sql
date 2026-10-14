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


CREATE OR REPLACE FUNCTION public.staff_create_site(p_data jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_money boolean := public.staff_can_create_money();
  v_values jsonb := coalesce(p_data->'values','[]'::jsonb);
  v_full jsonb;
  v_safe jsonb;
  v_id bigint;
  v_site_name text;
  v_doc_raw text;
  v_owner text;
  v_year integer;
  v_month integer;
begin
  if not public.staff_can_create_sites() then
    raise exception '현장 직접등록 권한이 없습니다.' using errcode='42501';
  end if;

  select jsonb_agg(
    case when i between 45 and 51 and not v_money then 'null'::jsonb
         else coalesce(v_values->i,'null'::jsonb) end order by i
  )
  into v_full
  from generate_series(0,136) s(i);

  v_full:=public.staff_apply_site_business_rules(v_full,p_data->>'site_address');
  v_full:=jsonb_set(v_full,'{42}',to_jsonb(trim(concat_ws(' ',nullif(p_data->>'client_phone',''),nullif(p_data->>'client_email','')))),true);

  select jsonb_agg(
    case when i between 45 and 51 then 'null'::jsonb
         else coalesce(v_full->i,'null'::jsonb) end order by i
  )
  into v_safe
  from generate_series(0,136) s(i);

  v_site_name:=nullif(trim(v_full->>3),'');
  if v_site_name is null then raise exception '현장명을 입력하세요.'; end if;

  v_doc_raw:=coalesce(v_full->>18,'');
  v_owner:=trim(regexp_replace(v_doc_raw,'^(20[0-9]{2}|[0-9]{2})\s*',''));
  if v_owner='' then v_owner:=v_doc_raw; end if;
  if v_doc_raw ~ '^20[0-9]{2}' then v_year:=substring(v_doc_raw from 1 for 4)::int;
  elsif v_doc_raw ~ '^[0-9]{2}' then v_year:=2000+substring(v_doc_raw from 1 for 2)::int; end if;
  if coalesce(v_full->>20,'') ~ '^[0-9]{1,2}$' then v_month:=(v_full->>20)::int;
  elsif coalesce(v_full->>19,'') ~ '^[0-9]{1,2}$' then v_month:=(v_full->>19)::int; end if;
  if v_month not between 1 and 12 then v_month:=null; end if;

  insert into public.staff_site_source(
    excel_row,source_file,sn,site_name,previous_name,report_grade,region,area,households,approval_date,inspection_stage,
    document_owner_raw,document_owner,document_progress_month,document_complete_month,field_plan_start,field_plan_end,field_end,field_inspector,
    report_complete_date,report_status,sales_manager,client_manager,client_contact,contract_start,contract_end,
    performance_amount,maintenance_amount,manager_amount,contract_amount,sales_amount,binding_cost,binding_ratio,sales_year,sales_month,
    full_values,safe_values,imported_by,import_token,client_phone,client_email,site_address,manual_entry,created_by,updated_by,updated_at
  ) values (
    -(nextval('public.staff_manual_row_seq')::int),'직접등록',
    nullif(v_full->>0,''),v_site_name,nullif(v_full->>4,''),nullif(v_full->>1,''),nullif(v_full->>16,''),
    case when replace(coalesce(v_full->>5,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>5,',','')::numeric else null end,
    nullif(v_full->>6,''),nullif(v_full->>7,''),nullif(v_full->>8,''),v_doc_raw,v_owner,nullif(v_full->>19,''),nullif(v_full->>20,''),
    nullif(v_full->>27,''),nullif(v_full->>28,''),nullif(v_full->>29,''),nullif(v_full->>30,''),nullif(v_full->>31,''),nullif(v_full->>32,''),
    nullif(v_full->>40,''),nullif(v_full->>41,''),trim(concat_ws(' ',nullif(p_data->>'client_phone',''),nullif(p_data->>'client_email',''))),
    nullif(v_full->>43,''),nullif(v_full->>44,''),
    case when replace(coalesce(v_full->>45,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>45,',','')::numeric else null end,
    case when replace(coalesce(v_full->>46,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>46,',','')::numeric else null end,
    case when replace(coalesce(v_full->>47,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>47,',','')::numeric else null end,
    case when replace(coalesce(v_full->>48,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>48,',','')::numeric else null end,
    case when replace(coalesce(v_full->>49,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>49,',','')::numeric else null end,
    case when replace(coalesce(v_full->>50,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>50,',','')::numeric else null end,
    case when replace(coalesce(v_full->>51,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>51,',','')::numeric else null end,
    v_year,v_month,v_full,v_safe,auth.uid(),nullif(p_data->>'import_token','')::uuid,
    nullif(p_data->>'client_phone',''),nullif(p_data->>'client_email',''),nullif(p_data->>'site_address',''),
    true,auth.uid(),auth.uid(),now()
  ) returning id into v_id;

  perform public.staff_sync_school_landline(v_id,null,true);
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.staff_update_site(p_source_id bigint, p_data jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_money boolean := public.staff_can_edit_money();
  v_admin boolean := public.staff_is_admin();
  v_values jsonb := coalesce(p_data->'values','[]'::jsonb);
  v_old jsonb;
  v_old_phone text;
  v_full jsonb;
  v_safe jsonb;
  v_site_name text;
  v_doc_raw text;
  v_owner text;
  v_year integer;
  v_month integer;
begin
  if not public.staff_can_edit_sites() then
    raise exception '현장 수정 권한이 없습니다.' using errcode='42501';
  end if;

  select full_values,client_phone into v_old,v_old_phone from public.staff_site_source where id=p_source_id for update;
  if v_old is null then raise exception '수정할 현장을 찾을 수 없습니다.'; end if;

  select jsonb_agg(
    case when i between 45 and 51 and not v_money then coalesce(v_old->i,'null'::jsonb)
         else coalesce(v_values->i,v_old->i,'null'::jsonb) end order by i
  )
  into v_full
  from generate_series(0,136) s(i);

  v_full:=public.staff_apply_site_business_rules(v_full,p_data->>'site_address');
  v_full:=jsonb_set(v_full,'{42}',to_jsonb(trim(concat_ws(' ',case when v_admin then nullif(p_data->>'client_phone','') else nullif(v_old_phone,'') end,nullif(p_data->>'client_email','')))),true);

  select jsonb_agg(
    case when i between 45 and 51 then 'null'::jsonb
         else coalesce(v_full->i,'null'::jsonb) end order by i
  )
  into v_safe
  from generate_series(0,136) s(i);

  v_site_name:=nullif(trim(v_full->>3),'');
  if v_site_name is null then raise exception '현장명을 입력하세요.'; end if;

  v_doc_raw:=coalesce(v_full->>18,'');
  v_owner:=trim(regexp_replace(v_doc_raw,'^(20[0-9]{2}|[0-9]{2})\s*',''));
  if v_owner='' then v_owner:=v_doc_raw; end if;
  if v_doc_raw ~ '^20[0-9]{2}' then v_year:=substring(v_doc_raw from 1 for 4)::int;
  elsif v_doc_raw ~ '^[0-9]{2}' then v_year:=2000+substring(v_doc_raw from 1 for 2)::int; end if;
  if coalesce(v_full->>20,'') ~ '^[0-9]{1,2}$' then v_month:=(v_full->>20)::int;
  elsif coalesce(v_full->>19,'') ~ '^[0-9]{1,2}$' then v_month:=(v_full->>19)::int; end if;
  if v_month not between 1 and 12 then v_month:=null; end if;

  update public.staff_site_source set
    sn=nullif(v_full->>0,''),site_name=v_site_name,previous_name=nullif(v_full->>4,''),report_grade=nullif(v_full->>1,''),region=nullif(v_full->>16,''),
    area=case when replace(coalesce(v_full->>5,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>5,',','')::numeric else null end,
    households=nullif(v_full->>6,''),approval_date=nullif(v_full->>7,''),inspection_stage=nullif(v_full->>8,''),document_owner_raw=v_doc_raw,document_owner=v_owner,
    document_progress_month=nullif(v_full->>19,''),document_complete_month=nullif(v_full->>20,''),field_plan_start=nullif(v_full->>27,''),field_plan_end=nullif(v_full->>28,''),field_end=nullif(v_full->>29,''),field_inspector=nullif(v_full->>30,''),report_complete_date=nullif(v_full->>31,''),report_status=nullif(v_full->>32,''),sales_manager=nullif(v_full->>40,''),client_manager=nullif(v_full->>41,''),
    client_contact=trim(concat_ws(' ',case when v_admin then nullif(p_data->>'client_phone','') else client_phone end,nullif(p_data->>'client_email',''))),contract_start=nullif(v_full->>43,''),contract_end=nullif(v_full->>44,''),
    performance_amount=case when replace(coalesce(v_full->>45,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>45,',','')::numeric else null end,
    maintenance_amount=case when replace(coalesce(v_full->>46,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>46,',','')::numeric else null end,
    manager_amount=case when replace(coalesce(v_full->>47,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>47,',','')::numeric else null end,
    contract_amount=case when replace(coalesce(v_full->>48,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>48,',','')::numeric else null end,
    sales_amount=case when replace(coalesce(v_full->>49,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>49,',','')::numeric else null end,
    binding_cost=case when replace(coalesce(v_full->>50,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>50,',','')::numeric else null end,
    binding_ratio=case when replace(coalesce(v_full->>51,''),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(v_full->>51,',','')::numeric else null end,
    sales_year=v_year,sales_month=v_month,full_values=v_full,safe_values=v_safe,
    client_phone=case when v_admin then nullif(p_data->>'client_phone','') else client_phone end,
    client_email=nullif(p_data->>'client_email',''),site_address=nullif(p_data->>'site_address',''),
    updated_by=auth.uid(),updated_at=now()
  where id=p_source_id;

  perform public.staff_sync_school_landline(p_source_id,v_old_phone,false);
  return p_source_id;
end;
$function$
;
