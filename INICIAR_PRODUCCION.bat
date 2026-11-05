@echo off
cd /d "%~dp0"
title Gestion de Uso de Estudios y Grabaciones ED

set "PUERTO=3000"
if exist ".dev.vars" (
  for /f "usebackq tokens=1,* delims==" %%A in (".dev.vars") do (
    if /I "%%A"=="PORT" set "PUERTO=%%B"
  )
)

if not exist "node_modules" (
  echo El servidor todavia no fue preparado.
  echo Ejecute primero PREPARAR_SERVIDOR.bat
  pause
  exit /b 1
)

if not exist ".dev.vars" (
  echo Falta el archivo .dev.vars con la configuracion de Keycloak.
  echo Ejecute PREPARAR_SERVIDOR.bat
  pause
  exit /b 1
)

if not exist "dist\server\wrangler.json" (
  echo Falta la compilacion de produccion.
  echo Ejecute primero PREPARAR_SERVIDOR.bat
  pause
  exit /b 1
)

echo Iniciando Gestion de Uso de Estudios y Grabaciones ED...
start "Gestion Estudios ED - Servidor" /min cmd /c "npm.cmd run start > servidor-produccion.log 2>&1"
timeout /t 7 /nobreak >nul
start "" "http://localhost:%PUERTO%"
exit
