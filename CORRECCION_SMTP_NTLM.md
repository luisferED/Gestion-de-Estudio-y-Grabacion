# Correccion SMTP NTLM - Gestion de Estudios ED

## Diagnostico

La opcion anterior "Cuenta corporativa - NTLM" guardaba authMode=login.
En Linux el relay enviaba AUTH LOGIN; en Windows usaba SmtpClient de .NET,
sin fijar NTLM. La etiqueta no garantizaba el protocolo anunciado.

Para el servidor 172.20.16.5, segun la verificacion proporcionada:
- Puerto 25: AUTH NTLM; X-EXPS GSSAPI NTLM; sin STARTTLS.
- Puerto 587: AUTH GSSAPI NTLM; sin STARTTLS ni AUTH LOGIN.

No se contacto ese servidor durante este trabajo. Las conexiones de prueba
se limitaron a fixtures en 127.0.0.1 y utilizaron credenciales ficticias.

## Solucion

- Nuevo authMode=ntlm en interfaz y API. LOGIN queda etiquetado por separado
  y sigue requiriendo STARTTLS o TLS directo. El relay por IP sigue disponible.
- tools/smtp-ntlm.py usa pyspnego 0.12.4, proveedor portable NTLM, protocolo
  NTLM explicito y LM_COMPAT_LEVEL=3. Verifica AUTH NTLM en EHLO (X-EXPS no basta),
  intercambia tokens Type 1 / Type 2 / Type 3 y requiere el resultado SMTP 235.
- Requiere un desafio con Extended Session Security y TargetInfo para NTLMv2;
  rechaza desafios invalidos y no recurre a NTLMv1, LOGIN, PLAIN, GSSAPI ni envio
  anonimo cuando se selecciona NTLM.
- STARTTLS solo se solicita cuando la configuracion lo pide. Si se solicita y
  no existe, se detiene. TLS directo y STARTTLS validan certificados.
- tools/smtp-ntlm.mjs conecta el relay con Python mediante stdin. La clave no
  se coloca en argumentos, archivos temporales ni mensajes de error. Las
  respuestas del helper contienen codigos fijos, sin texto del servidor ni tokens.
- Se conserva lib/smtp-secrets.ts, SMTP_ENCRYPTION_KEY y el cifrado AES-GCM.
  Al guardar NTLM con el campo de password vacio se conserva el cifrado existente.
- No se alteraron Keycloak, las reglas de autorizacion, esquema o migraciones SQLite,
  reservas, notificaciones ni persistencia. El envio de prueba sigue siendo manual.

NTLM autentica mediante desafio/respuesta, pero no cifra por si solo este
transporte SMTP. Con security=none el contenido y metadatos del correo viajan
sin TLS, y los tokens NTLM siguen siendo sensibles. Usar la red interna autorizada.

## Activacion posterior (no realizada)

La base de datos y las credenciales permanecen intactas. No hay migracion automatica
ni reinterpretacion de authMode=login como NTLM.

Despues de revisar y desplegar, un administrador debera seleccionar:
- Servidor: 172.20.16.5.
- Puerto: 25 o 587, segun el conector autorizado por TI.
- Seguridad: Sin cifrado - red interna, porque no se anuncio STARTTLS.
- Autenticacion: Cuenta corporativa - NTLM.
- Mantener el usuario corporativo correcto y dejar la contrasena vacia si ya esta
  guardada. No regenerar SMTP_ENCRYPTION_KEY: es necesaria para descifrarla.

Guardar esa seleccion modificara la configuracion almacenada y podra afectar los
siguientes correos automaticos si estan habilitados. Esa accion NO se ejecuto.
La compatibilidad con el conector y la cuenta reales requiere una validacion
operativa posterior; no se autorizo ningun envio real en esta tarea.

## Dependencia y despliegue

Dockerfile instala python3-venv y requirements-smtp.txt dentro de /opt/ed-smtp,
y define SMTP_NTLM_PYTHON=/opt/ed-smtp/bin/python. Reconstruir la imagen al desplegar.
No requiere cambios en Exchange ni unir el contenedor al dominio para estas
credenciales explicitas. Conserva la configuracion de persistencia SQLite/Dokploy.

Para desarrollo fuera de Docker:

    python -m venv .smtp-venv
    .smtp-venv/Scripts/python.exe -m pip install -r requirements-smtp.txt

En Windows, establecer SMTP_NTLM_PYTHON con la ruta absoluta a ese python.exe antes
de iniciar la aplicacion. En Linux usar .smtp-venv/bin/python. Para las pruebas en
Windows, tests/smtp-ntlm.test.mjs detecta el entorno local .smtp-venv/Scripts/python.exe;
en otros entornos indicar SMTP_NTLM_PYTHON o instalar las dependencias en python3.

Documentacion del proveedor: https://github.com/jborean93/pyspnego

## Archivos de esta correccion

Modificados:
- app/admin/page.tsx: selector explicito NTLM / LOGIN y explicacion de transporte.
- app/api/smtp-settings/route.ts: acepta NTLM y conserva sus credenciales cifradas.
- tools/local-smtp-relay.mjs: envia NTLM al nuevo helper; elimina la seleccion
  implicita de .NET segun el sistema operativo; conserva los otros modos.
- Dockerfile: entorno aislado Python para NTLM.
- package.json: agrega las pruebas SMTP a npm test; package-lock.json no cambia.
- tests/security.test.mjs: permisos para consultar, guardar y probar SMTP.
- .gitignore y .dockerignore: excluyen caches locales y el entorno de pruebas.

Nuevos:
- tools/smtp-ntlm.mjs y tools/smtp-ntlm.py: adaptador y cliente SMTP NTLMv2.
- requirements-smtp.txt: version fijada de pyspnego.
- tests/smtp-ntlm.test.mjs: negociacion real contra un servidor SMTP simulado local,
  comprobacion independiente HMAC-MD5 de la respuesta NTLMv2 y casos de rechazo.
- tests/smtp-settings.test.mjs: API con dobles en memoria, conservacion del password,
  separacion del selector, rechazo de LOGIN sin TLS y compatibilidad de otros modos.
- CORRECCION_SMTP_NTLM.md: este informe.

Los archivos tests/compiled-auth-cookies.mjs y tests/work-shifts.test.mjs ya estaban
sin seguimiento al comenzar esta tarea; no se modificaron.

## Validacion

- Suite combinada de seguridad, SMTP, turnos, logout, proxy y Unicode: 43 pruebas.
- Compilacion de produccion y TypeScript: correctos.
- ESLint del backend y pruebas de esta correccion: sin errores; un aviso previo
  por ensureTable sin uso en smtp-settings.
- app/admin/page.tsx conserva los mismos 36 errores y 12 avisos de lint que HEAD;
  no se ampliaron las correcciones a esos problemas ajenos al SMTP.
- git diff --check: correcto.
- No se ejecuto SQL ni se abrio una base de datos. Las pruebas de API usan dobles.
- No se construyo ni ejecuto el contenedor: Docker no tiene un daemon disponible
  en este entorno. El proveedor NTLM portable se probo desde Windows con Python.
- No se hizo commit ni push. Listo para revision del codigo antes de GitHub, con
  validacion del despliegue y del conector real expresamente pendientes.
