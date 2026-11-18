# Integración controlada de sobrescritura de grilla

Origen: `C:\Tmp\PARCHE_SOBRESCRITURA_GRILLA_2026-11-18`.
Rama revisada: `despliegue/grabaciones-dokploy`.

## Comparación archivo por archivo

Se compararon los siete archivos de `archivos/` con el checkout actual antes de editar. No se ejecutó el BAT ni se copiaron sus archivos completos sobre el proyecto.

| Archivo del parche | Resultado de la comparación y decisión |
| --- | --- |
| `app/page.tsx` | Se incorporaron la advertencia, identificación visual y ocultación por fecha. Se preservaron los arreglos actuales de tipos y eventos. Se añadió confirmación también al aprobar y se unificaron permisos, márgenes operativos y proyección con el backend. |
| `app/form-additions.css` | Solo se añadió el estilo de la reserva que sobrescribe grilla. |
| `db/schema.ts` | Solo se agregó `fixedOverride`. Se rechazó la eliminación de `authSessions`, su índice y los campos de cierre OIDC. |
| `app/api/reservations/route.ts` | Se adaptó la sobrescritura a creación, edición y aprobación. Se preservaron validaciones, identidad del solicitante, asignaciones asíncronas y respuesta 409 por conflictos concurrentes. Se rechazaron los `ALTER TABLE` automáticos en las API y la recuperación de una grilla antigua de ejemplo como fallback. |
| `app/api/metrics/route.ts` | Sin cambios: el parche reactivaba modificaciones de esquema al consultar métricas. La migración central actualiza el esquema antes de servir peticiones. |
| `app/api/reservations/purge/route.ts` | Sin cambios: el parche eliminaba la bitácora histórica y retiraba la identidad Unicode actual. Se mantiene el comportamiento existente. |
| `drizzle/0020_fixed_schedule_overrides.sql` | No se incorporó con ese número. `0020_auth_and_duty_updates.sql` ya existe. Se creó `0023_fixed_schedule_overrides.sql` y su metadata, sin modificar las 23 migraciones anteriores. |

El BAT y los dos documentos del paquete se leyeron como referencia. Permanecen fuera del repositorio y del contexto Docker, en su directorio de origen.

## Comportamiento final

- Solo Administrador y Jefe de Producción pueden sobrescribir programación fija. Se comprueba tanto en interfaz como en backend; no se acepta el rol ni el estado enviados por el cliente como autorización.
- El servidor devuelve todos los programas/bloques afectados y exige confirmación explícita. La confirmación se vincula a fecha, recurso, horario, categoría y conjunto afectado; si cambian, debe confirmarse otra vez.
- Crear o editar con esa confirmación guarda `status=aprobada`, `fixed_override=1`, aprobador y fecha. Aprobar una solicitud anterior que cruza grilla también exige la confirmación.
- Las reservas normales conservan su flujo pendiente de aprobación. Los demás roles conservan los permisos de las operaciones que no implican sobrescritura.
- La grilla base no se modifica: se ocultan sus bloques al proyectar únicamente la fecha y espacio de una sobrescritura aprobada, retrasada o completada. Una reserva pendiente, cancelada o denegada no oculta programación fija.
- Cancelar o denegar limpia la marca y restaura automáticamente la visualización. Los cambios de estado y de marca se registran en la bitácora, con actor y bloques afectados cuando corresponde.
- Se preservan los conflictos entre reservas y ambos márgenes operativos de 15 minutos. `fixed_override` no exime los triggers SQLite/D1 de concurrencia.
- Estudio II continúa disponible los fines de semana. La franja protegida de días hábiles solo puede sobrescribirse por los roles autorizados cuando hay un bloque fijo afectado y se confirma explícitamente.

## Migraciones y datos existentes

Hay 23 migraciones anteriores (`0000` a `0022`), y sus hashes aprobados permanecen intactos. La nueva `0023` agrega una columna booleana SQLite (`INTEGER NOT NULL DEFAULT false`). La nueva versión tendrá 24 migraciones, no una segunda migración `0020`.

El migrador habitual de Dokploy aplica la nueva columna una sola vez, conserva la copia de seguridad previa y registra su hash. Si un parche manual ya añadió exactamente una columna compatible, la reconoce sin repetir el ALTER ni reiniciar sus valores. Una definición o valores incompatibles detienen la actualización; no se ignoran errores de esquema. Esa conciliación se limita al SQL exacto de la migración nueva.

La migración SQL es compatible con D1 y se probó allí. El caso de columna añadida manualmente se concilia mediante `tools/db-admin.py`, que es la ruta de arranque de Dokploy. No debe ejecutarse el SQL crudo de nuevo sobre una columna ya existente; una instalación que use exclusivamente el migrador propio de D1 requerirá conciliar previamente su historial si recibió un ALTER manual.

No se inspeccionó ni modificó la base de producción. Las pruebas de migración se ejecutaron exclusivamente en bases temporales e independientes. No se eliminaron ni reinicializaron datos operativos.

## Archivos modificados

- `app/api/reservations/route.ts`: permisos, confirmación, aprobación, marca y bitácora.
- `app/page.tsx`: advertencias, confirmación, controles de permisos y proyección diaria/semanal; identificación en mes.
- `app/form-additions.css`: estilo visual de sobrescritura.
- `db/schema.ts`: columna `fixedOverride`, preservando íntegro el esquema de autenticación.
- `drizzle/meta/_journal.json`: entrada nueva 0023.
- `tools/migrations-approved.json`: hash aprobado de la migración nueva.
- `tools/db-admin.py`: conciliación específica para una columna añadida manualmente.
- `Dockerfile`: comprobación del código fuente antes de compilar y del paquete final tras copiar archivos.
- `.dockerignore`: inclusiones explícitas para los artefactos nuevos; preserva todas las inclusiones SMTP.
- `package.json`: pruebas y comandos de comprobación del paquete de grilla.

## Archivos nuevos

- `lib/fixed-schedule.ts`: lógica compartida de permisos, cruces, confirmación y proyección con márgenes operativos.
- `drizzle/0023_fixed_schedule_overrides.sql` y `drizzle/meta/0023_snapshot.json`: migración y snapshot compatibles con el historial actual.
- `tools/fixed_override_migration.py`: conciliación segura de la columna existente.
- `tools/check-fixed-package.mjs`: verifica archivos requeridos, hashes y coherencia del historial sin ejecutar SQL.
- `tests/fixed-overrides.test.mjs`: API con dobles sin correos, permisos, confirmación, conflictos y calendario renderizado.
- `tests/fixed-migration.py` y `tests/fixed-migration.test.mjs`: actualización SQLite, datos conservados, columna previa, D1, concurrencia y paquete equivalente a la imagen final.
- Este informe.

## Empaquetado y preservación

La lógica compartida queda incluida en los bundles cliente/servidor de la compilación. Se comprobó la presencia del código de confirmación y del CSS en `dist`. Los SQL y snapshots llegan a la imagen mediante `COPY /app/drizzle`, y el nuevo helper llega mediante `COPY /app/tools`. La imagen valida sus archivos y hashes antes de quedar lista para desplegar.

Las pruebas simulan un paquete final y comprueban que la validación falla si falta el helper o la migración. Todos los archivos necesarios se incorporan al índice Git; no se incluye la carpeta original del parche.

No se modificaron la implementación SMTP NTLMv2, sus diagnósticos, las claves de cifrado, Keycloak, el middleware de permisos, el roster de personal, Turnos del Personal ni el panel administrativo. Las pruebas anteriores de seguridad y SMTP siguen pasando.

## Validación y límites

- `npm test`: 64 pruebas Node correctas; incluyen además 4 comprobaciones Python de migración y las comprobaciones Python SMTP anteriores.
- D1 local: columna, triggers, límite exacto de 15 minutos y escrituras concurrentes correctos.
- SQLite temporal: actualización desde 23 migraciones conserva reservas y sesiones; nuevo historial de 24; segunda ejecución idempotente; columna manual compatible conservada; columna incompatible rechazada.
- Calendario renderizado: desaparecen los bloques al aprobar y reaparecen al cancelar o denegar.
- TypeScript y compilación de producción: correctos.
- ESLint de backend, helpers y pruebas: sin errores. La página principal conserva los mismos 2 errores y 11 avisos previos; no se corrigieron problemas ajenos a este parche.
- `check:fixed:source` y `check:fixed`: correctos. `git diff --check`: correcto.
- No hay daemon Docker disponible: no se construyó ni ejecutó una imagen Docker real. Se validaron el Dockerfile, el contenido compilado y una disposición equivalente a la imagen final.

Está preparado para publicar el código en `despliegue/grabaciones-dokploy`, con la migración 0023 pendiente para el siguiente despliegue autorizado. No se hizo commit, push, despliegue, migración de producción, cambio de credenciales ni envío real de correo. La publicación en una rama conectada a Dokploy podría disparar su automatización: no se realizó esa publicación.
