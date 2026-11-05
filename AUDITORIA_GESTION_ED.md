# Auditoría de Gestión de Estudios ED

Fecha: 5 de noviembre de 2026. Alcance: archivos locales de esta instalación. No se hizo push, despliegue, cambio en Keycloak ni operación sobre el servidor Ubuntu u otras bases.

## Dictamen

El código está preparado para una validación de despliegue con SQLite persistente. **Todavía no debe darse por listo para producción ni para usuarios reales.** Se verificaron compilación nativa, TypeScript, seguridad y 105 comprobaciones de integración previas al último ajuste de concurrencia 0021 con D1 local y un proveedor OIDC de prueba. La imagen final requiere construcción y ejecución Linux: Docker Desktop dejó de responder durante esta sesión. El cliente corporativo, las conexiones reales y HTTPS también están pendientes. Véase RESULTADOS_VALIDACION.md.

## Funciones y arquitectura

React 19 y App Router muestran agenda, reservas, programación fija de radio/estudio/exteriores, aprobaciones y denegaciones, reprogramaciones, cancelaciones, asignación de operadores y edición, turnos semanales y extraordinarios, personal, inventario, métricas, auditoría, usuarios, fotografías/logotipos y configuración/notificaciones SMTP.

Vite y Vinext compilan el Worker. Los módulos de servidor obtienen DB desde cloudflare:workers; Drizzle usa drizzle-orm/d1. D1 local utiliza SQLite dentro de Miniflare/workerd. No se añadió PostgreSQL ni se cambió el adaptador de base de datos.

El contenedor ejecuta:
1. Supervisor y bloqueo exclusivo del estado.
2. Inicialización local con Wrangler, migraciones aprobadas y comprobación SQLite.
3. Wrangler/workerd con el build en 127.0.0.1:3001.
4. Relay SMTP Node en 127.0.0.1:3127.
5. Entrada HTTP Node en 0.0.0.0:3000, enrutada por Dokploy como https://grabaciones.ed.

El gateway bloquea rutas de herramientas y acepta rutas de aplicación y archivos públicos existentes. El explorador local y observabilidad de Wrangler se desactivan. No se publica inspector ni relay.

Cloudflare documenta D1 local como entorno de desarrollo; ejecutarlo permanentemente en Docker no ofrece las garantías operativas del D1 administrado. Se conserva esta arquitectura por solicitud explícita, con una sola réplica, bloqueo, backup y validación previa. Vinext también advierte sobre compatibilidad de cargas concretas. Fuentes: [D1 local](https://developers.cloudflare.com/d1/best-practices/local-development/), [estado local](https://developers.cloudflare.com/workers/local-development/local-data/), [Vinext](https://github.com/cloudflare/vinext).

## Hallazgos y soluciones

| Hallazgo | Solución |
|---|---|
| Importación obligatoria de .openai/hosting.json ausente | Vite usa wrangler.local.jsonc, que declara el binding real DB. Sin bindings R2 o IMAGES inventados. |
| Scripts con set de Windows | build usa vite build; migración de desarrollo es multiplataforma; Ubuntu tiene scripts sh/Python/Node. |
| Un servidor Node ordinario no proporciona DB | Runtime conserva workerd y el build Worker. |
| Riesgo de usar carpetas de estado diferentes | Inicialización, runtime y herramientas comparten D1_STATE_DIR=/data/state y verifican el archivo real. |
| Migraciones no idempotentes como SQL suelto | Historial ed_migrations, hash, transacciones por archivo y manifiesto de aprobación. Nunca repetir a mano ALTER TABLE. |
| Metadatos Drizzle atrasados | Se completó journal hasta 0021 y snapshot actual. Drizzle generate informa que no hay diferencias. |
| Faltaban auth_sessions y dos columnas duty_assignments en SQL | Migración 0020 aditiva. Los 20 SQL originales se conservan. |
| DDL repetido y errores silenciados en peticiones | Se quitaron llamadas de actualización del esquema; el arranque aplica el esquema antes de servir. |
| Productor podía modificar usuarios y configuración central | Administración central limitada; solo Administrador modifica usuarios/roles. |
| Cabeceras de identidad externas | Se eliminan y se reconstruyen exclusivamente desde una sesión activa de SQLite. |
| Explorador D1 del servidor Wrangler | Desactivado y bloqueado por un gateway; Wrangler escucha solo en loopback. |
| CSRF y cuerpos sin límites | Origin exacto, JSON para cuerpos no vacíos y máximo 5 MiB; el gateway también limita lectura. |
| Cookies sin Secure en HTTPS | Secure según KEYCLOAK_PUBLIC_ORIGIN, HttpOnly y SameSite. HTTP queda limitado a pruebas. |
| Validación OIDC incompleta | Firma RS256, issuer/audience/azp, exp/iat/nbf, nonce, subject, email_verified y coincidencia con UserInfo. |
| Sesiones reutilizables desde un backup | Tokens aleatorios se almacenan como hash SHA-256; expiración máxima 12 horas, usuario activo verificado en cada petición. |
| Logout solo local | Revoca sesión local y ofrece redirección al end_session_endpoint de Keycloak. |
| GET insertaban datos de ejemplo | Desactivado en el contenedor. Una nueva instalación no recibe personas, reservas ni programas históricos. |
| Operadores asignados desde nombres fijos del código | La asignación consulta personal activo y turnos persistidos. La grilla fija se toma de SQLite. |
| Bootstrap Windows interpolaba SQL | Método Python con validación de correo, parámetros SQL y bloqueo offline; bat antiguo queda deshabilitado. |
| TLS SMTP desactivable y alternativa PowerShell | Relay Node en Linux, validación TLS obligatoria y rechazo de AUTH LOGIN sin TLS. NTLM no se simula con LOGIN. |
| Contraseña SMTP en texto plano en SQLite | AES-GCM con clave externa SMTP_ENCRYPTION_KEY; la API no devuelve la contraseña. |
| Archivos subidos sin restricciones suficientes | Fotos/logos raster base64 limitados; SVG y URLs externas rechazados en cargas. Imágenes sin optimizador IMAGES. |
| Borrado definitivo eliminaba también la auditoría | Se conserva auditoría y se añade registro de eliminación. |
| Dependencias con vulnerabilidades | Actualización coherente de Next, React, Vinext, Vite, Wrangler y plugin. Runtime auditado: 0; 16 avisos moderados de desarrollo excluidos al podar. |
| Errores TypeScript | Tipos DB acotados al servidor y correcciones de estrechamiento en formularios. |

## Matriz de acceso efectiva

| Recurso | Lectura | Escritura |
|---|---|---|
| Usuarios | Administrador, Jefe de Operaciones | Solo Administrador |
| Personal técnico, turnos, SMTP | Administrador, Jefe de Operaciones | Administrador, Jefe de Operaciones |
| Programas, inventario, programación fija, catálogo edición | Autenticados | Administrador, Jefe de Operaciones |
| Métricas y /admin | Administrador, Jefe de Operaciones | Según recurso |
| Bitácora | Administrador/Jefe Producción: general; demás: propia | Generada por operaciones |
| Reservas | Autenticados | Según propietario, acción y rol; Visor solo consulta |
| Aprobar/denegar | — | Productor, Jefe Producción, Administrador, Jefe Operaciones; solapamiento fijo: Jefe Producción o Administrador |
| Eliminación definitiva | — | Solo Administrador |

Las comprobaciones de propietario y acciones de edición se mantienen en las rutas. No se confía en actorEmail del cuerpo cuando la sesión está disponible. Los roles son locales; no se importan automáticamente privilegios de roles de Keycloak.

## Dependencias finales relevantes

Node de imagen: 22 LTS. Next 16.4.5, React/React DOM/RSC 19.3.1, Vinext 1.4.3, Vite 8.3.6, plugin Cloudflare 1.67.0, Wrangler 4.157.0, Drizzle ORM 0.45.2 y drizzle-kit 0.31.10. El lockfile fija el árbol. Wrangler utiliza Miniflare 5 beta en este conjunto: añade una razón para exigir validación Linux antes de adoptar producción.

Los avisos moderados de desarrollo corresponden a cadenas de drizzle-kit/esbuild, Vinext/OG/fflate y ESLint/minimatch. No se aplicó npm audit fix --force ni un downgrade incompatible. Docker poda devDependencies después de compilar. No se confunde un audit de dependencias con una garantía total de seguridad.

## Inventario de rutas revisadas

auth, auth/keycloak/login, auth/keycloak/callback, users, reservations, reservations/purge, schedule, programs, staff, editing-staff, operators, work-shifts, duty-shifts, inventory, metrics, logs y smtp-settings; también los alias /auth/keycloak/login y callback. No se quitaron módulos funcionales ni estilos.

## Archivos modificados o agregados

Infraestructura: Dockerfile, .dockerignore, compose.yaml, .env.example, .gitattributes, .gitignore.
Arranque y operación: tools/container-start.mjs, runtime.py, http-gateway.mjs, healthcheck.mjs, db-admin.py, migrations-approved.json, init-linux.sh, create-admin.sh, backup.sh, restore.sh, preflight-ubuntu.sh; local-smtp-relay.mjs.
Aplicación: worker/index.ts, vite.config.ts, next.config.ts, package.json, package-lock.json, worker-configuration.d.ts, db/index.ts, db/schema.ts, lib/keycloak.ts, lib/smtp.ts, lib/smtp-secrets.ts, lib/operator-roster.ts, app/auth-context.tsx, app/page.tsx, app/admin/page.tsx.
Rutas: auth, callback/login Keycloak, users, reservations/purge, reservations, schedule, programs, inventory, staff, editing-staff, operators, work-shifts, duty-shifts, metrics, smtp-settings.
Migraciones: drizzle/0020_auth_and_duty_updates.sql, drizzle/meta/_journal.json y 0020_snapshot.json.
Compatibilidad: CONFIGURAR_PRIMER_ADMINISTRADOR.bat deshabilitado para evitar el SQL interpolado; DESPLIEGUE_LOCAL.md indica la nueva guía.
Pruebas: tests/security.test.mjs, integration-native.py, oidc-fixture.mjs, smtp-fixture.mjs. El antiguo rendered-html.test.mjs pertenece al skeleton de otra etapa; ya no es la prueba predeterminada.
Documentos: esta auditoría, DESPLIEGUE_DOKPLOY.md, KEYCLOAK_DOKPLOY.md, SQLITE_PERSISTENCIA_BACKUP.md y RESULTADOS_VALIDACION.md.

## Límites y decisiones de operación

No se admite escalado horizontal ni actualización con dos contenedores sobre el mismo estado. Las actualizaciones requieren parada breve. Desactivar un usuario local revoca efectivamente sus sesiones al comprobar active; no hay aún backchannel logout corporativo ni revocación instantánea cuando se deshabilita solo en Keycloak. Una sesión local válida puede durar hasta 12 horas: si se necesita revocación corporativa inmediata, hay que implementar backchannel o introspección antes de ese uso.

El correo verificado es el enlace del usuario local con la identidad corporativa. Cambios de correo deben coordinarse con Administración. Las reservas y auditoría mantienen la política de acceso existente a la agenda compartida; no se añadió aislamiento entre programas.

## Entrega final solicitada
Configuración definitiva: https://grabaciones.ed; cliente Keycloak grabaciones; callback https://grabaciones.ed/api/auth/keycloak/callback. Compose expone internamente 3000 y no publica 6680. El trigger aditivo 0021 quedó integrado y pasó 32 comprobaciones focalizadas de inicialización y D1, incluida preservación de reservas existentes y concurrencia; la compilación terminó con código 0. La imagen final Linux no está validada.
