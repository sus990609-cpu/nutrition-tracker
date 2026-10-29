@echo off
rem Nutrition Tracker - 停止本地服务（8080 端口）
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; 'stopped'"
pause