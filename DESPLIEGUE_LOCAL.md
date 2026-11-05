> Para Ubuntu/Dokploy use DESPLIEGUE_DOKPLOY.md. Dominio definitivo: https://grabaciones.ed; cliente Keycloak: grabaciones. La guía Windows siguiente es histórica.

# Despliegue desde cero — Gestión de Uso de Estudios y Grabaciones ED

Esta guía sirve para instalar una instancia nueva del sistema en un equipo o Windows Server de la red interna. No altera el servidor que ya está en uso.

## Antes de comenzar

- Windows 10/11 o Windows Server de 64 bits.
- Node.js 22 LTS instalado. Compruébelo con `node -v`.
- Acceso del servidor nuevo al servidor de Keycloak y al repositorio de paquetes NPM durante la preparación.
- IP fija o nombre DNS para el servidor nuevo.
- Una cuenta corporativa que será el primer Administrador.
- Datos del relay SMTP Exchange; se registran desde el panel luego de la instalación.

## Instalación

1. Extraiga el ZIP en una carpeta permanente, por ejemplo `C:\GestionEstudiosED`.
2. Ejecute `PREPARAR_SERVIDOR.bat` con doble clic.
3. En la primera ejecución se creará `.dev.vars` y se abrirá en el Bloc de notas. Complete al menos:

   ```text
   PORT=3000
   HOST=0.0.0.0
   LOCAL_AUTH_BYPASS=false
   KEYCLOAK_ISSUER=http://IP-KEYCLOAK:8080/realms/NOMBRE-DEL-REALM
   KEYCLOAK_CLIENT_ID=cliente-de-la-aplicacion
   KEYCLOAK_CLIENT_SECRET=secreto-del-cliente
   KEYCLOAK_PUBLIC_ORIGIN=http://IP-O-NOMBRE-DEL-SERVIDOR:3000
   ```

4. Guarde `.dev.vars` y ejecute otra vez `PREPARAR_SERVIDOR.bat`. Este paso instala las dependencias, crea la base vacía y compila el sistema.
5. Ejecute `CONFIGURAR_PRIMER_ADMINISTRADOR.bat` e ingrese el correo corporativo de la persona que será Administrador.
6. En Keycloak, actualice el cliente de la aplicación con la URL pública real. Para un servidor `http://SERVIDOR:3000`:

   - Root URL y Home URL: `http://SERVIDOR:3000`
   - Valid redirect URI: `http://SERVIDOR:3000/api/auth/keycloak/callback`
   - Web origin: `http://SERVIDOR:3000`
   - Client authentication y Standard flow: activados.

7. Ejecute `ABRIR_PUERTO_APLICACION.bat` como Administrador de Windows para permitir el puerto configurado desde la red interna.
8. Ejecute `INICIAR_PRODUCCION.bat`.
9. Compruebe el funcionamiento con `VERIFICAR_DESPLIEGUE.bat` y abra `http://SERVIDOR:PUERTO` desde otra computadora.

## Operación diaria

- Iniciar: `INICIAR_PRODUCCION.bat`
- Detener: `DETENER_SISTEMA_LOCAL.bat`
- Verificar: `VERIFICAR_DESPLIEGUE.bat`
- Registro técnico: `servidor-produccion.log`

La dirección que deben usar los demás equipos es la indicada en `KEYCLOAK_PUBLIC_ORIGIN`.

## Seguridad y datos

El instalador no lleva datos ni secretos. No copie `.dev.vars` entre servidores sin revisar sus URLs y credenciales. La base de datos nueva queda dentro de `.wrangler`; haga copias periódicas de esa carpeta cuando el sistema ya esté en producción.
