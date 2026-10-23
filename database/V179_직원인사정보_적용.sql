-- V179: 기존 계정/권한 테이블은 변경하지 않고 인사정보를 별도로 저장합니다.
BEGIN;
CREATE TABLE IF NOT EXISTS public.staff_employee_details (
 user_id uuid PRIMARY KEY REFERENCES public.pjt_profiles(id) ON DELETE CASCADE,
 join_date date,
 company varchar(120),
 department varchar(120),
 job_grade varchar(120),
 job_position varchar(120),
 resign_date date,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT staff_employee_dates_valid CHECK(join_date IS NULL OR resign_date IS NULL OR resign_date>=join_date)
);
ALTER TABLE public.staff_employee_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_employee_details FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.staff_employee_details TO authenticated;
DROP POLICY IF EXISTS staff_employee_read ON public.staff_employee_details;
CREATE POLICY staff_employee_read ON public.staff_employee_details FOR SELECT TO authenticated
 USING(auth.uid() IS NOT NULL AND public.staff_can_manage_users());
DROP POLICY IF EXISTS staff_employee_insert ON public.staff_employee_details;
CREATE POLICY staff_employee_insert ON public.staff_employee_details FOR INSERT TO authenticated
 WITH CHECK(auth.uid() IS NOT NULL AND public.staff_can_manage_users());
DROP POLICY IF EXISTS staff_employee_update ON public.staff_employee_details;
CREATE POLICY staff_employee_update ON public.staff_employee_details FOR UPDATE TO authenticated
 USING(auth.uid() IS NOT NULL AND public.staff_can_manage_users())
 WITH CHECK(auth.uid() IS NOT NULL AND public.staff_can_manage_users());
CREATE OR REPLACE FUNCTION public.staff_employee_details_list() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.staff_can_manage_users() THEN
  RAISE EXCEPTION '인사정보 조회 권한이 없습니다.' USING ERRCODE='42501';
 END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) FROM public.staff_employee_details d);
END $$;
CREATE OR REPLACE FUNCTION public.staff_save_employee_details(p_user_id uuid,p_details jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE saved public.staff_employee_details;
BEGIN
 IF auth.uid() IS NULL OR NOT public.staff_can_manage_users() THEN
  RAISE EXCEPTION '인사정보 수정 권한이 없습니다.' USING ERRCODE='42501';
 END IF;
 IF p_details IS NULL OR jsonb_typeof(p_details)<>'object' THEN RAISE EXCEPTION '입력 형식이 올바르지 않습니다.'; END IF;
 INSERT INTO public.staff_employee_details(user_id,join_date,company,department,job_grade,job_position,resign_date,updated_at)
 VALUES(p_user_id,nullif(p_details->>'join_date','')::date,nullif(btrim(p_details->>'company'),''),nullif(btrim(p_details->>'department'),''),
 nullif(btrim(p_details->>'job_grade'),''),nullif(btrim(p_details->>'job_position'),''),nullif(p_details->>'resign_date','')::date,now())
 ON CONFLICT(user_id) DO UPDATE SET join_date=excluded.join_date,company=excluded.company,department=excluded.department,
 job_grade=excluded.job_grade,job_position=excluded.job_position,resign_date=excluded.resign_date,updated_at=now()
 RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.staff_employee_details_list(),public.staff_save_employee_details(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_employee_details_list(),public.staff_save_employee_details(uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
