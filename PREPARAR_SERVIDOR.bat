@echo off
setlocal
cd /d "%~dp0"
title Preparar Gestion de Estudios ED

echo.
echo ================================================
echo  PREPARACION DEL SERVIDOR NUEVO - EL DEBER
echo ================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Instale Node.js 22 LTS antes de continuar.
  pause
  exit /b 1
)

echo [1/4] Instalando dependencias...
call npm.cmd ci
if errorlevel 1 goto :error

if not exist ".dev.vars" (
  copy /y ".dev.vars.example" ".dev.vars" >nul
  echo.
  echo IMPORTANTE: Se creo .dev.vars con datos de ejemplo.
  echo Edite ese archivo con los datos reales de Keycloak y vuelva a ejecutar este instalador.
  notepad ".dev.vars"
  pause
  exit /b 2
)

findstr /I /C:"IP-O-NOMBRE-KEYCLOAK" /C:"IP-O-NOMBRE-DEL-NUEVO-SERVIDOR" /C:"cliente-de-la-aplicacion" /C:"secreto-entregado-por-ti" ".dev.vars" >nul
if not errorlevel 1 (
  echo.
  echo ERROR: Complete los datos reales de Keycloak en .dev.vars antes de continuar.
  notepad ".dev.vars"
  pause
  exit /b 2
)

echo [2/4] Creando y actualizando la base de datos nueva...
call npm.cmd run db:migrate:local
if errorlevel 1 goto :error

echo [3/4] Compilando la aplicacion...
call npm.cmd run build
if errorlevel 1 goto :error

echo [4/4] Preparacion terminada.
echo.
echo Siguiente paso: ejecute CONFIGURAR_PRIMER_ADMINISTRADOR.bat.
echo Luego use INICIAR_PRODUCCION.bat para poner el sistema en funcionamiento.
pause
exit /b 0

:error
echo.
echo ERROR: No se pudo completar la preparacion.
echo Revise el mensaje anterior y vuelva a intentarlo.
pause
exit /b 1
