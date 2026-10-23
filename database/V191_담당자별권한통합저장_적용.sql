-- V189 공지사항·자료실 SQL을 먼저 적용한 후 실행. V190 SQL은 필수가 아닙니다.
BEGIN;
CREATE OR REPLACE FUNCTION public.staff_board_permissions_admin_list() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.staff_can_manage_users() THEN RAISE EXCEPTION '사용자 관리 권한이 없습니다.' USING ERRCODE='42501';END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM public.staff_board_permissions b),'[]'::jsonb);
END $$;
-- 기존 권한과 새 8개 권한을 하나의 트랜잭션으로 저장합니다.
CREATE OR REPLACE FUNCTION public.staff_save_user_permissions_v191(p_user_id uuid,p_permissions jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE board jsonb;result jsonb;keys text[]:=ARRAY['notice_create','notice_view','notice_edit','notice_delete','resource_create','resource_view','resource_edit','resource_delete'];
BEGIN
 IF auth.uid() IS NULL OR NOT public.staff_can_manage_users() THEN RAISE EXCEPTION '사용자 관리 권한이 없습니다.' USING ERRCODE='42501';END IF;
 IF p_permissions IS NULL OR jsonb_typeof(p_permissions)<>'object' OR NOT(p_permissions ?& keys) THEN RAISE EXCEPTION '공지사항·자료 권한 8개를 모두 전달해야 합니다.';END IF;
 SELECT jsonb_object_agg(k,p_permissions->k) INTO board FROM unnest(keys) k;
 board:=public.staff_board_permissions_save(p_user_id,board);
 result:=public.staff_save_user_permissions(p_user_id,p_permissions-keys);
 RETURN coalesce(result,'{}'::jsonb)||board;
END $$;
REVOKE ALL ON FUNCTION public.staff_board_permissions_admin_list(),public.staff_save_user_permissions_v191(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_board_permissions_admin_list(),public.staff_save_user_permissions_v191(uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
