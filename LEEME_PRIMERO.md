# EMPIECE AQUÍ — Gestión de Uso de Estudios y Grabaciones ED

Esta carpeta instala una instancia NUEVA y VACÍA del sistema.

1. Lea `DESPLIEGUE_LOCAL.md` completo.
2. Ejecute `PREPARAR_SERVIDOR.bat`.
3. Complete los datos de Keycloak en `.dev.vars`.
4. Ejecute nuevamente `PREPARAR_SERVIDOR.bat`.
5. Ejecute `CONFIGURAR_PRIMER_ADMINISTRADOR.bat`.
6. Actualice las URLs del cliente en Keycloak.
7. Ejecute `ABRIR_PUERTO_APLICACION.bat` como Administrador de Windows.
8. Ejecute `INICIAR_PRODUCCION.bat`.
9. Ejecute `VERIFICAR_DESPLIEGUE.bat`.

Importante: el paquete no lleva la base de datos actual, usuarios, reservas, métricas, bitácora, contraseñas ni secretos. Consulte `NOTAS_INSTALACION_DESDE_CERO.md` para conocer el alcance y los cambios incluidos.
