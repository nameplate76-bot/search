-- V195 일정조회(본인 일정) 권한 추가. V193 이상 DB에 적용하며 V194 독립 선택 규칙을 유지합니다.
BEGIN;
ALTER TABLE public.pjt_profiles ADD COLUMN IF NOT EXISTS can_view_own_staff_schedule boolean NOT NULL DEFAULT false;
DO $$ DECLARE c record; BEGIN
 IF to_regclass('public.staff_board_permissions') IS NULL THEN RAISE EXCEPTION 'V193 사용자 권한 DB 복구 SQL을 먼저 실행하세요.';END IF;
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.staff_board_permissions'::regclass AND contype='c' AND (pg_get_constraintdef(oid) LIKE '%notice_view%notice_create%notice_edit%notice_delete%' OR pg_get_constraintdef(oid) LIKE '%resource_view%resource_create%resource_edit%resource_delete%') LOOP
 EXECUTE format('ALTER TABLE public.staff_board_permissions DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.staff_save_user_permissions(p_user_id uuid, p_permissions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  v_schedule_own boolean;
  v_schedule_view boolean;
  v_schedule_edit boolean;
begin
  if auth.uid() is null or not public.staff_can_manage_users() then
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

  select can_view_own_staff_schedule,can_view_staff_schedule,can_edit_staff_schedule into v_schedule_own,v_schedule_view,v_schedule_edit from public.pjt_profiles where id=p_user_id;
  v_schedule_own:=coalesce((p_permissions->>'can_view_own_staff_schedule')::boolean,v_schedule_own);
  v_schedule_view:=coalesce((p_permissions->>'can_view_staff_schedule')::boolean,v_schedule_view);
  v_schedule_edit:=coalesce((p_permissions->>'can_edit_staff_schedule')::boolean,v_schedule_edit);


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
    v_schedule_own:=true;v_schedule_view:=true; v_schedule_edit:=true; v_unwritten:=true; v_approved:=true; v_portal:=true; v_view_sites:=true; v_create_sites:=true; v_edit_sites:=true;
    v_export_sites:=true; v_view_money:=true; v_create_money:=true; v_edit_money:=true;
    v_view_sales:=true; v_export_sales:=true; v_print_sales:=true; v_import_sites:=true; v_manage_users:=true;

  end if;

  update public.pjt_profiles
  set can_view_own_staff_schedule=v_schedule_own,can_view_staff_schedule=v_schedule_view,can_edit_staff_schedule=v_schedule_edit,can_view_staff_unwritten=v_unwritten,role=v_role,approved=v_approved,can_use_staff_portal=v_portal,
      can_view_staff_sites=v_view_sites,can_create_staff_sites=v_create_sites,
      can_edit_staff_sites=v_edit_sites,can_export_staff_sites=v_export_sites,
      can_view_money=v_view_money,can_create_money=v_create_money,can_edit_money=v_edit_money,
      can_view_staff_sales=v_view_sales,can_export_staff_sales=v_export_sales,
      can_print_staff_sales=v_print_sales,can_import_staff_sites=v_import_sites,
      can_manage_staff_users=v_manage_users,updated_at=now()
  where id=p_user_id;

  return jsonb_build_object(
    'can_view_own_staff_schedule',v_schedule_own,'can_view_staff_schedule',v_schedule_view,'can_edit_staff_schedule',v_schedule_edit,'can_view_staff_unwritten',v_unwritten,'ok',true,'id',p_user_id,'role',v_role,'approved',v_approved,
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


CREATE OR REPLACE FUNCTION public.staff_save_user_permissions_v195(p_user_id uuid,p_permissions jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE board jsonb;result jsonb;keys text[]:=ARRAY['notice_create','notice_view','notice_edit','notice_delete','resource_create','resource_view','resource_edit','resource_delete'];
BEGIN
 IF auth.uid() IS NULL OR NOT public.staff_can_manage_users() THEN RAISE EXCEPTION '사용자 관리 권한이 없습니다.' USING ERRCODE='42501';END IF;
 IF p_permissions IS NULL OR jsonb_typeof(p_permissions)<>'object' OR NOT(p_permissions ?& keys) THEN RAISE EXCEPTION '공지사항·자료 권한 8개를 모두 전달해야 합니다.';END IF;
 SELECT jsonb_object_agg(k,p_permissions->k) INTO board FROM unnest(keys) k;
 board:=public.staff_board_permissions_save(p_user_id,board);
 result:=public.staff_save_user_permissions(p_user_id,p_permissions-keys);
 RETURN coalesce(result,'{}'::jsonb)||board;
END $$;

CREATE OR REPLACE FUNCTION public.staff_independent_permission_scope() RETURNS integer LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN IF auth.uid() IS NULL OR NOT public.staff_can_manage_users() THEN RAISE EXCEPTION '사용자 관리 권한이 없습니다.' USING ERRCODE='42501';END IF;RETURN 195;END $$;
REVOKE ALL ON FUNCTION public.staff_save_user_permissions(uuid,jsonb),public.staff_save_user_permissions_v195(uuid,jsonb),public.staff_independent_permission_scope() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_save_user_permissions(uuid,jsonb),public.staff_save_user_permissions_v195(uuid,jsonb),public.staff_independent_permission_scope() TO authenticated;
CREATE OR REPLACE FUNCTION public.staff_board_permissions_save_kind(p_user_id uuid,p_kind text,p_permissions jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.staff_board_permissions;v_view boolean;v_create boolean;v_edit boolean;v_delete boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT public.staff_can_manage_users() THEN RAISE EXCEPTION '사용자 관리 권한이 없습니다.' USING ERRCODE='42501'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('notice','resource') OR p_permissions IS NULL OR jsonb_typeof(p_permissions)<>'object' THEN RAISE EXCEPTION '권한 구분이 올바르지 않습니다.';END IF;
 v_view:=coalesce((p_permissions->>'view')::boolean,false);v_create:=coalesce((p_permissions->>'create')::boolean,false);v_edit:=coalesce((p_permissions->>'edit')::boolean,false);v_delete:=coalesce((p_permissions->>'delete')::boolean,false);
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

CREATE OR REPLACE FUNCTION public.staff_user_admin_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rows jsonb;
begin
  if not public.staff_can_manage_users() then
    raise exception '사용자 관리 권한이 없습니다.' using errcode='42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'can_view_own_staff_schedule',p.can_view_own_staff_schedule,'can_view_staff_schedule',p.can_view_staff_schedule,'can_edit_staff_schedule',p.can_edit_staff_schedule,
        'can_view_staff_unwritten',p.can_view_staff_unwritten,
        'id',p.id,
        'name',p.name,
        'user_id',p.user_id,
        'phone',p.phone,
        'role',p.role,
        'approved',p.approved,
        'can_use_staff_portal',p.can_use_staff_portal,
        'can_view_staff_sites',p.can_view_staff_sites,
        'can_create_staff_sites',p.can_create_staff_sites,
        'can_edit_staff_sites',p.can_edit_staff_sites,
        'can_export_staff_sites',p.can_export_staff_sites,
        'can_view_money',p.can_view_money,
        'can_create_money',p.can_create_money,
        'can_edit_money',p.can_edit_money,
        'can_view_staff_sales',p.can_view_staff_sales,
        'can_export_staff_sales',p.can_export_staff_sales,
        'can_print_staff_sales',p.can_print_staff_sales,
        'can_import_staff_sites',p.can_import_staff_sites,
        'can_manage_staff_users',p.can_manage_staff_users
      )
      order by coalesce(p.name,''),coalesce(p.user_id,'')
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.pjt_profiles p;

  return v_rows;
end;
$function$;


CREATE OR REPLACE FUNCTION public.staff_can_view_schedule() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.pjt_profiles p WHERE p.id=auth.uid() AND p.approved AND p.can_use_staff_portal AND (p.role='admin' OR p.can_view_own_staff_schedule OR p.can_view_staff_schedule OR p.can_edit_staff_schedule))
$$;
CREATE OR REPLACE FUNCTION public.staff_can_view_all_schedule() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.pjt_profiles p WHERE p.id=auth.uid() AND p.approved AND p.can_use_staff_portal AND (p.role='admin' OR p.can_view_staff_schedule))
$$;
CREATE OR REPLACE FUNCTION public.staff_schedule_visible(p_inspectors text) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT public.staff_can_view_schedule() AND EXISTS(SELECT 1 FROM public.pjt_profiles p WHERE p.id=auth.uid() AND (p.role='admin' OR p.can_view_staff_schedule OR (nullif(trim(p.name),'') IS NOT NULL AND trim(p.name)=ANY(regexp_split_to_array(trim(coalesce(p_inspectors,'')),'[[:space:],/;·ㆍ、，()（）]+')))))
$$;
CREATE OR REPLACE FUNCTION public.staff_schedule_scope() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.staff_can_view_schedule() THEN RAISE EXCEPTION '일정조회 권한이 없습니다.' USING ERRCODE='42501';END IF;
 RETURN (SELECT jsonb_build_object('scope_version',195,'all',public.staff_can_view_all_schedule(),'name',coalesce(p.name,''),'user_id',p.id) FROM public.pjt_profiles p WHERE p.id=auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.staff_user_admin_list(),public.staff_can_view_schedule(),public.staff_can_view_all_schedule(),public.staff_schedule_visible(text),public.staff_schedule_scope() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_user_admin_list(),public.staff_can_view_schedule(),public.staff_can_view_all_schedule(),public.staff_schedule_visible(text),public.staff_schedule_scope() TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
