@echo off
rem Nutrition Tracker - 启动本地服务（双击运行，窗口不要关闭）
cd /d "%~dp0"
if not exist ".env" (
  echo [ERROR] .env not found.
  echo Copy .env.example to .env and set KIMI_API_KEY, then run again.
  pause
  exit /b 1
)
echo Starting Nutrition Tracker at http://127.0.0.1:8080 ...
start "" "http://127.0.0.1:8080"
:loop
node server.js
echo.
echo [Nutrition Tracker] server exited. Restart in 5s (press Ctrl+C to stop)...
timeout /t 5 /nobreak >nul
goto loop