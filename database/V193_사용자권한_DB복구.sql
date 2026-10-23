-- V193 사용자 권한 DB 복구: 기존 계정/게시물/파일/권한을 유지하고 필요한 객체를 생성·갱신합니다.
-- Supabase SQL Editor에서 전체 내용을 실행하세요. 프런트엔드에서 자동 실행되지 않습니다.
BEGIN;
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


NOTIFY pgrst,'reload schema';
COMMIT;
SELECT to_regprocedure('public.staff_board_permissions_admin_list()') AS permissions_list_function,to_regprocedure('public.staff_save_user_permissions_v191(uuid,jsonb)') AS permissions_save_function;
