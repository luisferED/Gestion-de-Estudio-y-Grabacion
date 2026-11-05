@echo off
setlocal
cd /d "%~dp0"
set "PUERTO=3000"
if exist ".dev.vars" (
  for /f "usebackq tokens=1,* delims==" %%A in (".dev.vars") do (
    if /I "%%A"=="PORT" set "PUERTO=%%B"
  )
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PUERTO%" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
echo Sistema detenido en el puerto %PUERTO%.
timeout /t 2 /nobreak >nul
