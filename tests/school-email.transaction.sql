-- BEGIN 안에서 실행 후 반드시 ROLLBACK 합니다. 실제 등록 자료를 변경하지 않는 검증입니다.
insert into public.staff_site_source(id,excel_row,site_name,client_phone,client_email,client_contact,site_address,full_values,safe_values)
select id,id::integer,name,phone,email,trim(concat_ws(' ',phone,email)),'경기도 안산시 상록구 검증로 1',
 jsonb_set(jsonb_set(a,'{3}',to_jsonb(name)),'{42}',to_jsonb(trim(concat_ws(' ',phone,email)))),
 jsonb_set(jsonb_set(a,'{3}',to_jsonb(name)),'{42}',to_jsonb(trim(concat_ws(' ',phone,email))))
from (values
 (-118001::bigint,'V118검증학교(26년 전반기)','031-111-1234 / 010-1111-1234',null::text),
 (-118002::bigint,'V118검증학교（25년 후반기）','031-222-1234 / 010-2222-1234','old@example.com'),
 (-118003::bigint,'V118검증학교별관(26년)','031-333-1234','different@example.com'),
 (-118004::bigint,'V118검증사무실(26년)','02-111-1234','office@example.com'),
 (-118005::bigint,'V118검증사무실(25년)','02-222-1234','office2@example.com')
) t(id,name,phone,email)
cross join (select jsonb_agg(''::text) as a from generate_series(0,136)) vals;
select set_config('request.jwt.claim.sub',(select id::text from public.pjt_profiles where role='admin' and approved and can_use_staff_portal order by id limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
set local role authenticated;
do $test$
declare r jsonb; v jsonb; created_id bigint;
begin
 -- 일반전화가 그대로인 상태에서 이메일만 최초 등록합니다.
 r:=public.staff_update_site_contact(-118001,'031-111-1234 / 010-1111-1234','new@example.com','경기도 안산시 상록구 검증로 1');
 if (r#>>'{school_email,updated}')::int<>1 or (r#>>'{school_email,matched}')::int<>1 then raise exception '이메일 최초 등록 동기화 누락: %',r; end if;
 if (select client_email from public.staff_site_source where id=-118002)<>'new@example.com' then raise exception '관련 학교 이메일 수정 누락'; end if;
 if (select client_phone from public.staff_site_source where id=-118002)<>'031-222-1234 / 010-2222-1234' then raise exception '이메일 수정으로 전화번호 변경'; end if;
 if (select client_email from public.staff_site_source where id=-118003)<>'different@example.com' then raise exception '다른 학교 이메일 변경'; end if;
 if (select client_email from public.staff_site_search where source_id=-118002)<>'new@example.com'
   or (select safe_values->>42 from public.staff_site_search where source_id=-118002)<>'031-222-1234 / 010-2222-1234 new@example.com'
   or (select full_values->>42 from public.staff_site_source where id=-118002)<>'031-222-1234 / 010-2222-1234 new@example.com' then raise exception '검색/엑셀 이메일 반영 누락'; end if;
 -- 이메일을 변경하지 않은 일반전화 수정은 관련 현장의 다른 이메일을 보존합니다.
 update public.staff_site_source set client_email='preserve@example.com' where id=-118002;
 r:=public.staff_update_site_contact(-118001,'031-999-1234 / 010-1111-1234','new@example.com','경기도 안산시 상록구 검증로 1');
 if (r#>>'{school_email,synced}')::boolean or (select client_email from public.staff_site_source where id=-118002)<>'preserve@example.com' then raise exception '변경되지 않은 이메일까지 일괄 반영'; end if;
 if (select client_phone from public.staff_site_source where id=-118002)<>'031-999-1234 / 010-2222-1234' then raise exception '기존 일반전화 동기화 기능 누락'; end if;
 r:=public.staff_update_site_contact(-118001,'031-999-1234 / 010-1111-1234','changed@example.com','경기도 안산시 상록구 검증로 1');
 if (select client_email from public.staff_site_source where id=-118002)<>'changed@example.com' then raise exception '이메일 변경 동기화 누락'; end if;
 r:=public.staff_update_site_contact(-118001,'031-999-1234 / 010-1111-1234','','경기도 안산시 상록구 검증로 1');
 if (r#>>'{school_email,synced}')::boolean or (select client_email from public.staff_site_source where id=-118002)<>'changed@example.com' then raise exception '공란 입력으로 다른 현장 이메일 삭제'; end if;
 r:=public.staff_update_site_contact(-118004,'02-111-1234','office-new@example.com','경기도 안산시 상록구 검증로 1');
 if (select client_email from public.staff_site_source where id=-118005)<>'office2@example.com' then raise exception '학교 외 현장 동기화'; end if;
 -- 기본정보 수정과 신규등록 저장 경로를 검증합니다.
 select full_values into v from public.staff_site_source where id=-118001;
 perform public.staff_update_site(-118001,jsonb_build_object('values',v,'client_phone','031-999-1234 / 010-1111-1234','client_email','edit@example.com','site_address','경기도 안산시 상록구 검증로 1'));
 if (select client_email from public.staff_site_source where id=-118002)<>'edit@example.com' then raise exception '기본정보 수정 동기화 누락'; end if;
 v:=jsonb_set(v,'{3}',to_jsonb('V118검증학교(27년 신규)'::text));
 created_id:=public.staff_create_site(jsonb_build_object('values',v,'client_phone','010-9999-1234','client_email','create@example.com','site_address','경기도 안산시 상록구 검증로 1'));
 if (select client_email from public.staff_site_source where id=-118002)<>'create@example.com' then raise exception '신규등록 이메일 동기화 누락'; end if;
 if (select client_phone from public.staff_site_source where id=-118002)<>'031-999-1234 / 010-2222-1234' then raise exception '신규등록 이메일 공유로 다른 전화번호 변경'; end if;
end;
$test$;
reset role;
-- 현장 수정/등록 권한을 가진 일반 직원의 기존 이메일 편집 권한도 보존합니다.
select set_config('v118.test.viewer',(select id::text from public.pjt_profiles where role='viewer' and approved and can_use_staff_portal order by id limit 1),true);
update public.pjt_profiles set can_edit_staff_sites=true,can_create_staff_sites=true where id=current_setting('v118.test.viewer')::uuid;
select set_config('request.jwt.claim.sub',current_setting('v118.test.viewer'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('v118.test.viewer'),'role','authenticated')::text,true);
set local role authenticated;
do $test$
declare v jsonb; created_id bigint;
begin
 v:=(select jsonb_agg(''::text) from generate_series(0,136));
 v:=jsonb_set(v,'{3}',to_jsonb('V118검증학교(26년 전반기)'::text));
 perform public.staff_update_site(-118001,jsonb_build_object('values',v,'client_phone','031-888-1234','client_email','staff-edit@example.com','site_address','경기도 안산시 상록구 검증로 1'));
 v:=jsonb_set(v,'{3}',to_jsonb('V118검증학교(28년 직원등록)'::text));
 created_id:=public.staff_create_site(jsonb_build_object('values',v,'client_phone','010-8888-1234','client_email','staff-create@example.com','site_address','경기도 안산시 상록구 검증로 1'));
end;
$test$;
reset role;
do $test$
begin
 if (select client_phone from public.staff_site_source where id=-118001)<>'031-999-1234 / 010-1111-1234' then raise exception '직원 이메일 수정으로 제한된 전화번호까지 변경'; end if;
 if (select client_email from public.staff_site_source where id=-118002)<>'staff-create@example.com' then raise exception '권한 있는 직원 이메일 동기화 누락'; end if;
end;
$test$;
update public.pjt_profiles set can_edit_staff_sites=false,can_create_staff_sites=false where id=current_setting('v118.test.viewer')::uuid;
set local role authenticated;
do $test$
begin
 if (public.staff_sync_school_email(-118001,null,false)->>'reason')<>'email_permission' then raise exception '권한 없는 직원 동기화 가능'; end if;
 begin
   perform public.staff_update_site_contact(-118001,'031-111-1234','denied@example.com','경기도 안산시');
   raise exception '권한 없는 직원 연락처 수정 가능';
 exception when insufficient_privilege then null;
 end;
end;
$test$;
reset role;
do $test$
begin
 if has_function_privilege('anon','public.staff_sync_school_email(bigint,text,boolean)','EXECUTE') then raise exception '익명 이메일 수정 함수 노출'; end if;
end;
$test$;
