-- V257: 점검배정 미등록 집계에 성능/유지관리 계약·계획 회차를 전달합니다.
-- 기존 조회범위 권한은 유지하며 프런트에서 네 회차가 모두 비어 있는 현장만 집계에서 제외합니다.
BEGIN;
-- V235 점검배정 본인 조회와 전체 조회 권한을 분리합니다. 기존 점검일정 권한과 본인 조회 권한은 유지합니다.
ALTER TABLE public.pjt_profiles ADD COLUMN IF NOT EXISTS can_view_staff_assignment boolean NOT NULL DEFAULT false;
ALTER TABLE public.pjt_profiles ADD COLUMN IF NOT EXISTS can_view_all_staff_assignment boolean NOT NULL DEFAULT false;
UPDATE public.pjt_profiles SET can_view_staff_assignment=true,can_view_all_staff_assignment=true WHERE role='admin' AND (can_view_staff_assignment IS DISTINCT FROM true OR can_view_all_staff_assignment IS DISTINCT FROM true);

CREATE OR REPLACE FUNCTION public.staff_can_view_assignment() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.pjt_profiles p WHERE p.id=auth.uid() AND p.approved AND p.can_use_staff_portal AND (p.role='admin' OR p.can_view_staff_assignment OR p.can_view_all_staff_assignment))
$$;
REVOKE ALL ON FUNCTION public.staff_can_view_assignment() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_can_view_assignment() TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_can_view_all_assignment() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.pjt_profiles p WHERE p.id=auth.uid() AND p.approved AND p.can_use_staff_portal AND (p.role='admin' OR p.can_view_all_staff_assignment))
$$;
REVOKE ALL ON FUNCTION public.staff_can_view_all_assignment() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_can_view_all_assignment() TO authenticated;

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
  v_assignment boolean;
  v_assignment_all boolean;
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

  select can_view_staff_unwritten,can_view_staff_assignment,can_view_all_staff_assignment into v_unwritten,v_assignment,v_assignment_all from public.pjt_profiles where id=p_user_id;
  v_unwritten := coalesce((p_permissions->>'can_view_staff_unwritten')::boolean,v_unwritten);
  v_assignment := coalesce((p_permissions->>'can_view_staff_assignment')::boolean,v_assignment);
  v_assignment_all := coalesce((p_permissions->>'can_view_all_staff_assignment')::boolean,v_assignment_all);

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
    v_schedule_own:=true;v_schedule_view:=true; v_schedule_edit:=true; v_unwritten:=true;v_assignment:=true;v_assignment_all:=true; v_approved:=true; v_portal:=true; v_view_sites:=true; v_create_sites:=true; v_edit_sites:=true;
    v_export_sites:=true; v_view_money:=true; v_create_money:=true; v_edit_money:=true;
    v_view_sales:=true; v_export_sales:=true; v_print_sales:=true; v_import_sites:=true; v_manage_users:=true;

  end if;

  update public.pjt_profiles
  set can_view_own_staff_schedule=v_schedule_own,can_view_staff_schedule=v_schedule_view,can_edit_staff_schedule=v_schedule_edit,can_view_staff_unwritten=v_unwritten,can_view_staff_assignment=v_assignment,can_view_all_staff_assignment=v_assignment_all,role=v_role,approved=v_approved,can_use_staff_portal=v_portal,
      can_view_staff_sites=v_view_sites,can_create_staff_sites=v_create_sites,
      can_edit_staff_sites=v_edit_sites,can_export_staff_sites=v_export_sites,
      can_view_money=v_view_money,can_create_money=v_create_money,can_edit_money=v_edit_money,
      can_view_staff_sales=v_view_sales,can_export_staff_sales=v_export_sales,
      can_print_staff_sales=v_print_sales,can_import_staff_sites=v_import_sites,
      can_manage_staff_users=v_manage_users,updated_at=now()
  where id=p_user_id;

  return jsonb_build_object(
    'can_view_own_staff_schedule',v_schedule_own,'can_view_staff_schedule',v_schedule_view,'can_edit_staff_schedule',v_schedule_edit,'can_view_staff_unwritten',v_unwritten,'can_view_staff_assignment',v_assignment,'can_view_all_staff_assignment',v_assignment_all,'ok',true,'id',p_user_id,'role',v_role,'approved',v_approved,
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
        'can_view_staff_assignment',p.can_view_staff_assignment,
        'can_view_all_staff_assignment',p.can_view_all_staff_assignment,
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



CREATE OR REPLACE FUNCTION public.staff_schedule_assignment_rows()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb; v_all boolean:=false; v_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can_view_assignment() THEN
    RAISE EXCEPTION '점검배정 조회 권한이 없습니다.' USING errcode='42501';
  END IF;
  v_all := public.staff_can_view_all_assignment();
  SELECT coalesce(nullif(btrim(p.name),''),p.user_id) INTO v_name
    FROM public.pjt_profiles p WHERE p.id=auth.uid();
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
    'performance_plan_count',coalesce(t.full_values->>10,''),
    'maintenance_contract',coalesce(t.full_values->>11,''),
    'maintenance_plan_count',coalesce(t.full_values->>12,''),
    'manager_contract',coalesce(t.full_values->>13,''),
    'region',coalesce(t.region,''),
    'monthly_contract',coalesce(t.full_values->>14,''),
    'corporation',coalesce(t.full_values->>23,'')
  ) ORDER BY t.id),'[]'::jsonb) INTO v_result
  FROM public.staff_site_source t
  LEFT JOIN public.staff_inspection_schedule s ON s.source_id=t.id
  WHERE v_all
     OR (v_name IS NOT NULL AND v_name=ANY(regexp_split_to_array(btrim(coalesce(nullif(s.inspectors,''),t.field_inspector,'')),'[[:space:],/;·ㆍ、，()（）]+')));
  RETURN jsonb_build_object('rows',v_result,'scope_all',v_all,'scope_name',coalesce(v_name,''),'scope_total',jsonb_array_length(v_result),'scope_missing',(SELECT count(*) FROM public.staff_site_source t LEFT JOIN public.staff_inspection_schedule s ON s.source_id=t.id WHERE (v_all OR (v_name IS NOT NULL AND v_name=ANY(regexp_split_to_array(btrim(coalesce(nullif(s.inspectors,''),t.field_inspector,'')),'[[:space:],/;·ㆍ、，()（）]+')))) AND coalesce(s.plan_status,'')<>'완료' AND (s.plan_start IS NULL OR s.plan_end IS NULL)));
END $$;
REVOKE ALL ON FUNCTION public.staff_schedule_assignment_rows() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_schedule_assignment_rows() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
