-- V280: mckim 본인 사원명 수정 및 지정 관리자 계정 권한 설정 지원
-- 사원명 변경은 mckim 본인 세션에서만 가능하도록 제한합니다.
CREATE OR REPLACE FUNCTION public.staff_update_mckim_employee_name(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_saved text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = '42501';
  END IF;

  IF length(v_name) < 1 OR length(v_name) > 120 THEN
    RAISE EXCEPTION '사원명은 1자 이상 120자 이하로 입력하세요.';
  END IF;

  UPDATE public.pjt_profiles
     SET name = v_name,
         updated_at = now()
   WHERE id = auth.uid()
     AND lower(btrim(user_id)) = 'mckim'
   RETURNING name INTO v_saved;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mckim 계정으로 로그인한 경우에만 사원명을 수정할 수 있습니다.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('ok', true, 'name', v_saved);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_update_mckim_employee_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_update_mckim_employee_name(text) TO authenticated;
