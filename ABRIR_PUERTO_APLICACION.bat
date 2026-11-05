@echo off
setlocal
cd /d "%~dp0"
set "PUERTO=3000"
if exist ".dev.vars" (
  for /f "usebackq tokens=1,* delims==" %%A in (".dev.vars") do (
    if /I "%%A"=="PORT" set "PUERTO=%%B"
  )
)

echo Este paso requiere abrir la consola como Administrador.
netsh advfirewall firewall add rule name="Gestion Estudios ED - Puerto %PUERTO%" dir=in action=allow protocol=TCP localport=%PUERTO% profile=any
if errorlevel 1 (
  echo No se pudo crear la regla de Firewall. Abra este archivo como Administrador.
  pause
  exit /b 1
)
echo Puerto %PUERTO% habilitado para la red interna.
pause
