# Empaquetado y validacion previa del relay SMTP

## Auditoria

En el checkout revisado, tools/smtp-diagnostics.mjs ya figura en Git (commit
4c022c3) y ninguna regla local lo excluia. Por tanto no es posible atribuir el
archivo ausente en /app a ese checkout sin inspeccionar la imagen desplegada:
puede tratarse de una revision o imagen anterior. No se accedio a Dokploy.

Si se detectaron dependencias presentes solo en el equipo local: tools/smtp-ntlm.py
y varias pruebas no estaban en el indice de Git. Se agregaron al indice los archivos
necesarios para que el proximo commit incluya el runtime y las pruebas completas.
No se hizo commit ni push.

## Runtime auditado

El manifiesto tools/smtp-package.json contiene:
- tools/local-smtp-relay.mjs
- tools/smtp-ntlm.mjs
- tools/smtp-diagnostics.mjs
- tools/smtp-ntlm.py
- tools/check-smtp-package.mjs
- tools/smtp-package.json
- requirements-smtp.txt

Los imports Node del relay utilizan modulos integrados de Node y archivos relativos;
no requieren un paquete npm SMTP adicional. La prueba carga realmente el grafo de
imports para detectar tambien dependencias transitivas nuevas y errores de sintaxis.
El modo de importacion no abre listeners HTTP ni conexiones SMTP.

El helper utiliza la biblioteca estandar de Python y pyspnego==0.12.4, instalado
junto con sus dependencias por pip en /opt/ed-smtp. La comprobacion importa el helper,
verifica la version instalada de pyspnego y genera solo un token Type 1 con datos
ficticios para comprobar el proveedor portable NTLM y sus dependencias criptograficas.
No se imprime el token, no se usan credenciales guardadas ni se conecta a Exchange.

## Git y Docker

- La comprobacion --git exige que todos los archivos de runtime y las pruebas del
  manifiesto esten en el indice de Git y no los excluya ninguna regla de Git.
  El indice es el contenido del proximo commit; agregarlo no publica los cambios.
- .dockerignore termina con inclusiones explicitas para todos los archivos SMTP
  de runtime. Los caches, el entorno virtual local y el parche de turnos siguen
  fuera del contexto.
- El Dockerfile valida el contexto antes de compilar: check:smtp:files.
- La imagen final conserva COPY /app/tools a ./tools y copia tambien
  requirements-smtp.txt a /app, ademas de la copia usada por pip en /tmp.
- Tras instalar dependencias y copiar los archivos, la imagen final ejecuta
  check:smtp como usuario node. Si falta el modulo o Python/pyspnego, falla la
  construccion, antes de desplegar una imagen incompleta.
- container-start.mjs repite la validacion antes de la inicializacion existente
  de la base o del lanzamiento de servicios. No se alteraron los pasos de base,
  Keycloak, persistencia, autenticacion, relay o envio.

## Comandos

    npm run check:smtp:files
    npm run check:smtp
    npm run check:smtp:git

El primero solo comprueba archivos e imports Node. El segundo incluye Python y el
proveedor NTLM. El tercero ademas audita el indice Git; usarlo en el checkout, no en
la imagen final, que deliberadamente no contiene .git.

Fuera de Docker, indicar SMTP_NTLM_PYTHON si el entorno con requirements-smtp.txt
no es el python predeterminado. La imagen final ya define esa ruta.

Para desplegar debe crearse un commit con el indice preparado y reconstruirse la
imagen desde esa revision. Una imagen anterior no recibe estos cambios por si sola.

## Validacion

- Auditoria --git: 14 archivos presentes en el indice y sin exclusion Git;
  comprobacion Python y proveedor NTLM correctas.
- Pruebas: 49/49, incluidas copias temporales sin modulos, imports transitivos
  rotos, Python ausente, contenido extraido del indice y reglas de Docker.
- Compilacion de produccion, TypeScript y lint de los nuevos archivos: correctos.
- git diff --cached --check: correcto.
- No se construyo ni ejecuto una imagen Docker: no hay daemon disponible en este
  entorno. Las validaciones incorporadas se ejecutaran dentro de la imagen durante
  su construccion. Se comprobaron las instrucciones COPY y las inclusiones del contexto.
- No se ejecutaron el arranque real, migraciones, SQL ni correos. No se modificaron
  SQLite, Keycloak, credenciales ni otras funcionalidades.
