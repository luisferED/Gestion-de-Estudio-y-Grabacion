# Corrección puntual del Origin en logout detrás de Traefik

## Causa exacta reproducida

El mensaje «Origen de petición no autorizado» se generaba en worker/index.ts, antes de ejecutar DELETE /api/auth. El Worker comparaba el encabezado Origin recibido con KEYCLOAK_PUBLIC_ORIGIN.

La configuración pública era correcta. El proxy de desarrollo de Wrangler, entre el gateway y el Worker, ejecuta rewriteUrlRelatedHeaders: reescribe encabezados que contienen el host público al origen interno, incluido el protocolo. Por eso la observación de Chrome y la del Worker eran diferentes.

Una prueba local reprodujo la cadena HTTP interna y registró:
~~~json
{"url":"http://grabaciones.ed/api/auth","origin":"http://grabaciones.ed","expected":"https://grabaciones.ed"}
~~~
El navegador había enviado Origin: https://grabaciones.ed y Host: grabaciones.ed. El 403 ocurría antes de revocar SQLite, por lo que la sesión permanecía activa. No era un fallo de credenciales Keycloak ni se corrigió aceptando el origen HTTP interno.

Evidencia: outputs/origin-probe-8iclckxh/observed.json. No se accedió al servidor Ubuntu ni se modificó su configuración.

## Solución y protección CSRF

1. El gateway compara el Origin original con el origen exacto de KEYCLOAK_PUBLIC_ORIGIN, antes del proxy Wrangler. Origen ajeno, ausente o null: 403.
2. El gateway elimina cualquier prueba privada enviada por el cliente y los encabezados Forwarded/X-Forwarded-*. No deriva el origen confiable de esos encabezados, de Host ni del Referer.
3. El arranque genera una clave aleatoria interna por ejecución. Se comparte únicamente entre gateway y Worker mediante el mecanismo de secretos de Wrangler; no se guarda en Git ni requiere una nueva variable del operador.
4. El gateway firma una prueba HMAC de origen, método, ruta/query y marca temporal. El encabezado contiene datos codificados, de modo que Wrangler no lo reescribe como una URL.
5. Con esa clave configurada, el Worker exige firma válida, origen exacto, método/ruta coincidentes y antigüedad máxima de 30 segundos. No acepta una cabecera privada arbitraria ni un Origin interno como alternativa.
6. Si no existe origen público válido, las operaciones de escritura fallan de forma explícita y cerrada; no se usa request.url.origin como valor de producción.

No se modificaron la ruta DELETE, reservas, roles, usuarios, esquema, migraciones, compose.yaml, Dockerfile ni el montaje del certificado corporativo. Se conserva el logout local y OIDC ya implementado.

## Archivos modificados en esta corrección

Producción:
- worker/index.ts
- tools/http-gateway.mjs
- tools/container-start.mjs
- tools/request-origin.mjs (nuevo)

Pruebas:
- tests/origin-proxy.test.mjs (nuevo)
- tests/logout-origin-proxy.py (nuevo)
- tests/logout-integration.py (configuración privada del gateway de prueba)
- tests/integration-native.py (misma adaptación de su arranque)
- tests/security.test.mjs (resolución del helper compartido)

Documentación:
- CORRECCION_ORIGIN_TRAEFIK.md

## Resultados reales

- 6 pruebas focalizadas aprobadas: Origin HTTPS con cabecera reescrita HTTP; rechazo de dominio ajeno/prueba ausente o falsa; firma vinculada a clave/método/ruta/origen; configuración ausente; permisos Producción; y eliminación/reemplazo de cabeceras falsas en el gateway.
- 59 comprobaciones HTTP/D1 aprobadas con alice@example.test y bob@example.test, usando el mismo almacén de cookies.
- Origen público https://grabaciones.ed: logout permitido con sesión válida.
- Origin https://evil.test, incluso con X-Forwarded-* y prueba falsificados: 403 y sesión legítima conservada.
- Logout válido: fila eliminada en SQLite, cookies Secure expiradas y sesión SSO del proveedor de prueba cerrada mediante endpoint descubierto e id_token_hint.
- Tres recargas por usuario: sin recuperar sesión. Reutilizar ambos tokens antiguos en API: 401.
- Segundo login: identidad bob@example.test, sin recuperar a alice.
- /api/users y /api/staff: 403 legítimo para produccion. No se ampliaron permisos.
- TypeScript: código 0.
- Compilación de producción: código 0.

Comandos ejecutados:
~~~sh
node --test tests/origin-proxy.test.mjs
python tests/logout-origin-proxy.py
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vite/bin/vite.js build
~~~

Evidencia: outputs/logout-8_1t4c1b/results.json y outputs/build-origin-proxy.log. Las pruebas usaron URL lógica HTTPS y cookies Secure, con transporte HTTP sobre loopback para simular la terminación TLS de Traefik. Las recargas fueron HTTP controladas, no pulsaciones F5 automatizadas en Chrome. El SSO corporativo y la imagen Linux desplegada no se probaron aquí.

## Publicar solamente estos cambios

Esta carpeta local no tiene .git. Si ya tiene un clon de la rama, copie en él los archivos listados arriba y use los comandos git del final. Para publicar desde esta carpeta ZIP con el historial existente, ejecute en PowerShell:
~~~powershell
$origen = (Get-Location).Path
$destino = Join-Path $env:TEMP ("gestion-ed-origin-" + [guid]::NewGuid().ToString("N"))
git clone --single-branch --branch despliegue/grabaciones-dokploy https://github.com/luisferED/Gestion-de-Estudio-y-Grabacion.git "$destino"
if ($LASTEXITCODE -ne 0) { throw "Falló la clonación" }
$archivos = @(
  "worker/index.ts",
  "tools/http-gateway.mjs",
  "tools/container-start.mjs",
  "tools/request-origin.mjs",
  "tests/origin-proxy.test.mjs",
  "tests/logout-origin-proxy.py",
  "tests/logout-integration.py",
  "tests/integration-native.py",
  "tests/security.test.mjs",
  "CORRECCION_ORIGIN_TRAEFIK.md"
)
foreach ($archivo in $archivos) {
  $objetivo = Join-Path $destino $archivo
  New-Item -ItemType Directory -Path (Split-Path -Parent $objetivo) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $origen $archivo) -Destination $objetivo -Force
}
Set-Location -LiteralPath $destino
git add -- worker/index.ts tools/http-gateway.mjs tools/container-start.mjs tools/request-origin.mjs tests/origin-proxy.test.mjs tests/logout-origin-proxy.py tests/logout-integration.py tests/integration-native.py tests/security.test.mjs CORRECCION_ORIGIN_TRAEFIK.md
git diff --cached --stat
git commit -m "Corregir CSRF de logout detras del proxy Wrangler y Traefik"
git push origin despliegue/grabaciones-dokploy
~~~
No copie .env, certificados privados, bases ni outputs. No haga force push. Esta corrección presupone que la rama ya contiene el logout y la migración aditiva 0022 preparados anteriormente; aquí no se cambió ninguna migración.

## Actualizar sin perder SQLite

En Dokploy confirme repositorio/rama despliegue/grabaciones-dokploy, Fresh Volumes desactivado, una sola réplica y volumen gestion_ed_dokploy_data montado en /data. Conserve las variables actuales, el certificado montado y el dominio hacia gestion-ed:3000. ED_GATEWAY_SECRET se genera automáticamente: no añada un valor a Environment.

Antes de actualizar, desde la carpeta Compose del servicio y con su Environment:
~~~sh
docker compose exec -T gestion-ed sh tools/backup.sh
docker compose stop gestion-ed
~~~
Copie el backup fuera del host según SQLITE_PERSISTENCIA_BACKUP.md. En Dokploy ejecute Deploy para obtener la rama actualizada y reconstruir la imagen. El servicio debe estar detenido durante el reemplazo, evitando dos runtimes simultáneos sobre el volumen.

Después:
~~~sh
docker compose ps
docker compose logs --tail=80 gestion-ed
curl -f https://grabaciones.ed/api/health
~~~
Los comandos Compose deben ejecutarse únicamente en el proyecto real de Dokploy, no en un clon separado que cree otro servicio o use otro Environment. Alternativamente detenga y despliegue ese servicio desde el panel. No use Fresh Volumes, down -v, volume rm ni prune. La actualización conserva /data/state; no hay migración nueva en este parche.

No hubo push, despliegue, cambios de datos reales ni reparación de Docker Desktop.
