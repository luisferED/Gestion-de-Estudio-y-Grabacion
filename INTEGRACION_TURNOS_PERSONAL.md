# Integraci?n del parche de Turnos del personal ? 2026-11-17

## Comparaci?n y decisi?n

El paquete contiene una ruta de API, un SQL de sincronizaci?n y un instalador Windows.
La ruta cambia 21 turnos base por 31, activa ensureSeed en cada GET y agrega creaci?n
de tabla en las operaciones. El SQL elimina todos los turnos antes de insertar los 31.
El instalador detiene procesos, copia la ruta y ejecuta Wrangler sobre una base local.

Se integr? ?nicamente la grilla de 31 turnos. Se conserv? SEED_DEMO_DATA como condici?n
para la carga inicial, sin copiar la inicializaci?n incondicional ni el instalador.
No se ejecut? SQL, no se iniciaron migraciones y no se eliminaron registros.
Las pruebas de la API usan dobles en memoria, sin conexi?n a una base de datos.

La grilla existente de producci?n permanece igual. Dokploy fuerza SEED_DEMO_DATA=false:
subir este c?digo no sincroniza los turnos almacenados ni carga autom?ticamente una
instalaci?n vac?a de producci?n. Esa sincronizaci?n requiere una tarea posterior,
con respaldo y autorizaci?n para modificar los datos. No ejecutar el BAT del parche
en Dokploy: est? dise?ado para una instalaci?n Windows con .wrangler local.

## Archivos

- app/api/work-shifts/route.ts: grilla base actualizada a los 31 registros del parche.
  Se conservan GET condicionado, POST, PATCH, DELETE y validaciones actuales.
- .gitignore: excluye la carpeta local del parche de Git.
- .dockerignore: excluye el paquete del contexto de construcci?n de Docker.
- tsconfig.json y eslint.config.mjs: excluyen la copia de referencia del an?lisis;
  sus imports relativos no corresponden a su ubicaci?n dentro de la carpeta del parche.
- package.json: npm test incluye la regresi?n de Turnos del personal.
- tests/work-shifts.test.mjs (nuevo): verifica carga expl?cita de 31 turnos y que
  las consultas normales, incluso con una tabla vac?a, no escriban datos.
- tests/security.test.mjs: verifica permisos de Turnos para todos los m?todos y
  corrige la resoluci?n del import de cookies en la prueba del Worker.
- tests/origin-proxy.test.mjs y tests/unicode-session.test.mjs: misma correcci?n
  del import de cookies para poder ejecutar las pruebas existentes.
- tests/compiled-auth-cookies.mjs (nuevo): carga el c?digo real de cookies para
  esas pruebas, conservando su l?gica de producci?n.
- INTEGRACION_TURNOS_PERSONAL.md (nuevo): este informe.

No se modificaron autenticaci?n Keycloak, esquema SQLite, migraciones, configuraci?n
Dokploy, persistencia, interfaz ni las restantes funcionalidades del sistema.
El archivo package-lock.json permanece sin cambios.

## Validaci?n

- Compilaci?n de producci?n (npm run build): correcta, con avisos de sourcemaps y
  an?lisis de rutas de las herramientas de compilaci?n.
- TypeScript (npx tsc --noEmit --incremental false): correcto.
- Seguridad, turnos, logout, proxy de origen y sesi?n Unicode: 28/28 pruebas correctas.
- ESLint de los archivos JavaScript/TypeScript modificados: sin errores; conserva
  un aviso previo por ensureTable sin uso en la ruta.
- Lint general: 38 errores y 32 avisos. Los errores est?n en app/admin/page.tsx
  (36) y app/page.tsx (2), ambos sin modificaciones en esta integraci?n.
- git diff --check: correcto.
- git check-ignore: confirma la exclusi?n de la carpeta del parche.

El cambio de c?digo est? preparado para revisi?n y subida a GitHub. El lint global
no est? limpio y no se verific? un despliegue real en Dokploy. No se cre? commit ni
se hizo push. La sincronizaci?n de registros queda expresamente pendiente.
