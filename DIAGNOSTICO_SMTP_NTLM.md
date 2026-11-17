# Diagnostico seguro de SMTP NTLMv2

## Hallazgo

El error publico anterior no permite determinar por si solo la causa del fallo de
Dokploy. El adaptador Node descartaba stderr de Python, excepciones no previstas
se reducian a internal y send_message agrupaba los errores de MAIL FROM, RCPT TO y
DATA. No se ha conectado al Exchange real ni se ha intentado reproducir el fallo
con las credenciales del usuario.

## Cambio

El helper Python emite eventos JSON estructurados por stderr. Node acepta solo un
esquema cerrado y los escribe en el log del contenedor con prefijo [smtp-ntlm] y un
request_id generado por intento. El identificador agrupa los eventos de un envio,
no es un identificador de usuario ni contiene datos del mensaje.

Etapas:
- helper: inicio, salida, ejecutable ausente, timeout o protocolo invalido del proceso.
- dependency / prepare: importacion de dependencias y preparacion local del MIME.
- connection: conexion y saludo SMTP.
- ehlo: respuesta EHLO, incluido el EHLO posterior a STARTTLS si se configura.
- starttls: solo si fue seleccionado; no se activa para security=none.
- ntlm_negotiate: capacidades AUTH y operaciones context, type1, type2 y type3.
- auth: respuesta final al token Type 3.
- mail_from / rcpt_to: respuestas de cada comando, sin direcciones.
- data: respuesta inicial 354 y respuesta final; no se registra el mensaje.
- quit: cierre. Un fallo de cierre posterior a DATA aceptado no provoca reintentos.

Campos permitidos: stage, event (start/ok/error), operation, reason, error_type,
smtp_code, enhanced_code y codigos numericos errno, winerror, error_code,
verify_code y exit_code. Para el proceso se permite un conjunto fijo de errores,
por ejemplo ENOENT o EPIPE. Tipos de excepcion desconocidos aparecen como
UnexpectedError. No se registran mensajes arbitrarios de excepcion.

Ejemplo sintetico de rechazo de autenticacion:

    [smtp-ntlm] {"request_id":"<id del intento>","stage":"auth","event":"error","smtp_code":535,"enhanced_code":"5.7.3"}

Ejemplo sintetico de fallo del proveedor antes del intercambio:

    [smtp-ntlm] {"request_id":"<id del intento>","stage":"ntlm_negotiate","event":"error","operation":"context","reason":"internal","error_type":"AttributeError"}

No se registran usuario, password, hashes, tokens, claves, argumentos con secretos,
cuerpo, asunto, destinatarios ni respuestas SMTP completas. Se descartan stderr
arbitrario y tracebacks. El logging de terceros en el helper queda deshabilitado;
los diagnosticos propios no dependen de logging. En particular nunca se interpreta
el texto de un 334 como informacion de diagnostico.

La API publica POST /api/smtp-settings mantiene HTTP 502 ante un fallo y devuelve:

    {"error":"No se pudo enviar el correo de prueba. Revise los logs del servidor."}

El endpoint interno del relay tambien devuelve un mensaje fijo. Los detalles solo
aparecen en el log del contenedor. No se habilito smtplib.set_debuglevel ni ningun
volcado del protocolo SMTP.

## Como leer el proximo fallo autorizado

Tras reconstruir/desplegar, buscar [smtp-ntlm] en los logs del servicio de la
aplicacion en Dokploy. Agrupar por request_id y localizar el primer evento error.
El evento helper_exit posterior resume el cierre; la causa esta en los eventos
anteriores del mismo intento. Si el proceso es interrumpido, helper_timeout conserva
la ultima etapa conocida.

- connection con errno: revisar el codigo de conexion/DNS/timeout del sistema.
- ehlo con smtp_code: rechazo del saludo/capacidades antes de NTLM.
- ntlm_negotiate con capability: AUTH no contiene NTLM; X-EXPS no lo sustituye.
- ntlm_negotiate con challenge: desafio invalido o incompatible con NTLMv2.
- ntlm_negotiate con internal/error_type: fallo local del proveedor, no necesariamente
  credenciales incorrectas. operation identifica la parte del intercambio.
- auth con 535 / 5.7.x: rechazo de Exchange; el codigo por si solo no distingue entre
  credencial, cuenta o politica del conector. No cambiar passwords automaticamente.
- mail_from / rcpt_to / data: NTLM ya se completo; revisar el codigo de esa etapa.
- helper_spawn ENOENT: ejecutable Python no disponible en la ruta configurada.
- dependency: dependencia Python no importable.

La ausencia de un codigo SMTP es normal si no se recibio una respuesta SMTP.
No se ha hecho un intento contra 172.20.16.5 y no se afirma una causa real sin logs.

## Archivos

- tools/smtp-ntlm.py: diagnosticos por etapa y operaciones SMTP instrumentadas;
  conserva NTLMv2, restricciones de seguridad y comportamiento de send_message.
- tools/smtp-ntlm.mjs: captura filtrada de stderr, correlacion y errores del proceso.
- tools/smtp-diagnostics.mjs (nuevo): filtro cerrado y escritor de logs seguros.
- tools/local-smtp-relay.mjs: respuesta publica fija, sin error.message arbitrario.
- app/api/smtp-settings/route.ts: respuesta publica fija del envio de prueba.
- tests/smtp-ntlm.test.mjs: fallos por etapa y pruebas de no exposicion de tokens/texto.
- tests/smtp-settings.test.mjs: HTTP 502 publico sin detalles privados.
- tests/smtp-diagnostics.test.mjs y tests/smtp-diagnostics.py (nuevos): esquema,
  excepciones inesperadas del proveedor, codigos numericos y ejecutable ausente.
- package.json: incluye las pruebas de diagnostico en npm test.
- DIAGNOSTICO_SMTP_NTLM.md (nuevo): este informe.

El helper Python y las dos suites SMTP ya estaban sin seguimiento en Git al iniciar
esta tarea. Deben incluirse al preparar el commit junto con los nuevos archivos;
no se creo commit ni se realizo push. Los otros archivos de pruebas sin seguimiento
pertenecen a trabajos previos y no se modificaron en esta tarea.

## Validacion y limites

- npm test: 39/39 pruebas Node correctas; incluye la ejecucion de 3 pruebas unitarias
  Python correctas. Los servidores SMTP de prueba solo escuchan en 127.0.0.1.
- Compilacion de produccion: correcta, con avisos de las herramientas de build.
- TypeScript: correcto.
- ESLint de los archivos modificados de backend y pruebas: sin errores; conserva
  el aviso previo de ensureTable sin uso en smtp-settings.
- git diff --check: correcto.
- Sin correos reales, conexiones al Exchange real, cambios de credenciales, SQL,
  SQLite, Keycloak ni configuracion de Exchange. No se desplego desde esta tarea.
