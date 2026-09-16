기계설비 현장 검색 · 공개 웹서비스

1. 목적
- 기존 보고서 관리 > 현장 검색 기능을 독립 조회 서비스로 분리
- 로그인 없이 PC/휴대폰에서 조회 가능
- 현장명/지역/S-N/보고서등급 검색, 상태 필터, 표시항목 설정, 상세조회, 설비수량 3종 및 수량 비교 지원
- PWA 지원: Android/Chrome에서는 '앱처럼 설치' 가능

2. 공개 안전 처리
인터넷 공개를 전제로 아래 정보는 data.js 생성 단계에서 제거했습니다. 화면에서 숨기기만 한 것이 아니므로 브라우저 개발자 도구로도 원본 값을 조회할 수 없습니다.
- 문서작성 담당
- 현장점검원
- 영업 담당
- 관리주체 담당자/연락처/e-mail
- 계약/매출/제본 관련 금액·비율
- 내부 자유기재 '중요 사항'

3. 현재 데이터
- 원본: 확정수량.xlsx
- 현장 수: 5,742개
- 생성일: 2026-09-16

4. 인터넷 배포 (GitHub Pages)
A안: 기존 Inspection 저장소에 public-search 폴더를 만들고 이 폴더 안 파일을 전부 업로드
예상 접속주소: https://nameplate76-bot.github.io/Inspection/public-search/
(현재 저장소의 GitHub Pages가 main/root로 배포된 경우)

B안: 별도 GitHub 저장소를 만들어 이 파일들을 저장소 최상위에 업로드 후 Settings > Pages > Deploy from a branch > main / root 선택

5. 데이터 갱신
- 새 확정수량.xlsx를 이 폴더에 넣습니다.
- Python에 openpyxl이 설치되어 있어야 합니다.
  pip install openpyxl
- 다음 명령 실행:
  python 엑셀데이터_갱신.py
- 생성된 data.js를 GitHub에 다시 올리면 웹 데이터가 갱신됩니다.

6. 로컬 확인
index.html을 더블클릭해도 기본 조회가 동작합니다.
PWA/서비스워커까지 확인하려면 이 폴더에서:
  python -m http.server 8080
브라우저에서 http://localhost:8080 접속

7. 운영 권장
공개형은 읽기 전용으로 유지하십시오. 담당자·전화번호·금액까지 보여야 하는 내부용은 공개형과 분리하고 기존 Supabase 로그인/권한을 사용하는 것이 안전합니다.
