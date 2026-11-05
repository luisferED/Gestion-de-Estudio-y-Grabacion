# Corrección del sidebar administrativo

Archivos modificados en esta corrección: app/admin/page.tsx, app/admin/admin.css y tests/first-navigation-browser.mjs. Este informe es nuevo.

Causas: sidebar con altura fija sin área flex desplazable; regla móvil ocultaba el pie; margen global de aside añadía 14 px; indicador fijo de sesión podía tapar el enlace inferior en móvil.

Solución: encabezado separado de navegación y pie, altura 100dvh, min-height:0 y overflow-y:auto con barra nativa. El menú incluye el pie dentro del área desplazable. En móvil se reserva espacio para el indicador de sesión. En alturas móviles de hasta 360 px el encabezado también se desplaza. Colores, iconos, botones y lógica de permisos permanecen iguales.

Verificación: npx tsc --noEmit y npm run build pasaron. python tests/first-navigation.py ejecutó Chrome headless aislado con D1 temporal, gateway y proveedor OIDC sintético. Pasaron 70 comprobaciones, incluidas alturas 500/400/333 px de escritorio y móviles 390x420 y 390x260, rueda del mouse, clics por coordenadas en Usuarios/Correo SMTP/Métricas y accesibilidad por hit testing del enlace Volver a la agenda. Administrador accede y Producción obtiene 403. A-B-A, callback al calendario, logout, F5 y rechazo sin sesión pasaron. Las filas de usuarios y reservas sintéticas quedaron iguales y todas las sesiones fueron revocadas.

Límites: 125 % y 150 % se simularon mediante viewport CSS equivalente en Chrome; no se comprobó el ajuste nativo de zoom, un touchpad físico ni el arrastre manual de la barra. El enlace Volver se comprobó visible y sin bloqueo; no se navegó mediante ese enlace en la prueba. No se probó producción ni Docker Linux.

El callback pendiente sigue redirigiendo a /; /admin conserva su panel y permisos. Esta corrección no modifica autenticación, SQLite ni migraciones.

## Publicación manual

Esta carpeta no contiene .git. Utilizar el clon real del repositorio en la rama despliegue/grabaciones-dokploy, copiar estos tres archivos con sus rutas relativas y este informe, e incorporar también los archivos pendientes documentados en DESTINO_CALLBACK_CALENDARIO.md. No copiar outputs, perfiles Chrome, .env ni bases de datos.

En ese clon, revisar y ejecutar:

    git switch despliegue/grabaciones-dokploy
    git status --short
    git add app/admin/page.tsx app/admin/admin.css tests/first-navigation-browser.mjs CORRECCION_SIDEBAR_ADMIN.md
    git add -u
    git diff --cached --stat
    git diff --cached
    git commit -m "Corrige sidebar administrativo y retorno al calendario"
    git push origin despliegue/grabaciones-dokploy

Agregar explícitamente cualquier archivo nuevo del parche del callback que aparezca sin seguimiento; git add -u incluye solamente cambios de archivos ya versionados. Revisar el diff antes de commit.

No se ejecutaron commit, push ni despliegue. Al actualizar Dokploy conservar el volumen persistente existente /data/state y las variables actuales; no eliminar volúmenes ni reinicializar SQLite.
