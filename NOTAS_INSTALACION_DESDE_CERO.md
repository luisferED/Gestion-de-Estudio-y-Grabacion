# Gestión de Uso de Estudios y Grabaciones ED

## Instalador completo para servidor nuevo

Este paquete instala una instancia nueva y vacía del sistema. No contiene ni copia:

- la base de datos de la instalación actual;
- solicitudes, métricas, bitácora, turnos, usuarios ni fotografías existentes;
- sesiones activas;
- claves de Keycloak o contraseñas SMTP.

Al terminar, la base de datos se crea localmente dentro de la carpeta `.wrangler` del servidor nuevo. Los primeros usuarios corporativos que inicien sesión se registran automáticamente con rol **Producción**. Use `CONFIGURAR_PRIMER_ADMINISTRADOR.bat` para entregar el rol Administrador a la cuenta que gestionará el sistema.

## Cambios incluidos

- Rol **Jefe de Producción** para gestionar la agenda: puede solicitar, editar, cancelar, reprogramar, aprobar y rechazar reservas, sin acceso a métricas ni a la administración de personal, usuarios, turnos, SMTP o eliminación definitiva.
- Las solicitudes que se solapan con bloques de programación fija muestran una advertencia y quedan pendientes. Su aprobación por Jefe de Producción o Administrador confirma el uso compartido del horario.
- Se conservan el bloqueo entre reservas reales y el margen operativo de 15 minutos entre grabaciones.
- Instalación independiente de IP: el puerto, la dirección pública y la conexión Keycloak se definen en `.dev.vars` del nuevo servidor.
- Inicio, detención, verificación y apertura de firewall adaptados al puerto configurado.

Consulte `DESPLIEGUE_LOCAL.md` antes de instalar.
