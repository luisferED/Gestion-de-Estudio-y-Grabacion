@echo off
setlocal
title Verificar Gestion de Estudios ED

set "PUERTO=3000"
if exist ".dev.vars" (
  for /f "usebackq tokens=1,* delims==" %%A in (".dev.vars") do (
    if /I "%%A"=="PORT" set "PUERTO=%%B"
  )
)
set "BASE=http://127.0.0.1:%PUERTO%"
if not "%~1"=="" set "BASE=%~1"
echo.
echo ================================================
echo  VERIFICACION DEL SERVIDOR
echo ================================================
echo.

for /f %%S in ('curl.exe -s -o NUL -w "%%{http_code}" "%BASE%/api/auth"') do set "AUTH_STATUS=%%S"
for /f %%S in ('curl.exe -s -o NUL -w "%%{http_code}" "%BASE%/api/auth/keycloak/login"') do set "LOGIN_STATUS=%%S"

echo API de sesion:       %AUTH_STATUS%  ^(correcto: 401 sin sesion^)
echo Inicio con Keycloak: %LOGIN_STATUS% ^(correcto: 302^)
echo.

if "%AUTH_STATUS%"=="401" if "%LOGIN_STATUS%"=="302" (
  echo RESULTADO: El despliegue y la ruta de Keycloak estan funcionando.
  pause
  exit /b 0
)

echo RESULTADO: El servidor no esta usando la compilacion correcta.
echo Revise servidor-produccion.log y vuelva a ejecutar PREPARAR_SERVIDOR.bat.
pause
exit /b 1
