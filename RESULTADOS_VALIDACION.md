# Cierre de preparación para el primer despliegue de prueba

Fecha: 5 de noviembre de 2026. Alcance de este cierre: migración 0021, inicialización SQLite/D1, compilación de producción y revisión estática de archivos de despliegue/exclusiones/OIDC. No se repitió auditoría, suite funcional general ni pruebas de Docker. No hubo push ni despliegue.

## Resultados finales

| Comprobación | Resultado real |
|---|---|
| Migración 0021 | Integrada y probada sobre SQLite persistente accedido mediante el binding D1 de Miniflare/workerd. |
| Pruebas específicas | 32 comprobaciones aprobadas: 12 de inicialización/migración y 20 mediante D1. |
| Datos existentes | Dos reservas antiguas solapadas conservan todos sus campos al aplicar la migración. Se permiten notas, aprobación, retrasos/horas reales, actualizaciones sin cambios efectivos y cancelación. |
| Exclusión concurrente | Dos escrituras simultáneas para el mismo espacio/horario admiten exactamente una; la otra recibe RESERVATION_TIME_CONFLICT. |
| Reglas de horario | Se rechazan solapamientos y margen menor de 15 minutos en grabaciones; el límite exacto se admite. Distinto recurso, categorías sin margen y reactivaciones se verificaron. |
| Actualización de horario/categoría | Se rechaza si crea conflicto, sin modificar el registro original. |
| Inicialización nueva | Las 22 migraciones se aplican sobre el archivo real de Wrangler; hay dos triggers y cero reservas operativas. |
| Idempotencia | La segunda ejecución no repite SQL. Migración sobre base existente crea backup previo. |
| Compilación de producción | Vite build terminó con código 0. Entorno de esta prueba: Windows y Node 24.16.0. |
| Docker/Compose/arranque | Revisión estática coherente: volumen /data, D1_STATE_DIR=/data/state, gateway público interno 3000, workerd en loopback 3001 y healthcheck /api/health que consulta DB. |
| Exclusiones | .gitignore y .dockerignore cubren bases, WAL/SHM, archivos de entorno, claves/certificados privados, credenciales npm y temporales. Los ejemplos sin secretos se conservan. |
| Keycloak en código/configuración | Cliente grabaciones; origen https://grabaciones.ed; callback https://grabaciones.ed/api/auth/keycloak/callback y PKCE S256. |

El trigger de UPDATE se limita a cambios efectivos de fecha, recurso, horario o categoría, y a reactivar reservas canceladas/denegadas. No vuelve a rechazar un solapamiento histórico por una simple actualización operativa. La migración no elimina ni reescribe reservas existentes. Su checksum aprobado quedó actualizado.

Comandos focalizados ejecutados:
~~~sh
python tests/migration-0021.py
node node_modules/vite/bin/vite.js build
~~~

Evidencia local: outputs/migration-0021-u9v9977n/result.json (12 comprobaciones de inicialización); salida del comprobador D1 (20 casos aprobados); outputs/build-cierre-0021.log (build, código 0). Las bases temporales y logs están excluidos de Git y de la imagen.

## Verificaciones previas conservadas

Antes de este cierre pasaron npm ci del lockfile actualizado, TypeScript, 10 pruebas de seguridad y 105 comprobaciones funcionales con OIDC/SMTP locales de prueba. No se repitieron ahora ni se presentan como pruebas del servidor corporativo. La auditoría previa de dependencias de ejecución reportó cero vulnerabilidades; herramientas de desarrollo tenían 16 avisos moderados y se podan en la imagen.

## Pendientes reales del despliegue

- La imagen Docker Linux final no se ha ejecutado: no se declara validada. No se intentó reparar Docker Desktop en este cierre.
- Faltan el realm y Client Secret reales, crear/configurar el cliente grabaciones y verificar login/logout con el Keycloak corporativo.
- Configurar DNS y certificado confiable de grabaciones.ed y su dominio en Dokploy hacia gestion-ed:3000.
- Confirmar la red externa dokploy-network y comprobar estado healthy/persistencia al desplegar.
- Keycloak sigue en HTTP: HTTPS en la aplicación no cifra el tramo de autenticación con el IdP.
- SMTP/Exchange real sigue pendiente y no bloquea iniciar la aplicación con SMTP deshabilitado.
- D1 local conserva las limitaciones operativas de un entorno de desarrollo autohospedado; una sola réplica y Fresh Volumes desactivado.

**Dictamen:** no se detectó un error de código pendiente en el alcance comprobado que impida intentar el primer despliegue de prueba. Complete realm/secret, DNS, TLS y dominio en Dokploy. El funcionamiento Linux definitivo debe confirmarse en ese despliegue; no se certifica todavía producción.
