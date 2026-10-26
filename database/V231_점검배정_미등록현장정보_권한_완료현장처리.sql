-- V231 점검배정 대시보드, 과거 완료 현장 및 현장정보 목록
-- Supabase SQL Editor에서 전체를 한 번에 실행하세요.
BEGIN;

ALTER TABLE public.staff_inspection_schedule
  ADD COLUMN IF NOT EXISTS plan_status text NOT NULL DEFAULT '';
ALTER TABLE public.staff_inspection_schedule
  ALTER COLUMN plan_start DROP NOT NULL,
  ALTER COLUMN plan_end DROP NOT NULL;
ALTER TABLE public.staff_inspection_schedule
  DROP CONSTRAINT IF EXISTS staff_schedule_order,
  DROP CONSTRAINT IF EXISTS staff_schedule_range,
  DROP CONSTRAINT IF EXISTS staff_schedule_status_dates;
ALTER TABLE public.staff_inspection_schedule
  ADD CONSTRAINT staff_schedule_status_dates CHECK (
    (plan_status = '완료' AND plan_start IS NULL AND plan_end IS NULL)
    OR (plan_status = '' AND plan_start IS NOT NULL AND plan_end IS NOT NULL
        AND plan_end >= plan_start
        AND plan_start >= DATE '2000-01-01'
        AND plan_end <= DATE '2050-12-31')
  );

CREATE OR REPLACE FUNCTION public.staff_schedule_clear_legacy_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.plan_start IS NOT NULL AND NEW.plan_end IS NOT NULL THEN NEW.plan_status := ''; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS staff_schedule_clear_legacy_status ON public.staff_inspection_schedule;
CREATE TRIGGER staff_schedule_clear_legacy_status
  BEFORE INSERT OR UPDATE ON public.staff_inspection_schedule
  FOR EACH ROW EXECUTE FUNCTION public.staff_schedule_clear_legacy_status();

CREATE OR REPLACE FUNCTION public.staff_assignment_parse_date(p_value text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = '' AS $$
DECLARE
  v text := btrim(coalesce(p_value,''));
  m text[];
  d date;
  n numeric;
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  m := regexp_match(v, '^([0-9]{4})[-./]([0-9]{1,2})[-./]([0-9]{1,2})(?:[ T].*)?$');
  IF m IS NOT NULL THEN
    d := make_date(m[1]::integer,m[2]::integer,m[3]::integer);
  ELSE
    m := regexp_match(v, '^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})$');
    IF m IS NOT NULL THEN
      d := make_date(m[3]::integer,m[1]::integer,m[2]::integer);
    ELSIF v ~ '^[0-9]+([.]0+)?$' THEN
      n := v::numeric;
      IF n BETWEEN 20000 AND 80000 THEN d := DATE '1899-12-30' + n::integer; END IF;
    END IF;
  END IF;
  IF d IS NULL OR d < DATE '2000-01-01' OR d > DATE '2050-12-31' THEN RETURN NULL; END IF;
  RETURN d;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.staff_schedule_sync_legacy_complete(p_source_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_report text; v_start_raw text; v_end_raw text; v_inspector text;
  v_start date; v_end date;
BEGIN
  SELECT coalesce(t.report_complete_date,''),coalesce(t.field_plan_start,''),coalesce(t.field_plan_end,''),coalesce(t.field_inspector,'')
    INTO v_report,v_start_raw,v_end_raw,v_inspector
    FROM public.staff_site_source t WHERE t.id=p_source_id;
  IF NOT FOUND OR btrim(v_report)='' THEN RETURN; END IF;

  v_start := public.staff_assignment_parse_date(v_start_raw);
  v_end := public.staff_assignment_parse_date(v_end_raw);

  IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end >= v_start THEN
    INSERT INTO public.staff_inspection_schedule(source_id,plan_start,plan_end,plan_status,inspectors,updated_at)
      VALUES(p_source_id,v_start,v_end,'',btrim(v_inspector),now())
    ON CONFLICT(source_id) DO UPDATE SET
      plan_start=EXCLUDED.plan_start,plan_end=EXCLUDED.plan_end,plan_status='',
      inspectors=CASE WHEN btrim(coalesce(public.staff_inspection_schedule.inspectors,''))='' THEN EXCLUDED.inspectors ELSE public.staff_inspection_schedule.inspectors END,
      updated_at=now()
    WHERE public.staff_inspection_schedule.plan_status='완료'
       OR public.staff_inspection_schedule.plan_start IS NULL
       OR public.staff_inspection_schedule.plan_end IS NULL;
  ELSIF btrim(v_start_raw)='' AND btrim(v_end_raw)='' THEN
    INSERT INTO public.staff_inspection_schedule(source_id,plan_start,plan_end,plan_status,inspectors,updated_at)
      VALUES(p_source_id,NULL,NULL,'완료',btrim(v_inspector),now())
    ON CONFLICT(source_id) DO UPDATE SET
      plan_start=NULL,plan_end=NULL,plan_status='완료',
      inspectors=CASE WHEN btrim(coalesce(public.staff_inspection_schedule.inspectors,''))='' THEN EXCLUDED.inspectors ELSE public.staff_inspection_schedule.inspectors END,
      updated_at=now()
    WHERE public.staff_inspection_schedule.plan_status='완료'
       OR (public.staff_inspection_schedule.plan_start IS NULL AND public.staff_inspection_schedule.plan_end IS NULL);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.staff_schedule_sync_legacy_complete_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.staff_schedule_sync_legacy_complete(NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS staff_schedule_sync_legacy_complete ON public.staff_site_source;
CREATE TRIGGER staff_schedule_sync_legacy_complete
  AFTER INSERT OR UPDATE OF report_complete_date,field_plan_start,field_plan_end,field_inspector
  ON public.staff_site_source FOR EACH ROW
  EXECUTE FUNCTION public.staff_schedule_sync_legacy_complete_trigger();

-- 이미 등록된 보고서 완료 현장에도 동일한 기준을 적용합니다.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.staff_site_source WHERE coalesce(btrim(report_complete_date),'')<>'' LOOP
    PERFORM public.staff_schedule_sync_legacy_complete(r.id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.staff_schedule_assignment_rows()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can_view_schedule() THEN
    RAISE EXCEPTION '점검배정 조회 권한이 없습니다.' USING errcode='42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'source_id',t.id,'site_name',t.site_name,'sn',t.sn,
    'plan_start',s.plan_start,'plan_end',s.plan_end,
    'plan_status',coalesce(s.plan_status,''),
    'inspectors',coalesce(nullif(s.inspectors,''),t.field_inspector,''),
    'field_inspector',coalesce(t.field_inspector,''),
    'field_plan_start',coalesce(t.field_plan_start,''),
    'field_plan_end',coalesce(t.field_plan_end,''),
    'report_complete_date',coalesce(t.report_complete_date,''),
    'performance_contract',coalesce(t.full_values->>9,''),
    'maintenance_contract',coalesce(t.full_values->>11,''),
    'manager_contract',coalesce(t.full_values->>13,''),
    'region',coalesce(t.region,''),
    'monthly_contract',coalesce(t.full_values->>14,''),
    'corporation',coalesce(t.full_values->>23,'')
  ) ORDER BY t.id),'[]'::jsonb) INTO v_result
  FROM public.staff_site_source t
  LEFT JOIN public.staff_inspection_schedule s ON s.source_id=t.id
  WHERE public.staff_can_view_all_schedule()
     OR public.staff_schedule_visible(coalesce(nullif(s.inspectors,''),t.field_inspector,''));
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.staff_schedule_clear_legacy_status(),public.staff_assignment_parse_date(text),public.staff_schedule_sync_legacy_complete(bigint),public.staff_schedule_sync_legacy_complete_trigger(),public.staff_schedule_assignment_rows() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_schedule_assignment_rows() TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_site_plan_dates(p_source_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.pjt_profiles p WHERE p.id=auth.uid() AND p.approved AND p.can_use_staff_portal
  ) THEN RAISE EXCEPTION '승인된 포털 사용자만 계획일자를 조회할 수 있습니다.' USING errcode='42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'source_id',s.source_id,
    'plan_start',CASE WHEN s.plan_status='완료' THEN '완료' ELSE s.plan_start::text END,
    'plan_end',CASE WHEN s.plan_status='완료' THEN '완료' ELSE s.plan_end::text END,
    'plan_status',s.plan_status
  ) ORDER BY s.source_id),'[]'::jsonb)
  FROM public.staff_inspection_schedule s WHERE p_source_id IS NULL OR s.source_id=p_source_id);
END $$;
REVOKE ALL ON FUNCTION public.staff_site_plan_dates(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_site_plan_dates(bigint) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
