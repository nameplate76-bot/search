-- 테스트 전용. 임시 데이터와 권한 변경은 반드시 ROLLBACK 합니다.
insert into public.staff_site_source(id,excel_row,site_name,client_phone,client_email,client_contact,site_address,full_values,safe_values)
select id,id::integer,name,phone,email,phone||' '||email,'경기도 안산시 상록구 검증로 1',
 jsonb_set(jsonb_set(a,'{3}',to_jsonb(name)),'{42}',to_jsonb(phone||' '||email)),
 jsonb_set(jsonb_set(a,'{3}',to_jsonb(name)),'{42}',to_jsonb(phone||' '||email))
from (values
 (-117001::bigint,'V117검증학교(26년 전반기)','031-111-1234 / 010-1111-1234','source@example.com'),
 (-117002::bigint,'V117검증학교（25년 후반기）','031-222-1234 / 010-2222-1234','target@example.com'),
 (-117003::bigint,'V117검증학교별관(26년 전반기)','031-333-1234','different@example.com'),
 (-117004::bigint,'V117검증사무실(26년)','02-111-1234','office@example.com'),
 (-117005::bigint,'V117검증사무실(25년)','02-222-1234','office2@example.com')
) t(id,name,phone,email)
cross join (select jsonb_agg(''::text) as a from generate_series(0,136)) vals;

select set_config('request.jwt.claim.sub','72221ccd-439b-4649-a8a6-b6ec25c66859',true);
select set_config('request.jwt.claims','{"sub":"72221ccd-439b-4649-a8a6-b6ec25c66859","role":"authenticated"}',true);
set local role authenticated;

do $test$
declare r jsonb; p text; v jsonb; created_id bigint;
begin
 if public.staff_school_phone_numbers('+82 31-123-4567 / 02-1234-5678 / 010-1234-5678 / 070-1234-5678')
   <>array['031-123-4567','02-1234-5678','010-1234-5678','070-1234-5678'] then raise exception '전화번호 해석 실패'; end if;
 if public.staff_school_phone_is_landline('010-1234-5678') or not public.staff_school_phone_is_landline('044-123-4567')
   or public.staff_school_phone_is_landline('035-123-4567') then raise exception '일반전화/휴대폰 분류 실패'; end if;
 if cardinality(public.staff_school_phone_numbers('999031123456789999'))<>0 then raise exception '잘못된 번호 부분추출'; end if;
 r:=public.staff_update_site_contact(-117001,'031-999-1234 / 010-9999-1234','source@example.com','경기도 안산시 상록구 검증로 1');
 if (r#>>'{school_phone,updated}')::int<>1 or (r#>>'{school_phone,matched}')::int<>1 then raise exception '같은 학교 동시반영 건수 오류: %',r; end if;
 select client_phone into p from public.staff_site_source where id=-117002;
 if p<>'031-999-1234 / 010-2222-1234' then raise exception '일반전화 반영 또는 휴대폰 보존 실패: %',p; end if;
 if (select client_email from public.staff_site_source where id=-117002)<>'target@example.com' then raise exception '다른 현장의 이메일 변경'; end if;
 if (select client_phone from public.staff_site_source where id=-117003)<>'031-333-1234' then raise exception '이름 일부가 비슷한 다른 학교까지 변경'; end if;
 if (select client_phone from public.staff_site_search where source_id=-117002)<>p then raise exception '검색 DB 반영 누락'; end if;
 if (select full_values->>42 from public.staff_site_source where id=-117002)<>p||' target@example.com'
   or (select safe_values->>42 from public.staff_site_search where source_id=-117002)<>p||' target@example.com' then raise exception '엑셀 연락처 반영 누락'; end if;

 -- 일반전화가 그대로이고 휴대폰만 변경되면 동기화를 실행하지 않습니다.
 update public.staff_site_source set client_phone='031-333-1234 / 010-2222-1234' where id=-117002;
 r:=public.staff_update_site_contact(-117001,'031-999-1234 / 010-8888-1234','source@example.com','경기도 안산시 상록구 검증로 1');
 if (r#>>'{school_phone,synced}')::boolean or (select client_phone from public.staff_site_source where id=-117002)<>'031-333-1234 / 010-2222-1234' then raise exception '휴대폰만 변경했는데 다른 현장 변경'; end if;
 r:=public.staff_update_site_contact(-117001,'010-7777-1234','source@example.com','경기도 안산시 상록구 검증로 1');
 if (r#>>'{school_phone,synced}')::boolean then raise exception '휴대폰을 공유함'; end if;
 r:=public.staff_update_site_contact(-117004,'02-999-1234','office@example.com','경기도 안산시 상록구 검증로 1');
 if (select client_phone from public.staff_site_source where id=-117005)<>'02-222-1234' then raise exception '학교가 아닌 현장까지 변경'; end if;

 -- 기본정보 수정 RPC도 같은 트랜잭션에서 관련 학교 전화번호를 반영합니다.
 select full_values into v from public.staff_site_source where id=-117001;
 perform public.staff_update_site(-117001,jsonb_build_object('values',v,'client_phone','02-555-1234 / 010-5555-1234','client_email','source@example.com','site_address','경기도 안산시 상록구 검증로 1'));
 if (select client_phone from public.staff_site_source where id=-117002)<>'02-555-1234 / 010-2222-1234' then raise exception '기본정보 수정 RPC 반영 누락'; end if;
 if (select full_values->>42 from public.staff_site_source where id=-117001)<>'02-555-1234 / 010-5555-1234 source@example.com' then raise exception '수정 RPC 엑셀 연락처 누락'; end if;

 v:=jsonb_set(v,'{3}',to_jsonb('V117검증학교(27년 신규등록)'::text));
 created_id:=public.staff_create_site(jsonb_build_object('values',v,'client_phone','070-5555-1234 / 010-6666-1234','client_email','new@example.com','site_address','경기도 안산시 상록구 검증로 1'));
 if (select client_phone from public.staff_site_source where id=-117002)<>'070-5555-1234 / 010-2222-1234' then raise exception '신규등록 RPC 반영 누락'; end if;
 if (select client_phone from public.staff_site_source where id=created_id)<>'070-5555-1234 / 010-6666-1234' then raise exception '신규 현장 휴대폰 변경'; end if;
 -- 일반전화 여러 개와 휴대폰 여러 개의 처리 및 중복 제거
 r:=public.staff_update_site_contact(-117001,'02-1234-5678 / 031-987-6543 / 031-987-6543 / 010-1111-2222','source@example.com','경기도 안산시 상록구 검증로 1');
 if (select client_phone from public.staff_site_source where id=-117002)<>'02-1234-5678 / 031-987-6543 / 010-2222-1234' then raise exception '복수 일반전화 반영 실패'; end if;
 r:=public.staff_update_site_contact(-117001,'','source@example.com','경기도 안산시 상록구 검증로 1');
 if (select client_phone from public.staff_site_source where id=-117002)<>'02-1234-5678 / 031-987-6543 / 010-2222-1234' then raise exception '공란 저장 시 다른 현장까지 삭제'; end if;
end;
$test$;

reset role;
select set_config('request.jwt.claim.sub','5771d51c-177d-4ace-96c4-05a4842c54cf',true);
select set_config('request.jwt.claims','{"sub":"5771d51c-177d-4ace-96c4-05a4842c54cf","role":"authenticated"}',true);
set local role authenticated;
do $test$
begin
 begin
   perform public.staff_update_site_contact(-117001,'031-444-1234','','경기도 안산시');
   raise exception '조회 전용 사용자가 연락처 수정 가능';
 exception when insufficient_privilege then null;
 end;
 if (public.staff_sync_school_landline(-117001,null,false)->>'reason')<>'phone_permission' then raise exception '권한 없는 사용자가 전화번호 반영 가능'; end if;
end;
$test$;
reset role;
do $test$
begin
 if has_function_privilege('anon','public.staff_update_site_contact(bigint,text,text,text)','EXECUTE')
   or has_function_privilege('anon','public.staff_sync_school_landline(bigint,text,boolean)','EXECUTE') then raise exception '익명 사용자 실행 권한 노출'; end if;
end;
$test$;
