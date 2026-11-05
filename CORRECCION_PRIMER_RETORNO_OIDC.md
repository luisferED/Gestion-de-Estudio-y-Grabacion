> Actualización posterior: el callback ahora lleva a todas las cuentas al calendario /. El panel /admin se conserva mediante Dashboard. Véase DESTINO_CALLBACK_CALENDARIO.md. El resto de este documento conserva la investigación anterior.

# Primera navegación después del callback OIDC

## Resultado y límite

Se corrigió un defecto demostrado de la cadena de redirecciones y el tratamiento web de /admin sin sesión. Las pruebas posteriores A → Salir → B → Salir → A pasaron sin reintentar el login ni recargar para recuperarlo.

**No se reprodujo el 401 intermitente real del despliegue.** Incluso antes del cambio, Chrome local siguió el salto HTTP → HTTPS y envió la cookie al primer /admin HTTPS, obteniendo 200. No sería correcto afirmar que la redirección defectuosa es, por sí sola, la causa definitiva de todos los 401 de producción.

No se inició sesión contra Keycloak corporativo ni se leyó/modificó la base real.

## Defecto demostrado

El callback construía correctamente:
https://grabaciones.ed/admin?auth_success=1

El proxy local de Wrangler reescribía el encabezado Location a:
http://grabaciones.ed/admin?auth_success=1

La cookie emitida era Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200. En Chrome, la petición HTTP del salto no llevaba la cookie Secure. Tras un 301 equivalente al de Traefik, mi reproducción sí envió la cookie a la petición HTTPS y /admin respondió 200.

Los anteriores comprobadores HTTP contenían una conversión automática de http://grabaciones.ed a HTTPS. Eso ocultaba la pérdida de esquema del Location. El comprobador nuevo no corrige ese encabezado ni inyecta cookies: Chrome toma sus propias decisiones.

Evidencias previas: outputs/logout-xo6pxq46 (Location observado) y outputs/logout-f6n2o5m2/chrome/baseline.json (cadena real del navegador bajo transporte controlado).

## Cambios

### Gateway

tools/http-gateway.mjs restaura HTTPS únicamente cuando el Location de respuesta apunta al mismo host/puerto del origen público confiable y Wrangler lo dejó en HTTP. No se reescriben destinos externos de Keycloak, dominios parecidos, URLs con credenciales ni URLs de otros puertos.

La prueba confirma que Set-Cookie conserva exactamente sus valores y encabezados separados. No se cambian Cookie de petición, Host-only, Secure, HttpOnly, SameSite, Path ni expiración. No se confía en X-Forwarded-*.

### /admin

/admin es una página React válida de administración. El Worker comprueba su sesión antes de renderizarla.

- Sesión válida y rol Administrador/Jefe de Operaciones: acceso normal.
- Sesión válida de Producción: continúa 403.
- Navegación web sin sesión: 302 hacia la raíz, donde aparece el inicio de sesión.
- API sin sesión: continúa HTTP 401.

Las respuestas de rechazo no se almacenan en caché. No se redirige automáticamente a Keycloak ni se crea una sesión al visitar /admin.

El callback conserva su destino según el rol: Administración/Operaciones hacia /admin y demás hacia /. Cambiar todos los logins a / habría evitado el control temprano de /admin, pero no habría explicado ni solucionado una cookie ausente; no se usó esa alternativa.

### Callback y cliente

El callback ya esperaba la escritura de auth_sessions antes de responder. Se conserva esa escritura, el mismo hash, binding DB y expiración. Se añade únicamente un diagnóstico no sensible después de la escritura confirmada.

No se detectó un DELETE global al cambiar de cuenta: el logout revoca los tokens recibidos, no las sesiones del nuevo usuario por correo. El cliente espera esa confirmación antes de salir hacia SSO.

Se retiró la recarga automática usada al restaurar una página desde BFCache. Esa restauración ahora comprueba la sesión una sola vez, sin recargar la página. Las respuestas de comprobaciones anteriores se abortan/descartan al cambiar la generación de autenticación. No se introdujeron temporizadores, reintentos de login ni recargas para recuperar un primer 401.

## SameSite y seguridad

SameSite=Strict sigue intacto. En esta reproducción, la cookie recién creada en el callback sí fue enviada en la primera navegación HTTPS válida. No hay evidencia local suficiente para atribuir el fallo intermitente a Strict.

Se conservan state, nonce, PKCE S256, verificación de firma/claims, validación de TLS, Origin estricto, prueba HMAC interna y permisos. No se cambió ningún SQL, migración, usuario, reserva ni rol.

## Pruebas focalizadas

4 pruebas Node aprobadas:
- Restauración de HTTPS público.
- No modificación de Keycloak externo ni hosts parecidos.
- Compatibilidad con desarrollo HTTP.
- Cookies separadas intactas al corregir Location.

30 comprobaciones aprobadas en el escenario Chrome/D1:
- A=Producción activa=1: primer login correcto al calendario.
- A → Salir → B=Administrador activa=1: primera petición /admin con cookie y respuesta 200.
- B → Salir → A: primer login correcto, sin volver a autenticar como mecanismo de recuperación.
- Identidad correcta en cada paso.
- Tres callbacks con Location HTTPS y ningún salto HTTP.
- Cookie Secure/HttpOnly/Strict.
- Logout revoca la sesión; API protegida devuelve 401.
- F5 explícito después de cada logout no recupera al usuario.
- /admin directo sin sesión redirige al login y no autentica.
- Usuarios/roles/reservas sintéticos sin cambios y sesiones de los cambios revocadas.

El navegador utiliza un perfil nuevo. Los destinos públicos HTTPS se interceptan exclusivamente para entregar respuestas del gateway local; los encabezados y cookies los procesa Chrome. No se desactiva validación TLS ni se usa ignore-certificate-errors. Esto prueba la semántica de navegación/cookies HTTPS, pero no certificados, Traefik real o Keycloak corporativo.

TypeScript y compilación de producción terminaron con código 0.

Comandos ejecutados:
~~~sh
node --test tests/first-navigation.test.mjs
python tests/first-navigation.py
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vite/bin/vite.js build
~~~

Evidencia: outputs/logout-fv9s4ycn/results.json, outputs/logout-fv9s4ycn/chrome/result.json y outputs/build-first-navigation.log.

## Evidencia precisa necesaria si ocurre de nuevo en producción

En Chrome DevTools → Network:
1. Active Preserve log antes de A → Salir → B. No recargue ni reintente al aparecer el primer fallo.
2. Capture la respuesta del callback: estado, Location completo con esquema/host/ruta y atributos de Set-Cookie de ed_session_v2.
3. Capture todas las redirecciones intermedias, especialmente HTTP/HTTPS y 301/302/307/308.
4. En la primera petición fallida a /admin, indique si ed_session_v2 aparece en Request Cookies y el motivo exacto de exclusión que muestra Chrome, si existe.
5. Capture estado, Content-Type, Cache-Control y X-ED-Auth-Result de esa respuesta y del primer /api/auth, sin provocar antes una navegación correctiva.

Con este parche, X-ED-Auth-Result distingue:
- session-created en el callback.
- authorized en la página administrativa autorizada.
- cookie-missing si el Worker no recibió la cookie.
- session-unavailable si recibió cookie pero no recuperó una sesión válida.

En Dokploy, comparta los logs de ese intervalo y del contenedor concreto. Los mensajes nuevos son:
- [auth] callback session committed: destino y si el origen es HTTPS.
- [auth] admin login required: cookiePresent y motivo, sin valor de cookie ni identidad.

Confirme cuántos contenedores de este servicio estaban activos y qué volumen montaba cada uno. Si el callback y el primer /admin alcanzan instancias con estados D1 diferentes, una sesión recién creada puede existir solo en una; el laboratorio usa una instancia y no reproduce esa situación.

Consultas de inventario de solo lectura, ejecutadas por el operador:
~~~sh
docker ps --filter label=com.docker.compose.service=gestion-ed --format '{{.ID}} {{.Names}} {{.Image}}'
docker inspect ID_DEL_CONTENEDOR --format '{{json .Mounts}}'
~~~

No comparta valores de cookies, ID/access/refresh tokens, códigos de autorización, Client Secret, state ni nonce. En capturas/HAR o URLs, redacte esos valores manteniendo nombres, atributos, estados, esquema/host/ruta y marcas temporales. No se necesita una copia de los usuarios o reservas.

## Archivos modificados

Producción:
- tools/http-gateway.mjs
- worker/index.ts
- app/api/auth/keycloak/callback/route.ts
- app/auth-context.tsx

Pruebas:
- tests/first-navigation.test.mjs (nuevo)
- tests/first-navigation-browser.mjs (nuevo)
- tests/first-navigation.py (nuevo)
- tests/security.test.mjs, tests/origin-proxy.test.mjs y tests/unicode-session.test.mjs: cargadores aislados adaptados a sessionTokens.
- tests/unicode-session-integration.py: /admin sin sesión ahora espera redirección web; API continúa 401.

Documentación: CORRECCION_PRIMER_RETORNO_OIDC.md.

No hubo push ni despliegue. No se cambiaron base real, migraciones, volumen, roles, permisos ni configuración TLS de Keycloak.
