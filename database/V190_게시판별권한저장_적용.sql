-- 먼저 V189_공지사항_자료실_적용.sql을 적용한 프로젝트에 실행하세요.
BEGIN;
CREATE OR REPLACE FUNCTION public.staff_board_permissions_save_kind(p_user_id uuid,p_kind text,p_permissions jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.staff_board_permissions;v_view boolean;v_create boolean;v_edit boolean;v_delete boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT public.staff_can_manage_users() THEN RAISE EXCEPTION '사용자 관리 권한이 없습니다.' USING ERRCODE='42501'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('notice','resource') OR p_permissions IS NULL OR jsonb_typeof(p_permissions)<>'object' THEN RAISE EXCEPTION '권한 구분이 올바르지 않습니다.';END IF;
 v_view:=coalesce((p_permissions->>'view')::boolean,false);v_create:=coalesce((p_permissions->>'create')::boolean,false);v_edit:=coalesce((p_permissions->>'edit')::boolean,false);v_delete:=coalesce((p_permissions->>'delete')::boolean,false);
 IF NOT v_view AND (v_create OR v_edit OR v_delete) THEN RAISE EXCEPTION '등록·수정·삭제에는 조회 권한이 필요합니다.';END IF;
 INSERT INTO public.staff_board_permissions(user_id,notice_view,notice_create,notice_edit,notice_delete,resource_view,resource_create,resource_edit,resource_delete)
 VALUES(p_user_id,p_kind='notice' AND v_view,p_kind='notice' AND v_create,p_kind='notice' AND v_edit,p_kind='notice' AND v_delete,p_kind='resource' AND v_view,p_kind='resource' AND v_create,p_kind='resource' AND v_edit,p_kind='resource' AND v_delete)
 ON CONFLICT(user_id) DO UPDATE SET
 notice_view=CASE WHEN p_kind='notice' THEN excluded.notice_view ELSE staff_board_permissions.notice_view END,
 notice_create=CASE WHEN p_kind='notice' THEN excluded.notice_create ELSE staff_board_permissions.notice_create END,
 notice_edit=CASE WHEN p_kind='notice' THEN excluded.notice_edit ELSE staff_board_permissions.notice_edit END,
 notice_delete=CASE WHEN p_kind='notice' THEN excluded.notice_delete ELSE staff_board_permissions.notice_delete END,
 resource_view=CASE WHEN p_kind='resource' THEN excluded.resource_view ELSE staff_board_permissions.resource_view END,
 resource_create=CASE WHEN p_kind='resource' THEN excluded.resource_create ELSE staff_board_permissions.resource_create END,
 resource_edit=CASE WHEN p_kind='resource' THEN excluded.resource_edit ELSE staff_board_permissions.resource_edit END,
 resource_delete=CASE WHEN p_kind='resource' THEN excluded.resource_delete ELSE staff_board_permissions.resource_delete END RETURNING * INTO r;
 RETURN to_jsonb(r)-'user_id';
END $$;
REVOKE ALL ON FUNCTION public.staff_board_permissions_save_kind(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_board_permissions_save_kind(uuid,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
