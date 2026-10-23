-- V198 공지사항/자료실 등록자를 사원명으로 기록하고 기존 연결 계정의 이름을 보정합니다.
BEGIN;
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
