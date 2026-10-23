@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0config.json" (
 echo 기존 연결 프로그램의 config.json이 있는 폴더에 넣고 실행하세요.
 pause
 exit /b 1
)
where py >nul 2>&1
if errorlevel 1 (
 python "%~dp0server.py" --config "%~dp0config.json"
) else (
 py -3 "%~dp0server.py" --config "%~dp0config.json"
)
pause
