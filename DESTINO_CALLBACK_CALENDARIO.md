# Destino del callback: calendario como entrada principal

## Qué se verificó

/admin es una ruta web real. app/admin/page.tsx contiene el panel de administración: resumen, grabaciones, programas, personal, turnos, usuarios, correo SMTP y métricas. Debe conservarse.

El calendario está en app/page.tsx, ruta /. Desde allí existe el botón Dashboard que navega a /admin para los perfiles que corresponden. No se cambió ese botón, sus estilos ni los permisos del Worker o de las API.

Las rutas tienen controles diferentes:
- / sirve la página inicial y AuthGate comprueba la sesión con /api/auth antes de mostrar el calendario.
- /admin consulta primero la sesión en el Worker y exige rol administrador/jefe_operaciones antes de servir el panel.

Por ello, ver calendario autenticado al navegar a / sin volver a entrar en Keycloak demuestra que la sesión es recuperable en ese contexto; no demuestra que /admin sea una ruta inexistente ni justifica alterar SQLite.

El mensaje JSON 401 proviene del guard de autenticación previo al renderizado, no del panel React. La corrección local anterior ya contempla /admin sin sesión como navegación web con 302 al login, conservando HTTP 401 en las API. Si una instancia desplegada sigue devolviendo aquel JSON en /admin, es necesario verificar la versión/instancia que atendió la petición.

## Cambio concreto

app/api/auth/keycloak/callback/route.ts ahora termina todo login correcto en:
https://grabaciones.ed/?auth_success=1

Se aplica a todos los roles. El calendario es la entrada principal; el administrador accede posteriormente al panel mediante Dashboard. La sesión se escribe antes de emitir Set-Cookie y la redirección, como antes.

No se modificó la autenticación del panel. Un usuario Producción continúa sin acceso a /admin. El destino común no le otorga privilegios ni elimina funciones administrativas.

No se introdujeron retrasos, reintentos de login o recargas para completar la autenticación. Tampoco se cambió SQLite, Keycloak, active, roles, permisos, cookies ni migraciones en este ajuste.

Este cambio define correctamente la navegación inicial del producto a partir de la nueva evidencia. No se presenta como una demostración de por qué producción omitió o no recuperó la sesión en aquel primer /admin; esa causa concreta aún requiere la traza de la petición afectada.

## Pruebas realizadas

40 comprobaciones aprobadas en Chrome real con perfil aislado y D1 temporal:
- Cuenta A, Producción activa=1: primer login al calendario, identidad y rol correctos.
- A → Salir → B, Administrador activo=1: primer login al calendario, identidad y rol correctos.
- El administrador pulsa el botón Dashboard existente: /admin responde 200 y recibe la cookie de sesión.
- B → Salir → A: primer login al calendario, sin reautenticación correctiva.
- Producción sigue recibiendo 403 al solicitar /admin.
- Callback y redirección conservan HTTPS; no hay salto a HTTP.
- Se mantienen Secure, HttpOnly y SameSite=Strict.
- Logout invalida la sesión; API protegida devuelve 401 y F5 posterior no recupera al usuario.
- /admin directo sin sesión redirige al login sin autenticar.
- Los usuarios y roles temporales se conservaron; no se cambiaron reservas y las sesiones de prueba quedaron revocadas.

Se usó el mismo escenario de Chrome con URL HTTPS lógica y transporte interceptado hacia el gateway local, sin desactivar TLS. No se autenticó contra Keycloak corporativo ni se ejecutó ningún cambio en el despliegue.

TypeScript y compilación de producción terminaron con código 0.

Comandos ejecutados:
~~~sh
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vite/bin/vite.js build
python tests/first-navigation.py
~~~

Evidencia: outputs/logout-h665l7sb/results.json, su carpeta chrome/result.json y outputs/build-calendar-home.log.

## Archivos de este ajuste

- app/api/auth/keycloak/callback/route.ts: destino común /.
- tests/first-navigation-browser.mjs: calendario como primer destino para A/B/A y acceso administrativo explícito mediante Dashboard.
- tests/browser-session-flow.mjs: mismo contrato de navegación.
- DESTINO_CALLBACK_CALENDARIO.md: esta explicación.

También se conservan, sin publicar automáticamente, las correcciones locales de la revisión anterior en tools/http-gateway.mjs, worker/index.ts y app/auth-context.tsx. Al preparar la actualización desde e82260b, no omita esos archivos si aún no están en su rama: mantienen HTTPS, respuesta web apropiada de /admin sin sesión y ausencia de recargas automáticas.

Los informes anteriores registran el destino condicionado por rol que existía entonces; este documento define el comportamiento actual.

No hubo push, despliegue ni cambios en la base real.
