@echo off
rem 서버가 꺼져 있으면 창 없이 켜고, 브라우저로 스튜디오를 연다
cd /d "%~dp0"
wscript "%~dp0start-studio.vbs"
timeout /t 2 /nobreak >nul
start "" http://localhost:4321/
