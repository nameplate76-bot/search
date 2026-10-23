@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "REPORT_SITE_ID=%~1"
if "%REPORT_SITE_ID%"=="" set "REPORT_SITE_ID=7523"
where py >nul 2>&1
if errorlevel 1 (
 python "%~dp0diagnose.py" --site-id "%REPORT_SITE_ID%" > "%~dp0report-diagnostics.txt"
) else (
 py -3 "%~dp0diagnose.py" --site-id "%REPORT_SITE_ID%" > "%~dp0report-diagnostics.txt"
)
type "%~dp0report-diagnostics.txt"
echo.
echo 진단 결과: report-diagnostics.txt (API 키와 NAS 비밀번호는 포함하지 않습니다.)
pause
