# Cliente Keycloak exclusivo para Dokploy

No se accedió ni modificó Keycloak. La versión y realm corporativo todavía deben identificarse con su administrador.

## Configuración del cliente nuevo

En http://172.20.16.180:8080, seleccione el realm corporativo correcto; no use master por defecto. Abra la configuración OIDC de ese realm y copie exactamente su issuer:
http://172.20.16.180:8080/realms/NOMBRE_REALM/.well-known/openid-configuration

Cree exclusivamente un cliente nuevo con estos valores:

| Campo | Valor |
|---|---|
| Client type / protocolo | OpenID Connect |
| Client ID | grabaciones |
| Client authentication | ON; cliente confidencial |
| Authorization | OFF, salvo política corporativa expresamente requerida |
| Standard Flow | ON, Authorization Code |
| Implicit Flow | OFF |
| Direct Access Grants | OFF |
| Service Accounts | OFF |
| PKCE code challenge method | S256, requerido |
| Root URL | https://grabaciones.ed |
| Home URL | https://grabaciones.ed/ |
| Valid Redirect URIs | https://grabaciones.ed/api/auth/keycloak/callback |
| Valid Post Logout Redirect URIs | https://grabaciones.ed/ |
| Web Origins | https://grabaciones.ed |
| ID Token signature | RS256 |

No use comodines. Los nombres de las secciones cambian entre versiones; PKCE suele estar en Advanced/Advanced settings. No deshabilite TLS o políticas del realm compartido para sortear errores: coordine cualquier excepción de laboratorio con el administrador.

En Credentials copie el Client Secret y péguelo solo en Environment de Dokploy como KEYCLOAK_CLIENT_SECRET. La aplicación envía client_secret_post en el intercambio del código; use el método Client ID and Secret compatible con ese método. No cree contraseñas locales.

## Identidad y roles

Conserve los scopes openid, profile y email; asegure que ID Token y UserInfo incluyen sub, email, email_verified=true y nombre. No marque manualmente correos ajenos como verificados. Las cuentas deben proceder del directorio corporativo, y el cliente debe estar limitado al grupo de usuarios autorizado según la política del realm.

La aplicación valida firma RS256 con JWKS, issuer exacto, aud, azp cuando hay varias audiencias, exp, iat, nbf, nonce y coincidencia del subject/correo verificado con UserInfo. Utiliza state y PKCE S256. Un token con un correo no verificado se rechaza.

El rol de autorización procede de users.role en SQLite, no de realm_access ni resource_access del token. No basta crear un rol administrador en Keycloak para obtener privilegios locales. El primer administrador se asigna offline; nuevas identidades corporativas verificadas reciben produccion. Roles locales admitidos: administrador, jefe_operaciones, jefe_produccion, productor, operador, editor, produccion y visor. No existe un mecanismo para autoasignarse administrador.

## Variables

~~~dotenv
KEYCLOAK_ISSUER=http://172.20.16.180:8080/realms/NOMBRE_REALM
KEYCLOAK_CLIENT_ID=grabaciones
KEYCLOAK_CLIENT_SECRET=CONFIGURAR_SOLO_EN_ENVIRONMENT
KEYCLOAK_PUBLIC_ORIGIN=https://grabaciones.ed
~~~
LOCAL_AUTH_BYPASS=false lo fija Compose. APP_BASE_PATH es vacío: por eso el callback confirmado en el código es exactamente https://grabaciones.ed/api/auth/keycloak/callback.

## Verificar conectividad y coincidencia del issuer

Desde el navegador del usuario abra el discovery del realm y el authorization_endpoint publicado. Desde el contenedor ejecute:
~~~sh
docker compose exec gestion-ed node -e "const i=process.env.KEYCLOAK_ISSUER;fetch(i+'/.well-known/openid-configuration').then(r=>r.json()).then(d=>{if(d.issuer!==i)throw Error('Issuer no coincide');console.log('Issuer correcto');return fetch(d.jwks_uri)}).then(r=>{if(!r.ok)throw Error('JWKS inaccesible');console.log('JWKS accesible')}).catch(e=>{console.error(e.message);process.exitCode=1})"
~~~
El script consulta discovery y JWKS y compara issuer, sin imprimir secret. No valida credenciales ni crea usuarios. Si la IP/hostname publicado por Keycloak no es accesible tanto desde el navegador como desde el contenedor, corrija DNS/rutas con el responsable. No reescriba silenciosamente el issuer a otro nombre interno.

Luego pruebe login con una cuenta corporativa de prueba, revise el callback, confirme el rol local, cierre sesión y compruebe que la sesión local dejó de funcionar. La sesión conserva en SQLite el ID Token validado y el end_session_endpoint descubierto para enviar id_token_hint al logout oficial. Se eliminan al revocar esa sesión; no se almacenan access_token ni refresh_token. Las sesiones anteriores a la migración 0022, sin hint, pueden requerir confirmación de Keycloak.

## Sesiones y HTTPS

Cookie ed_session_v2: HttpOnly, SameSite=Strict, Max-Age=43200; Secure cuando el origen configurado es HTTPS. Cookies state/nonce/verifier: HttpOnly, SameSite=Lax, duración 600 segundos y Secure en HTTPS. SQLite almacena el hash del token de sesión. Cerrar sesión elimina su hash; desactivar el usuario local bloquea sus sesiones.

No está implementado backchannel logout: cerrar sesión en otro sistema o deshabilitar solo en Keycloak no revoca instantáneamente una sesión local. Si su política exige esa revocación inmediata, esto requiere trabajo adicional antes del uso real.

**La aplicación ya queda configurada para HTTPS. Keycloak sigue en HTTP:** ese tramo todavía expone credenciales y códigos de autorización. Coordine HTTPS del IdP con su administrador antes de usuarios reales; mantenga issuer y endpoints publicados coherentes. No desactive validación TLS. No confíe en un X-Forwarded-Proto aportado por el cliente: Secure depende de la URL pública configurada.

Fuentes: [administración de clientes y logout de Keycloak](https://www.keycloak.org/docs/latest/server_admin/), [protocolo OIDC](https://www.keycloak.org/docs/24.0.5/securing_apps/).
