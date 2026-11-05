# Despliegue definitivo: https://grabaciones.ed

Servidor Ubuntu/Dokploy: 172.20.16.195. Cliente Keycloak: grabaciones. SQLite/D1 persistente; no PostgreSQL.

## Estado de entrega

Los cambios quedan conservados. No se hizo push ni despliegue. La imagen Docker Linux final **no está validada**: Docker Desktop falló durante las pruebas. La migración 0021 ya pasó las pruebas focalizadas en D1, preservación de reservas e inicialización; la compilación de producción terminó con código 0. Los resultados anteriores y pendientes constan en RESULTADOS_VALIDACION.md. No confunda esta preparación con una certificación de producción.

## GitHub

Esta carpeta proviene de un ZIP y no tiene .git. Para conservar el historial del repositorio, ejecute desde esta carpeta en PowerShell:
~~~powershell
$origen = (Get-Location).Path
$destino = Join-Path $env:TEMP ("gestion-ed-publicar-" + [guid]::NewGuid().ToString("N"))
git clone https://github.com/luisferED/Gestion-de-Estudio-y-Grabacion.git "$destino"
if ($LASTEXITCODE -ne 0) { throw "No se pudo clonar el repositorio" }
robocopy "$origen" "$destino" /E /XD .git node_modules .wrangler dist outputs .next .vinext work backups .codex .agents .aws /XF .env* .dev.vars* *.sqlite* *.db *.log audit-dependencies.json tsconfig.tsbuildinfo
if ($LASTEXITCODE -ge 8) { throw "Falló la copia; no continuar" }
Copy-Item -LiteralPath (Join-Path $origen ".env.example") -Destination $destino -Force
Copy-Item -LiteralPath (Join-Path $origen ".dev.vars.example") -Destination $destino -Force
Set-Location -LiteralPath $destino
git switch -c despliegue/grabaciones-dokploy
git add .
git diff --cached --stat
git diff --cached --name-only
git commit -m "Preparar grabaciones.ed para Dokploy con SQLite persistente"
git push -u origin despliegue/grabaciones-dokploy
~~~
Revise los nombres preparados antes de commit/push. Los comandos son para ejecución manual; no se ejecutaron aquí. Seleccione esa rama en Dokploy o integre el cambio mediante su revisión habitual. No use force push.

## Servicio Dokploy y dominio

En http://172.20.16.195:3000 cree un servicio Docker Compose con ese repositorio/rama y compose.yaml. Mantenga Fresh Volumes desactivado, una sola réplica y la red externa dokploy-network.

En Domains:
- Servicio de destino: gestion-ed.
- Host: grabaciones.ed.
- Path: /.
- Container/Internal Port: 3000.
- HTTPS: activado con certificado válido y redirección HTTP a HTTPS.

DNS de grabaciones.ed debe resolver hacia 172.20.16.195 para los usuarios. Si es un dominio interno, prepare un certificado corporativo confiable; no se ha verificado emisión automática. El puerto 3000 del contenedor es HTTP interno detrás del proxy TLS.

Compose usa expose 3000 y **no publica 6680**. No confunda el puerto 3000 del panel Dokploy con el puerto 3000 interno de este contenedor: no hay conflicto porque no se publica en el host. No cambie ni detenga otros servicios. Verifique acceso del proxy a dokploy-network y que los puertos HTTPS/HTTP del proxy estén configurados por su responsable.

## Environment

~~~dotenv
KEYCLOAK_ISSUER=http://172.20.16.180:8080/realms/REEMPLAZAR_REALM
KEYCLOAK_CLIENT_ID=grabaciones
KEYCLOAK_CLIENT_SECRET=REEMPLAZAR_CON_SECRET_REAL_EN_DOKPLOY
KEYCLOAK_PUBLIC_ORIGIN=https://grabaciones.ed
SMTP_ENCRYPTION_KEY=
~~~
Identifique el realm real. Para SMTP autenticado, genere una clave con openssl rand -base64 32 y guárdela solo en Environment; consérvela para restauraciones. No se inventaron credenciales SMTP.

Compose ya fija:
~~~dotenv
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
D1_STATE_DIR=/data/state
LOCAL_AUTH_BYPASS=false
SEED_DEMO_DATA=false
~~~
No es necesario duplicar estos valores en Environment. El arranque desactiva el explorador de Wrangler y observabilidad y deja workerd/relay en loopback.

## Inicialización y primer administrador

Al desplegar, el arranque crea la base D1 local exactamente en el estado persistido /data/state, aplica las migraciones aprobadas pendientes y verifica integridad. No hace falta ejecutar wrangler migrations apply manualmente. El volumen es gestion_ed_dokploy_data, montado en /data. No carga datos operativos de ejemplo.

Tras el primer arranque, desde la carpeta Compose del servicio y con su mismo Environment:
~~~sh
docker compose stop gestion-ed
docker compose run --rm --no-deps gestion-ed sh tools/create-admin.sh correo.corporativo@empresa.example
docker compose up -d gestion-ed
~~~
Reemplace el correo. No hay contraseña local: la cuenta debe existir en Keycloak con correo verificado. El script valida el correo, usa parámetros SQL y solo crea/actualiza esa cuenta. Requiere aplicación detenida y control administrativo de Docker.

## Operación manual y pendientes de aceptación

Comandos para cuando decida validar/desplegar, no ejecutados automáticamente:
~~~sh
docker compose config --quiet
docker compose build gestion-ed
docker compose up -d gestion-ed
docker compose ps
docker compose logs --tail=100 gestion-ed
curl -f https://grabaciones.ed/api/health
docker compose exec gestion-ed python3 tools/db-admin.py inspect
~~~
El healthcheck consulta DB; esperar estado healthy. Debe rechazarse el acceso sin sesión a /api/users y bloquearse /cdn-cgi/local/explorer/api/d1/database. Pruebe el cliente corporativo real y confirme ejecución Linux antes de habilitar usuarios.

Para backup y reinicio:
~~~sh
docker compose exec gestion-ed sh tools/backup.sh
docker compose restart gestion-ed
~~~
Para actualizar, haga backup externo, construya la nueva imagen y detenga solo este servicio antes de reemplazarlo, evitando dos runtimes sobre SQLite. No use Fresh Volumes, down -v, volume rm ni prune.

La guía SQLITE_PERSISTENCIA_BACKUP.md detalla restauración. KEYCLOAK_DOKPLOY.md contiene los valores del cliente. La integración real con Exchange, DNS, TLS, issuer y red corporativa sigue pendiente.

Fuente del manejo de Compose/Environment: https://docs.dokploy.com/docs/core/docker-compose
