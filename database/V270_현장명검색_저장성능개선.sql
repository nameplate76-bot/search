-- 현장명 기준 주소 상속 트리거 및 학교 연락처 동기화 검색용 인덱스
-- staff_site_name_base()는 IMMUTABLE 함수이므로 표현식 인덱스를 사용할 수 있습니다.
CREATE INDEX IF NOT EXISTS staff_site_source_name_base_lookup_idx
ON public.staff_site_source (
  public.staff_site_name_base(site_name),
  updated_at DESC NULLS LAST,
  id DESC
);
