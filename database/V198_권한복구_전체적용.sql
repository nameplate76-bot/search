BEGIN;
-- V193 사용자 권한 DB 복구: 기존 계정/게시물/파일/권한을 유지하고 필요한 객체를 생성·갱신합니다.
-- Supabase SQL Editor에서 전체 내용을 실행하세요. 프런트엔드에서 자동 실행되지 않습니다.

DO $$ BEGIN
 IF to_regclass('public.pjt_profiles') IS NULL OR to_regprocedure('public.staff_can_manage_users()') IS NULL OR to_regprocedure('public.staff_save_user_permissions(uuid,jsonb)') IS NULL THEN
 RAISE EXCEPTION '기존 업무포털 DB의 사용자 권한 기능을 찾을 수 없습니다. 포털과 같은 Supabase 프로젝트인지 확인하세요.';
 END IF;
END $$;
-- V189 공지사항 / 자료실. 기존 계정/현장 데이터 보존.

CREATE TABLE IF NOT EXISTS public.staff_board_permissions(
 user_id uuid PRIMARY KEY REFERENCES public.pjt_profiles(id) ON DELETE CASCADE,
 notice_view boolean NOT NULL DEFAULT false,notice_create boolean NOT NULL DEFAULT false,notice_edit boolean NOT NULL DEFAULT false,notice_delete boolean NOT NULL DEFAULT false,
 resource_view boolean NOT NULL DEFAULT false,resource_create boolean NOT NULL DEFAULT false,resource_edit boolean NOT NULL DEFAULT false,resource_delete boolean NOT NULL DEFAULT false,
 CHECK(notice_view OR NOT(notice_create OR notice_edit OR notice_delete)),
 CHECK(resource_view OR NOT(resource_create OR resource_edit OR resource_delete))
);
ALTER TABLE public.staff_board_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_board_permissions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.staff_board_permissions TO authenticated;
DROP POLICY IF EXISTS board_perm_read ON public.staff_board_permissions;
CREATE POLICY board_perm_read ON public.staff_board_permissions FOR SELECT TO authenticated USING(auth.uid() IS NOT NULL AND (user_id=auth.uid() OR public.staff_can_manage_users()));
DROP POLICY IF EXISTS board_perm_add ON public.staff_board_permissions;
CREATE POLICY board_perm_add ON public.staff_board_permissions FOR INSERT TO authenticated WITH CHECK(auth.uid() IS NOT NULL AND public.staff_can_manage_users());
DROP POLICY IF EXISTS board_perm_change ON public.staff_board_permissions;
CREATE POLICY board_perm_change ON public.staff_board_permissions FOR UPDATE TO authenticated USING(auth.uid() IS NOT NULL AND public.staff_can_manage_users()) WITH CHECK(auth.uid() IS NOT NULL AND public.staff_can_manage_users());
CREATE OR REPLACE FUNCTION public.staff_board_can(p_kind text,p_action text) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND p_kind IN ('notice','resource') AND p_action IN ('view','create','edit','delete') AND EXISTS(
 SELECT 1 FROM public.pjt_profiles p WHERE p.id=auth.uid() AND p.approved AND p.can_use_staff_portal AND
 (p.role='admin' OR coalesce((SELECT (to_jsonb(b)->>(p_kind||'_'||p_action))::boolean FROM public.staff_board_permissions b WHERE b.user_id=p.id),false)))
$$;
CREATE OR REPLACE FUNCTION public.staff_board_permissions_get(p_user_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE target uuid:=coalesce(p_user_id,auth.uid());
BEGIN
 IF auth.uid() IS NULL OR (target<>auth.uid() AND NOT public.staff_can_manage_users()) THEN RAISE EXCEPTION '권한 조회 권한이 없습니다.' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT to_jsonb(b)-'user_id' FROM public.staff_board_permissions b WHERE b.user_id=target),'{}'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.staff_board_permissions_save(p_user_id uuid,p_permissions jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.staff_board_permissions;
BEGIN
 IF auth.uid() IS NULL OR NOT public.staff_can_manage_users() THEN RAISE EXCEPTION '사용자 관리 권한이 없습니다.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.staff_board_permissions VALUES(p_user_id,
 coalesce((p_permissions->>'notice_view')::boolean,false),coalesce((p_permissions->>'notice_create')::boolean,false),coalesce((p_permissions->>'notice_edit')::boolean,false),coalesce((p_permissions->>'notice_delete')::boolean,false),
 coalesce((p_permissions->>'resource_view')::boolean,false),coalesce((p_permissions->>'resource_create')::boolean,false),coalesce((p_permissions->>'resource_edit')::boolean,false),coalesce((p_permissions->>'resource_delete')::boolean,false))
 ON CONFLICT(user_id) DO UPDATE SET notice_view=excluded.notice_view,notice_create=excluded.notice_create,notice_edit=excluded.notice_edit,notice_delete=excluded.notice_delete,resource_view=excluded.resource_view,resource_create=excluded.resource_create,resource_edit=excluded.resource_edit,resource_delete=excluded.resource_delete RETURNING * INTO r;
 RETURN to_jsonb(r)-'user_id';
END $$;
CREATE TABLE IF NOT EXISTS public.staff_board_posts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('notice','resource')),
 category text NOT NULL DEFAULT '',title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),body text NOT NULL DEFAULT '' CHECK(length(body)<=50000),
 post_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),author_id uuid,author_name text NOT NULL,
 file_path text UNIQUE,file_name text,file_size bigint,
 CHECK((kind='notice' AND category='' AND file_path IS NULL) OR (kind='resource' AND category IN ('점검표 양식','공문 양식','기타') AND file_path IS NOT NULL AND file_name IS NOT NULL AND file_size IS NOT NULL AND length(file_name)>0 AND file_size BETWEEN 1 AND 20971520))
);
CREATE INDEX IF NOT EXISTS staff_board_posts_order ON public.staff_board_posts(kind,created_at DESC,id);
ALTER TABLE public.staff_board_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_board_posts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.staff_board_posts TO authenticated;
DROP POLICY IF EXISTS board_read ON public.staff_board_posts;
CREATE POLICY board_read ON public.staff_board_posts FOR SELECT TO authenticated USING(public.staff_board_can(kind,'view'));
DROP POLICY IF EXISTS board_add ON public.staff_board_posts;
CREATE POLICY board_add ON public.staff_board_posts FOR INSERT TO authenticated WITH CHECK(public.staff_board_can(kind,'create'));
DROP POLICY IF EXISTS board_edit ON public.staff_board_posts;
CREATE POLICY board_edit ON public.staff_board_posts FOR UPDATE TO authenticated USING(public.staff_board_can(kind,'edit')) WITH CHECK(public.staff_board_can(kind,'edit'));
DROP POLICY IF EXISTS board_remove ON public.staff_board_posts;
CREATE POLICY board_remove ON public.staff_board_posts FOR DELETE TO authenticated USING(public.staff_board_can(kind,'delete'));
-- 파일은 반드시 본인이 업로드한 실제 저장소 객체를 참조. 작성자/등록일은 서버에서 결정.
CREATE OR REPLACE FUNCTION public.staff_board_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.kind='notice' AND length(btrim(NEW.body))=0 THEN RAISE EXCEPTION '내용을 입력하세요.';END IF;
 IF TG_OP='INSERT' THEN
 NEW.author_id:=auth.uid();SELECT coalesce(nullif(p.name,''),p.user_id,'이름 미등록') INTO NEW.author_name FROM public.pjt_profiles p WHERE p.id=auth.uid();NEW.created_at:=now();
 ELSE
 IF NEW.kind<>OLD.kind OR NEW.id<>OLD.id THEN RAISE EXCEPTION '게시물 종류와 ID는 변경할 수 없습니다.'; END IF;
 NEW.author_id:=OLD.author_id;NEW.author_name:=OLD.author_name;NEW.created_at:=OLD.created_at;
 END IF;
 NEW.updated_at:=now();
 IF NEW.kind='resource' AND (TG_OP='INSERT' OR NEW.file_path IS DISTINCT FROM OLD.file_path) THEN
 IF NEW.file_path NOT LIKE 'resource/'||auth.uid()::text||'/%' OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='staff-board-files' AND o.name=NEW.file_path AND (o.metadata->>'size')::bigint=NEW.file_size) THEN RAISE EXCEPTION '첨부파일 업로드를 확인할 수 없습니다.';END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS staff_board_stamp ON public.staff_board_posts;
CREATE TRIGGER staff_board_stamp BEFORE INSERT OR UPDATE ON public.staff_board_posts FOR EACH ROW EXECUTE FUNCTION public.staff_board_stamp();
CREATE OR REPLACE FUNCTION public.staff_board_list(p_kind text,p_field text DEFAULT 'title',p_query text DEFAULT '',p_category text DEFAULT '',p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;total bigint;
BEGIN
 IF NOT public.staff_board_can(p_kind,'view') THEN RAISE EXCEPTION '조회 권한이 없습니다.' USING ERRCODE='42501';END IF;
 IF p_field NOT IN ('post_date','title','created_at','author_name','body') OR length(p_query)>200 OR p_offset<0 THEN RAISE EXCEPTION '검색 조건이 올바르지 않습니다.';END IF;
 WITH filtered AS(SELECT b.* FROM public.staff_board_posts b WHERE b.kind=p_kind AND (p_category='' OR b.category=p_category) AND
 (p_query='' OR position(lower(p_query) IN lower(CASE p_field WHEN 'post_date' THEN b.post_date::text WHEN 'created_at' THEN (b.created_at AT TIME ZONE 'Asia/Seoul')::date::text WHEN 'title' THEN b.title WHEN 'author_name' THEN b.author_name ELSE b.body END))>0))
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET p_offset)x),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
-- 비공개 자료실 버킷. 파일 교체는 새 경로 업로드 후 DB 연결 변경 방식(upsert 없음).
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('staff-board-files','staff-board-files',false,20971520) ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=20971520;
DROP POLICY IF EXISTS board_file_read ON storage.objects;
CREATE POLICY board_file_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='staff-board-files' AND (public.staff_board_can('resource','view') AND EXISTS(SELECT 1 FROM public.staff_board_posts b WHERE b.file_path=name) OR ((public.staff_board_can('resource','edit') OR public.staff_board_can('resource','delete')) AND NOT EXISTS(SELECT 1 FROM public.staff_board_posts b WHERE b.file_path=name)) OR (split_part(name,'/',2)=auth.uid()::text AND (public.staff_board_can('resource','create') OR public.staff_board_can('resource','edit')))));
DROP POLICY IF EXISTS board_file_upload ON storage.objects;
CREATE POLICY board_file_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='staff-board-files' AND split_part(name,'/',1)='resource' AND split_part(name,'/',2)=auth.uid()::text AND (public.staff_board_can('resource','create') OR public.staff_board_can('resource','edit')));
DROP POLICY IF EXISTS board_file_remove ON storage.objects;
CREATE POLICY board_file_remove ON storage.objects FOR DELETE TO authenticated USING(bucket_id='staff-board-files' AND (public.staff_board_can('resource','edit') OR public.staff_board_can('resource','delete') OR (public.staff_board_can('resource','create') AND split_part(name,'/',2)=auth.uid()::text)) AND NOT EXISTS(SELECT 1 FROM public.staff_board_posts b WHERE b.file_path=name));
REVOKE ALL ON FUNCTION public.staff_board_can(text,text),public.staff_board_permissions_get(uuid),public.staff_board_permissions_save(uuid,jsonb),public.staff_board_stamp(),public.staff_board_list(text,text,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_board_can(text,text),public.staff_board_permissions_get(uuid),public.staff_board_permissions_save(uuid,jsonb),public.staff_board_list(text,text,text,text,integer) TO authenticated;


-- V189 공지사항·자료실 SQL을 먼저 적용한 후 실행. V190 SQL은 필수가 아닙니다.

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




-- V195 일정조회(본인 일정) 권한 추가. V193 이상 DB에 적용하며 V194 독립 선택 규칙을 유지합니다.

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



-- V198 공지사항/자료실 등록자를 사원명으로 기록하고 기존 연결 계정의 이름을 보정합니다.

CREATE OR REPLACE FUNCTION public.staff_board_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.kind='notice' AND length(btrim(NEW.body))=0 THEN RAISE EXCEPTION '내용을 입력하세요.';END IF;
 IF TG_OP='INSERT' THEN
 NEW.author_id:=auth.uid();SELECT nullif(btrim(p.name),'') INTO NEW.author_name FROM public.pjt_profiles p WHERE p.id=auth.uid();IF NEW.author_name IS NULL THEN RAISE EXCEPTION '사원명이 등록되어 있지 않습니다. 사용자 관리에서 사원명을 등록하세요.';END IF;NEW.created_at:=now();
 ELSE
 IF NEW.kind<>OLD.kind OR NEW.id<>OLD.id THEN RAISE EXCEPTION '게시물 종류와 ID는 변경할 수 없습니다.'; END IF;
 NEW.author_id:=OLD.author_id;SELECT nullif(btrim(p.name),'') INTO NEW.author_name FROM public.pjt_profiles p WHERE p.id=OLD.author_id;NEW.author_name:=coalesce(NEW.author_name,OLD.author_name);NEW.created_at:=OLD.created_at;
 END IF;
 NEW.updated_at:=now();
 IF NEW.kind='resource' AND (TG_OP='INSERT' OR NEW.file_path IS DISTINCT FROM OLD.file_path) THEN
 IF NEW.file_path NOT LIKE 'resource/'||auth.uid()::text||'/%' OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='staff-board-files' AND o.name=NEW.file_path AND (o.metadata->>'size')::bigint=NEW.file_size) THEN RAISE EXCEPTION '첨부파일 업로드를 확인할 수 없습니다.';END IF;
 END IF;
 RETURN NEW;
END $$;

UPDATE public.staff_board_posts b SET author_name=btrim(p.name) FROM public.pjt_profiles p WHERE b.author_id=p.id AND nullif(btrim(p.name),'') IS NOT NULL AND b.author_name IS DISTINCT FROM btrim(p.name);
REVOKE ALL ON FUNCTION public.staff_board_stamp() FROM PUBLIC,anon;


NOTIFY pgrst,'reload schema';
COMMIT;
