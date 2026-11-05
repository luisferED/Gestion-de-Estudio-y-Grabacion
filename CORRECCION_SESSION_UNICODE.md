# Corrección puntual de sesiones importadas y nombres Unicode

## Causa que se pudo demostrar

Se reprodujo exactamente callback 302 con auth_success=1, seguido de /api/auth 401 y /admin 401, con una cookie válida y una fila de sesión presente. En la base temporal, el usuario importado tenía active='true' de tipo TEXT.

El callback comprobaba !user.active: el texto 'true' es verdadero en JavaScript. Las dos consultas que recuperaban sesiones, en cambio, exigían u.active=1. Esa representación importada no coincidía, por lo que la sesión recién creada resultaba inaccesible. El mismo defecto hacía que el texto 'false' pasara la comprobación inicial del callback, aunque después la API lo rechazara.

La corrección da una interpretación única y estricta a los flags: 1/true y sus representaciones de texto se consideran activos; 0/false, vacíos y valores no reconocidos se rechazan. No se modifica active en SQLite, no se activan cuentas deshabilitadas ni se cambia ningún rol.

**Límite de la demostración:** no se leyó la base real con 36 usuarios y 200 reservas. Por tanto, no se afirma que sus filas tengan efectivamente active de tipo TEXT; esa es la condición exacta reproducida que explica los mismos logs. Si persiste el fallo en producción, habrá que confirmar esa representación mediante una consulta de solo lectura y revisar si el navegador presenta la cookie; no corresponde atribuirlo sin evidencia a la ñ.

## Unicode y cookies

Con active=1, una cuenta llamada María Muñoz ya consiguió /api/auth 200 y /admin 200 en la reproducción previa: la ñ sola no demostró causar el 401. El transporte del nombre sin codificar sí generaba advertencias de encabezado no ASCII. Ahora se usa una envoltura ASCII con percent-encoding UTF-8 y marcador de codificación; el consumidor de bitácora recupera el nombre exacto, incluso ñ, tildes, guiones Unicode y otros alfabetos.

Los encabezados externos x-ed-user-* siguen eliminándose en gateway y Worker antes de reconstruirse desde la sesión de SQLite. No se confía en un nombre, rol o marcador de codificación enviado por el cliente.

El callback enviaba dos Set-Cookie para ed_session_v2, primero vencida y luego nueva. Ahora emite una sola cookie de sesión, conservando:
- Host-only, sin Domain.
- Path=/.
- HttpOnly.
- Secure cuando el origen público es HTTPS.
- SameSite=Strict.
- Max-Age=43200 y la misma expiración efectiva de la sesión almacenada.

Se mantiene la limpieza de cookies heredadas y temporales OIDC. No se rebajó SameSite: una prueba de redirección entre sitios en Chrome mostró que Strict funciona con esta cookie recién creada.

## Recuperación de sesión y errores

lib/auth-session.ts es el único resolvedor usado por /api/auth y el Worker, incluido /admin. Lee las cookies de sesión, calcula el mismo hash SHA-256 que guarda el callback, valida expiración y estado activo, y conserva los datos/rol del usuario. Una cookie obsoleta duplicada no oculta una segunda cookie válida. Cookies inválidas o de usuarios deshabilitados producen 401.

Los errores operativos durante la recuperación o construcción de encabezados ahora producen 503, no un falso mensaje de sesión inexistente 401. No se imprimen tokens ni secretos.

Origin/HMAC no causaba el rechazo de estos GET: la prueba de Origin se ejecuta en operaciones mutables. Se conservó intacta. Los casos de logout con Origin ajeno siguen devolviendo 403.

## Pruebas realizadas

- 5 pruebas focalizadas Node: Unicode completo con transporte ASCII, flags importados válidos/inválidos, sustitución de identidad falsa, denegación de admin a Producción y diferenciación de errores operativos.
- 79 comprobaciones HTTP/D1: login/callback/cookie, /api/auth 200, /admin 200 para administrador, /admin 403 para Producción, cookie inválida o usuario deshabilitado 401, cookies duplicadas, nombres Unicode, logout, SSO de prueba, recargas y rechazo de tokens anteriores.
- Base sintética con 36 usuarios y 200 reservas: todas sus filas y roles se compararon antes/después y permanecieron sin cambios. No es una copia ni validación de los datos reales.
- Chrome headless, perfil nuevo e independiente: 10 comprobaciones aprobadas. Login entre sitios con administrador activo importado como texto, panel, nombre exacto, cookie Strict/HttpOnly, clic real en Salir, recarga de página (Page.reload con caché ignorada), 401 posterior y segundo usuario con nombre Unicode, rol Producción y acceso administrativo rechazado.
- Prueba HTTPS lógica sobre HTTP interno: atributos Secure y cookie a través de gateway/Worker verificados. La prueba de navegador fue sobre hosts locales HTTP distintos; no se contactó Keycloak corporativo.
- No se detectó la advertencia non-ASCII de x-ed-user-name en la integración corregida.
- TypeScript y compilación de producción: código 0.

Comandos:
~~~sh
node --test tests/unicode-session.test.mjs
python tests/unicode-session-integration.py
python tests/unicode-browser.py
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vite/bin/vite.js build
~~~

Evidencia local ignorada por Git: outputs/logout-ywd3hzf7 (reproducción del flag importado), outputs/logout-50v2el98/results.json (79 comprobaciones), outputs/logout-2jg1167p/chrome/result.json (10 casos Chrome) y outputs/build-unicode-session.log.

## Archivos de producción

- lib/auth-session.ts (nuevo): resolución común y flags activos.
- lib/request-identity.ts (nuevo): codificación/decodificación del nombre.
- lib/auth-cookies.ts: separar limpieza heredada de la cookie nueva.
- worker/index.ts: resolvedor común, nombre codificado y errores 503.
- app/api/auth/route.ts: resolvedor común.
- app/api/auth/keycloak/callback/route.ts: flag activo estricto y una cookie de sesión.
- app/api/reservations/purge/route.ts: únicamente decodificar el nombre de actor para bitácora; no se cambió autorización ni operación sobre reservas.

Pruebas nuevas: tests/unicode-session.test.mjs, tests/unicode-session-integration.py, tests/browser-session-flow.mjs y tests/unicode-browser.py. Los cargadores aislados de tests/security.test.mjs, tests/origin-proxy.test.mjs y tests/logout.test.mjs se adaptaron al nuevo helper.

## Actualización de la rama

Esta carpeta no tiene .git. Copie exclusivamente los archivos listados a un clon actualizado de despliegue/grabaciones-dokploy. No copie outputs, perfiles Chrome, .env, certificados ni bases. En ese clon:
~~~sh
git switch despliegue/grabaciones-dokploy
git add -- lib/auth-session.ts lib/request-identity.ts lib/auth-cookies.ts worker/index.ts app/api/auth/route.ts app/api/auth/keycloak/callback/route.ts app/api/reservations/purge/route.ts tests/unicode-session.test.mjs tests/unicode-session-integration.py tests/browser-session-flow.mjs tests/unicode-browser.py tests/security.test.mjs tests/origin-proxy.test.mjs tests/logout.test.mjs CORRECCION_SESSION_UNICODE.md
git diff --cached --stat
git commit -m "Corregir sesiones importadas y encabezados de identidad Unicode"
git push origin despliegue/grabaciones-dokploy
~~~

No hay migraciones nuevas ni cambios en archivos SQL. No importe ni restaure la base para aplicar este parche. Conserve volumen gestion_ed_dokploy_data, /data/state, Fresh Volumes desactivado, los valores de Environment actuales y el certificado corporativo. La configuración corporativa indicada es:
- KEYCLOAK_ISSUER=https://keycloak.grupoeldeber-corp.com/realms/grupoeldeber-corp.com
- KEYCLOAK_CLIENT_ID=grabaciones
- KEYCLOAK_PUBLIC_ORIGIN=https://grabaciones.ed

No se cambió Keycloak, no se alteró la base real, no hubo push ni despliegue y no se desactivaron autenticación, Origin o CSRF.
