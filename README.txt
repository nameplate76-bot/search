사내 현장정보 업무포털

1. 목적
- 회사 직원 전용 ID/PW 로그인
- 승인된 직원만 현장 검색/상세 조회
- 관리자 전용 사용자 관리
- 관리자 전용 매출 관리(조회/출력/엑셀 가져오기/내보내기)

2. 서버
- 기존 pjt-progress Supabase 프로젝트 사용
- 직원 권한: 기존 public.pjt_profiles 재사용
- 신규 DB: staff_workbook_meta, staff_site_source, staff_site_search, staff_sales_view
- 신규 Edge Function: staff-user-admin
- 원본 전체 행은 staff_site_source에 저장, 직원 검색용은 staff_site_search로 분리
- 매출/금액 열은 일반 직원 검색 데이터에서 제거되어 RLS 우회 호출로도 조회할 수 없음

3. 최초 데이터 적재
- 관리자로 로그인
- [매출 관리] > [엑셀 가져오기]
- 이 폴더의 확정수량.xlsx 선택
- 진행중 시트의 현장 데이터가 DB에 등록됩니다.
- 이후 갱신 파일도 같은 방법으로 가져오면 excel_row 기준 갱신됩니다.

4. 직원 등록
- [사용자 관리] > [직원 등록]
- 사원명, ID, PW(8자 이상), 전화번호 입력
- 일반/관리자 및 업무 권한 설정
- 신규 직원 로그인: 등록된 ID + PW
- 기존 플랫폼 관리자는 기존 이메일 + PW로도 로그인 가능

5. 배포
- 이 폴더 파일을 사내 GitHub Pages/정적 웹 호스팅에 업로드합니다.
- config.js에는 공개 가능한 Supabase publishable key만 들어 있습니다.
- 관리자 비밀키/secret/service_role 키는 절대로 웹 파일에 넣지 마십시오.

6. 권한
- 일반 직원: 승인된 계정만 현장검색 가능
- 관리자: 사용자관리 + 매출관리 + 엑셀 DB 가져오기 가능
- 매출 데이터는 DB의 staff_site_source RLS로 관리자만 접근 가능
