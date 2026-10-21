# Avisos del calendario y alertas: estudio y plan

Escrito por Sonnet el 2026-10-21 tras leer el código (`apps/api/src/avisos/*`, `apps/api/src/server.ts`, `apps/web/public/sw.js`, `docs/DESPLIEGUE.md`). Es un estudio: nada de esto está implementado ni probado contra servicios reales.

## Qué existe ya

- Cada tarea con fecha puede llevar `recordatorioMin` (minutos de antelación); las recurrentes avisan por ocurrencia y respetan las excepciones (0.18.0).
- Bucle en el servidor cada 60 s (`bucle.ts` → `procesar.ts`) con marcas en `avisos_enviados` para no repetir un aviso; si no hay destino, deja la ocurrencia pendiente.
- Dos canales: **correo** (SMTP con nodemailer) y **Web Push** (`web-push`, claves VAPID, service worker `sw.js` que muestra la notificación y abre la URL).
- En Ajustes hay una tarjeta «Avisos en este navegador» (`AvisosNavegador`) que suscribe el navegador.

## Por qué hoy no llega nada

Producción arranca con «Sin canales de avisos configurados»: faltan en `.env` las variables SMTP y/o las tres VAPID (`docker-compose.prod.yml` ya las pasa al contenedor). No es un fallo de código: es configuración y credenciales tuyas. Nunca se ha probado con un servicio real (ver `TODO.md`).

## Huecos que he visto

1. **Sin botón «Enviar aviso de prueba»**: no hay forma rápida de comprobar un canal sin crear una tarea y esperar.
2. **Sin manifiesto PWA** (`apps/web/public` solo tiene `favicon.svg` y `sw.js`): en iPhone/iPad, Web Push solo funciona con la web instalada en la pantalla de inicio, y para eso hace falta `manifest.webmanifest` e iconos. En Android y escritorio no hace falta.
3. **Solo recordatorio previo**: no hay aviso de «tarea vencida», ni resumen diario de la mañana, ni recordatorio por defecto para las tareas nuevas con fecha.
4. **Sin canal de móvil sencillo** aparte de Web Push: Telegram/ntfy están en el TODO de baja prioridad.
5. **El `.ics`** (`/agenda.ics`) no incluye `VALARM`; por lo que sé, Google Calendar no dispara avisos de calendarios suscritos por URL, aunque lo traigan (no verificado).
6. **Correo**: el aviso va al `email` del usuario en la base de datos; con acceso por PIN/huella ese correo puede no ser real. Hay que comprobarlo (no lo he mirado para no mostrar datos).

## Opciones de canal (decisión tuya)

| Canal | Qué necesitas | Pros | Contras |
|---|---|---|---|
| Web Push | Generar 3 variables VAPID (`npx web-push generate-vapid-keys`) y activar en cada dispositivo | Gratis, sin cuentas externas, ya implementado | iOS exige instalar la web como app; el navegador debe poder recibir en segundo plano |
| Correo | Un SMTP (p. ej. Gmail con contraseña de aplicación, o un servicio transaccional) | Ya implementado, llega a cualquier sitio | Lento de ver; riesgo de spam; guardar credencial SMTP |
| ntfy | Cuenta o servidor ntfy y una app en el móvil | Muy fiable en móvil, HTTP trivial | Hay que implementarlo (canal nuevo, poco código) |
| Telegram | Un bot (token de BotFather) y tu chat id | Cómodo, sin instalar nada raro | Hay que implementarlo; el token es un secreto |

Recomendación: **Web Push + ntfy o Telegram** (instantáneo en el móvil) y correo como respaldo si ya tienes SMTP.

## Pasos propuestos (cuando decidas)

1. **Configuración (tú, con mi guía)**: generar VAPID, ponerlas en `.env`, reiniciar la API, activar en Ajustes → Avisos en cada dispositivo. Cambia la configuración del servidor: necesita tu aprobación.
2. **Botón «Enviar aviso de prueba»** por canal en Ajustes (API + web). AgentRelay, esfuerzo medio.
3. **Manifiesto PWA e iconos** para instalar la web en el móvil (necesario en iOS). AgentRelay, esfuerzo bajo.
4. **Canal ntfy y/o Telegram** (`canal-ntfy.ts`/`canal-telegram.ts`, configuración por usuario cifrada como la clave del asistente). AgentRelay, esfuerzo medio.
5. **Recordatorio por defecto, aviso de vencidas y resumen diario** configurables por usuario. AgentRelay, esfuerzo medio.
6. **`VALARM` en el `.ics`** con el `recordatorioMin` de cada tarea. AgentRelay, esfuerzo bajo.
7. Probar con servicios reales y actualizar `docs/DESPLIEGUE.md` y el `TODO.md`.

## Dudas abiertas
- ¿Qué dispositivos usas (Android, iPhone, PC)? Decide si hace falta el paso 3.
- ¿ntfy o Telegram?
- ¿Es real el correo de tu usuario?
