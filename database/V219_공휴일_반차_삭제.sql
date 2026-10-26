-- V219: 등록 휴일 삭제 및 공휴일·연차·반차 휴가 등록 UI 지원
-- 기본 공휴일(schedule-holidays.js)은 삭제하지 않고, DB에 사용자가 등록한 항목만 삭제합니다.
create or replace function public.staff_schedule_holiday_delete(p_date date) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.staff_can_edit_schedule() then
  raise exception '점검일정 수정 권한이 없습니다.' using errcode='42501';
 end if;
 delete from public.staff_inspection_holidays where holiday_date=p_date;
 return jsonb_build_object('ok',true,'deleted',found);
end $$;
revoke all on function public.staff_schedule_holiday_delete(date) from public,anon;
grant execute on function public.staff_schedule_holiday_delete(date) to authenticated;
notify pgrst, 'reload schema';
