-- V244 보고서 작성 불필요 현장 분류 및 미작성 집계 제외
-- Supabase SQL Editor에서 전체 스크립트를 실행하세요.
BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_report_exemptions (
  source_id bigint PRIMARY KEY REFERENCES public.staff_site_source(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  created_by uuid NOT NULL REFERENCES public.pjt_profiles(id) ON DELETE RESTRICT,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.staff_report_exemptions IS '보고서 작성이 불필요한 현장. 이 테이블에 등록된 현장은 보고서 미작성 대시보드 집계에서 제외한다.';

CREATE OR REPLACE FUNCTION public.staff_can_manage_report_exemptions()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pjt_profiles p
    WHERE p.id = auth.uid()
      AND p.approved
      AND p.can_use_staff_portal
      AND (p.role = 'admin' OR p.can_edit_staff_sites)
  );
$$;
REVOKE ALL ON FUNCTION public.staff_can_manage_report_exemptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_can_manage_report_exemptions() TO authenticated;

ALTER TABLE public.staff_report_exemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_report_exemptions_read ON public.staff_report_exemptions;
CREATE POLICY staff_report_exemptions_read ON public.staff_report_exemptions
  FOR SELECT TO authenticated
  USING (public.staff_can_view_unwritten());
DROP POLICY IF EXISTS staff_report_exemptions_insert ON public.staff_report_exemptions;
CREATE POLICY staff_report_exemptions_insert ON public.staff_report_exemptions
  FOR INSERT TO authenticated
  WITH CHECK (public.staff_can_manage_report_exemptions() AND created_by = auth.uid());
DROP POLICY IF EXISTS staff_report_exemptions_update ON public.staff_report_exemptions;
CREATE POLICY staff_report_exemptions_update ON public.staff_report_exemptions
  FOR UPDATE TO authenticated
  USING (public.staff_can_manage_report_exemptions())
  WITH CHECK (public.staff_can_manage_report_exemptions() AND created_by = auth.uid());
DROP POLICY IF EXISTS staff_report_exemptions_delete ON public.staff_report_exemptions;
CREATE POLICY staff_report_exemptions_delete ON public.staff_report_exemptions
  FOR DELETE TO authenticated
  USING (public.staff_can_manage_report_exemptions());

REVOKE ALL ON TABLE public.staff_report_exemptions FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.staff_report_exemptions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.staff_report_exemptions TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_report_exemption_set(p_source_id bigint, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can_manage_report_exemptions() THEN
    RAISE EXCEPTION '보고서 작성 불필요 분류 권한이 없습니다.' USING ERRCODE = '42501';
  END IF;
  IF p_source_id IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION '현장 번호와 1~500자의 분류 사유를 입력해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_site_source s WHERE s.id = p_source_id) THEN
    RAISE EXCEPTION '현장을 찾을 수 없습니다.';
  END IF;
  SELECT coalesce(nullif(p.name, ''), nullif(p.user_id, ''), auth.uid()::text)
    INTO v_name FROM public.pjt_profiles p WHERE p.id = auth.uid();
  INSERT INTO public.staff_report_exemptions(source_id, reason, created_by, created_by_name, created_at)
  VALUES (p_source_id, v_reason, auth.uid(), coalesce(v_name, auth.uid()::text), now())
  ON CONFLICT (source_id) DO UPDATE
    SET reason = EXCLUDED.reason,
        created_by = EXCLUDED.created_by,
        created_by_name = EXCLUDED.created_by_name,
        created_at = EXCLUDED.created_at;
  RETURN jsonb_build_object('ok', true, 'source_id', p_source_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_report_exemption_clear(p_source_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can_manage_report_exemptions() THEN
    RAISE EXCEPTION '보고서 작성 불필요 분류 해제 권한이 없습니다.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.staff_report_exemptions WHERE source_id = p_source_id;
  RETURN jsonb_build_object('ok', true, 'source_id', p_source_id);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_report_exemption_set(bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_report_exemption_clear(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_report_exemption_set(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_report_exemption_clear(bigint) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
