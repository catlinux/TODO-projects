# Acceso personal con PIN y huella (0.7.0)

Objetivo: en producción se entra solo con un PIN de 6 a 12 dígitos o con una passkey (huella, cara o Windows Hello) del dispositivo. Sin correo ni contraseña. El acceso por correo sigue en el código (futuro multiusuario) pero se desactiva por configuración.

## Decisiones

- **Un solo propietario.** `usuarios.pin_hash` (nullable, argon2). Solo un usuario puede tener PIN: el script `fijar-pin` lo garantiza. Si no hay usuarios, el script crea el propietario (correo opcional; sin él, `propietario@todo.invalid`, y contraseña aleatoria inutilizable).
- **Configuración:** `ACCESO_CORREO=0` hace que `/auth/login` (correo) responda 403; `REGISTRO_ABIERTO=0` ya cierra el registro; `ORIGEN_PUBLICO=https://dominio` activa WebAuthn (`rpId` = host). Por defecto (tests, desarrollo) el correo sigue activo.
- **PIN:** `POST /auth/pin {pin}`; límite por IP (el de login) + **bloqueo global escalonado** en memoria: cada 5 fallos seguidos, bloqueo de 1, 2, 4… minutos (máx. 24 h) para todos. Se reinicia al entrar con PIN o huella. Un reinicio del contenedor lo reinicia (aceptado).
- **Passkeys (WebAuthn) sin dependencias:** el cliente envía `getPublicKey()` (SPKI DER) y `getPublicKeyAlgorithm()`, así no hace falta CBOR. Algoritmos −7 (ES256), −257 (RS256), −8 (EdDSA). Retos de un solo uso en memoria, 2 min, con tope de tamaño. Se verifica `type`, reto, `origin`, hash del `rpId`, banderas UP y UV, que el id de credencial coincide con el de `authenticatorData` (registro) y la firma sobre `authenticatorData || sha256(clientDataJSON)` (entrada). Contador: si alguno es > 0 y el nuevo no supera al guardado, se rechaza.
- Las passkeys **no** pasan por el bloqueo global del PIN: así un atacante que bloquee el PIN no deja fuera al propietario.
- Registro y borrado de passkeys solo con sesión de cookie (no con tokens de API).
- `GET /auth/metodos` (público): `{ correo, registro, pin, huella }` para que la web pinte la entrada.

## Rutas

| Ruta | Acceso |
|---|---|
| `GET /auth/metodos` | pública |
| `POST /auth/pin` | pública, límite por IP + bloqueo global |
| `POST /auth/huella/entrada-opciones`, `POST /auth/huella/entrada` | públicas, límite por IP |
| `POST /auth/huella/registro-opciones`, `POST /auth/huella/registro` | sesión de cookie |
| `GET /auth/huella`, `DELETE /auth/huella/:id` | sesión de cookie |

## Pasos

1. [x] **Servidor** (Opus, esta sesión): migración 0009 (`pin_hash`, tabla `passkeys`), `apps/api/src/webauthn.ts` (verificación pura), `apps/api/src/acceso.ts` (rutas y bloqueo), `fijar-pin.ts` + `deploy/fijar-pin.sh`, tests con claves generadas con `node:crypto` (P-256, RSA, Ed25519): reto reutilizado o caducado, origin y rpId incorrectos, sin UV, contador que retrocede, firma mala, bloqueo escalonado. Hecho: typecheck, lint, prettier y tests en verde.
2. [x] **Web** (AgentRelay, esfuerzo medio): `apps/web/src/huella.ts` (base64url, registrar, entrar), `Login.tsx` según `/auth/metodos` (PIN; botón «Entrar con huella» si `isUserVerifyingPlatformAuthenticatorAvailable()`, lanzado solo si este dispositivo ya la tiene, marca en localStorage; aviso «¿Entrar con huella en este dispositivo? Activar / Ahora no» tras entrar con PIN, recordando «Ahora no»), sección «Acceso» en Ajustes (lista con nombre, alta y último uso, borrar, «Activar huella en este dispositivo», nota de `deploy/fijar-pin.sh`). Textos en `i18n/es.json`. Tests de Login y Ajustes.
3. [ ] **Despliegue y documentación** (Opus): `.env` (`ACCESO_CORREO=0`, `ORIGEN_PUBLICO`), compose, `docs/DESPLIEGUE.md`, README (seguridad y uso), CHANGELOG 0.7.0, TODO. Las passkeys quedan atadas al dominio. Prueba real: el propietario fija el PIN, entra en ordenador y móvil y activa la huella.
