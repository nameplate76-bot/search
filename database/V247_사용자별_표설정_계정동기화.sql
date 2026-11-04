-- V247 사용자별 표 환경을 브라우저 간 동기화하기 위한 저장소
-- Supabase SQL Editor에서 전체 스크립트를 실행하세요.
BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_user_ui_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.pjt_profiles(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_user_ui_preferences_object CHECK (jsonb_typeof(preferences) = 'object')
);

COMMENT ON TABLE public.staff_user_ui_preferences IS '직원 계정별 업무포털 표 열 순서·폭 등 화면 환경 설정';

ALTER TABLE public.staff_user_ui_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_user_ui_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.staff_user_ui_preferences TO authenticated;

DROP POLICY IF EXISTS staff_user_ui_preferences_own_access ON public.staff_user_ui_preferences;
CREATE POLICY staff_user_ui_preferences_own_access
  ON public.staff_user_ui_preferences
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.pjt_profiles p
      WHERE p.id = auth.uid()
        AND p.approved
        AND p.can_use_staff_portal
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.pjt_profiles p
      WHERE p.id = auth.uid()
        AND p.approved
        AND p.can_use_staff_portal
    )
  );

CREATE OR REPLACE FUNCTION public.staff_user_ui_preferences_merge(p_preferences jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR jsonb_typeof(p_preferences) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '유효한 로그인 사용자와 화면 설정 객체가 필요합니다.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.staff_user_ui_preferences(user_id, preferences, updated_at)
  VALUES (auth.uid(), p_preferences, now())
  ON CONFLICT (user_id) DO UPDATE
    SET preferences = public.staff_user_ui_preferences.preferences || EXCLUDED.preferences,
        updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_user_ui_preferences_merge(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_user_ui_preferences_merge(jsonb) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
