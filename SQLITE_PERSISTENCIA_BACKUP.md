# SQLite: persistencia, migraciones y recuperación

## Estado real y volumen

Volumen de producción: gestion_ed_dokploy_data, montado en /data.
D1_STATE_DIR=/data/state se pasa a Wrangler tanto al inicializar como al ejecutar el Worker.

Con las versiones fijadas y el ID local configurado, el archivo observado en la validación es:
~~~text
/data/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite
~~~
El hash es un detalle de implementación de Miniflare; la herramienta descubre y exige un solo archivo de datos de 64 dígitos hexadecimales, excluyendo metadata.sqlite. No invente otra ruta ni copie únicamente un archivo adivinando su nombre.

Dentro del contenedor activo:
~~~sh
docker compose exec gestion-ed python3 tools/db-admin.py inspect
~~~
Imprime ruta descubierta, integrity=ok y número de migraciones. El healthcheck consulta tablas a través de env.DB, no mediante una conexión SQLite distinta. La prueba de integración escribió reservas por API, reinició workerd y volvió a leerlas desde el mismo estado.

La ruta física del volumen en el host la informa:
~~~sh
docker volume inspect gestion_ed_dokploy_data --format '{{ .Mountpoint }}'
~~~
Normalmente se encuentra bajo /var/lib/docker/volumes, pero no debe asumirse si Docker usa otro data-root. No se verificó el Mountpoint del servidor remoto.

## Instalación nueva

No copie una base anterior. Al primer arranque:
1. Wrangler d1 execute --local --persist-to /data/state crea la base de ese binding.
2. tools/db-admin.py aplica en orden los 20 SQL originales, 0020 y 0021.
3. Se registran nombre/hash/fecha en ed_migrations; cada archivo es transaccional.
4. Se comprueba integridad antes de abrir la aplicación.

No se insertan usuarios, reservas, programas, inventario ni personas de ejemplo. Cree el administrador offline y configure catálogos reales. El esquema no está vacío, los datos operativos sí.

No mezcle ed_migrations con wrangler d1 migrations apply sobre este mismo volumen. El script npm db:migrate:local se conserva exclusivamente para desarrollo previo/estados separados. La instalación Ubuntu utiliza el runner aprobado del contenedor.

## Migraciones y actualización

Los SQL ALTER TABLE no son idempotentes por sí solos. La idempotencia pertenece al historial, que evita repetirlos y rechaza cambios de hash o archivos aplicados ausentes. tools/migrations-approved.json es el inventario de SQL revisados; una migración nueva o alterada no se ejecuta hasta que un responsable revise y apruebe su hash. Se rechazan además instrucciones DROP/DELETE/TRUNCATE/REPLACE automáticas.

Los originales son aditivos, excepto 0017, que ajusta dos bloques concretos de programación. 0020 añade sesiones, índice y columnas faltantes. 0021 añade triggers de exclusión de solapamientos y margen de 15 minutos para escrituras concurrentes; pasó las pruebas focalizadas en D1 y preservación de reservas existentes. No se eliminaron columnas ni tablas. Drizzle tiene snapshot y journal actualizados hasta 0021; db:generate verificó ausencia de diferencias.

Antes de migraciones pendientes sobre un esquema existente se guarda un backup consistente en /data/backups/before-migration-FECHA.sqlite. Haga además un backup externo antes de cada actualización. No basta aprobar un hash para que cualquier SQL sea seguro: la revisión humana del contenido es obligatoria.

El bloqueo /data/state/.runtime.lock impide dos runtimes y bloquea administración/restauración offline mientras corre la aplicación. Utilice una sola réplica, almacenamiento local y parada breve al actualizar. No monte SQLite sobre NFS/SMB ni comparta el volumen con otras aplicaciones.

## Backup consistente en funcionamiento

~~~sh
docker compose exec gestion-ed sh tools/backup.sh
~~~
Se crea /data/backups/gestion-ed-FECHA.sqlite con permisos restrictivos. Para nombre explícito:
~~~sh
docker compose exec gestion-ed sh tools/backup.sh /data/backups/copia-revisada.sqlite
~~~
El destino debe ser nuevo. La herramienta usa sqlite3.Connection.backup y comprueba integrity_check y foreign_key_check. Esto incluye transacciones confirmadas en WAL; no hace falta copiar -wal ni -shm a mano. No use cp sobre el archivo vivo como estrategia de backup.

Copie el archivo fuera del volumen con docker cp usando el ID exacto de este servicio:
~~~sh
id=$(docker compose ps -q gestion-ed)
docker cp "$id:/data/backups/ARCHIVO.sqlite" ./ARCHIVO.sqlite
sha256sum ./ARCHIVO.sqlite
~~~
Traslade la copia a almacenamiento separado protegido y ensaye restauraciones. Tener backup en el mismo disco no cubre pérdida del servidor. Configure retención según su política; el script no borra copias automáticamente.

El backup contiene datos personales, correo SMTP cifrado y hashes de sesión. Proteja y cifre las copias externas. Preserve por separado SMTP_ENCRYPTION_KEY, el secret de Keycloak y el código/lockfile de la versión; perder la clave SMTP impide descifrar credenciales.

## Restaurar con aplicación detenida

La restauración reemplaza los datos actuales por la copia elegida. Requiere autorización operativa y una ventana de mantenimiento. No se ejecutó restauración sobre datos reales en esta sesión.

Si el backup ya está en /data/backups:
~~~sh
docker compose stop gestion-ed
docker compose run --rm --no-deps gestion-ed sh tools/restore.sh /data/backups/ARCHIVO.sqlite
docker compose run --rm --no-deps gestion-ed python3 tools/db-admin.py inspect
docker compose up -d gestion-ed
docker compose ps
~~~
La herramienta valida el origen, bloquea el estado y guarda antes una copia consistente before-restore-FECHA.sqlite. Utiliza la API de backup para reemplazar el contenido, en lugar de sustituir un .sqlite mientras quedan WAL incompatibles. Una versión restaurada puede requerir migraciones aprobadas al arrancar. No restaure un esquema más nuevo con una imagen antigua sin revisar compatibilidad.

Para un backup externo, copie primero al volumen con este servicio detenido y verifique propietario node (UID 1000) y permisos. No cambie propietarios de carpetas de otras aplicaciones ni del data-root global de Docker.

## Recuperación

Si falla integrity_check: mantenga detenido el servicio, preserve el estado completo y logs para diagnóstico y restaure la última copia verificada. No intente reparar borrando WAL ni eliminando la base. Si falla una migración, conserve volumen y backup previo; corrija la causa antes de reiniciar. Un checksum distinto de SQL aplicado exige recuperar el archivo original, no editar el historial para forzarlo.

Los metadatos de Miniflare pertenecen al mismo estado. Para una recuperación forense, preserve todo /data/state con el servicio parado; para respaldo ordinario use el backup SQLite de la herramienta.

No utilice Fresh Volumes, docker compose down -v ni comandos de limpieza global. Reconstruir imagen, reiniciar o recrear solo el contenedor conserva el volumen. La persistencia tras recrear un contenedor Linux sigue pendiente de prueba; el reinicio nativo y la restauración temporal sí se comprobaron.
