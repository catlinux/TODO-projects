# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

## [0.7.1] - 2026-10-15

### Cambiado
- `docs/DESPLIEGUE.md`: la entrada con PIN y con huella queda probada en producción (Android).

## [0.7.0] - 2026-10-15

### Añadido
- Acceso personal con PIN de 6 a 12 dígitos (`POST /auth/pin`), con argon2, límite por IP y bloqueo global escalonado (cada 5 fallos seguidos: 1, 2, 4… minutos, hasta 24 h).
- Entrada con huella, cara o Windows Hello mediante passkeys (WebAuthn), verificadas sin dependencias: ES256, RS256 y EdDSA. Las passkeys no pasan por el bloqueo del PIN.
- `GET /auth/metodos` y pantalla de entrada adaptada a los métodos activos; aviso para activar la huella tras entrar con PIN; sección «Acceso» en Ajustes para ver, activar y borrar dispositivos.
- `deploy/fijar-pin.sh`: fija o cambia el PIN y crea el propietario si no existe.
- Variables `ACCESO_CORREO` (0 desactiva la entrada con correo) y `ORIGEN_PUBLICO` (activa las passkeys).

### Cambiado
- Tabla nueva `passkeys` y columna `usuarios.pin_hash` (migración compatible).

## [0.6.0] - 2026-10-15

### Añadido
- `REGISTRO_ABIERTO=0` cierra el registro: `/auth/registro` responde 403. Por defecto sigue abierto.
- `deploy/crear-usuario.sh` crea un usuario en producción pidiendo la contraseña sin mostrarla.

## [0.5.1] - 2026-10-15

### Añadido
- `.env.example` con las variables de entorno del despliegue.
- `deploy/backup-postgres.sh`: copia comprimida de PostgreSQL con validación y rotación.
- `deploy/apache-todo-project.conf`: vhost de referencia para Apache como proxy inverso.

### Cambiado
- Los servicios del compose de producción rotan sus logs (10 MB × 3).
- `deploy/Caddyfile`: Caddy confía en el proxy local y entrega a la API solo la IP real del cliente, para que el límite de intentos sea por IP y no se pueda falsear con `X-Forwarded-For`.
- `docs/DESPLIEGUE.md`: instalación probada en el VPS con Apache y Certbot, copia de seguridad y explicación de la IP real.

### Nota
- El despliegue con Docker se ha probado ya en un VPS. Siguen sin probarse la restauración de una copia, los avisos con SMTP y claves VAPID reales y el reinicio completo del servidor.

## [0.5.0] - 2026-10-15

### Añadido
- Marcar como hecha una ocurrencia suelta de una tarea recurrente (casilla en la Agenda; tachada en lista y calendario). Los avisos omiten las ocurrencias hechas.

### Cambiado
- `GET /agenda` incluye `hecha` en cada elemento. Tabla nueva `ocurrencias_hechas` (migración compatible).
- El test de `updated_at` comprueba ahora que se actualiza solo, sin fijarlo a mano.

## [0.4.0] - 2026-10-15

### Añadido
- Recordatorios: cada tarea puede avisar con antelación («Avisar antes»), también cada ocurrencia de las recurrentes. Un proceso periódico del servidor envía los avisos una sola vez, con recuperación tras reinicios.
- Canales de aviso: correo (SMTP configurable por variables de entorno) y Web Push del navegador (claves VAPID). Cada canal se activa solo si está configurado.
- Web: activar o desactivar los avisos del navegador y service worker.
- Límite de intentos en registro e inicio de sesión (por IP y por correo).
- Empaquetado de producción: Dockerfile, Caddy, `docker-compose.prod.yml` y guía de despliegue (`docs/DESPLIEGUE.md`).

### Cambiado
- Las tareas guardan `recordatorio_min`; hay tablas nuevas `avisos_enviados` y `suscripciones_push` (migración compatible).

### Nota
- Los canales de correo y push se han probado con transportes simulados; falta probarlos con un SMTP y claves VAPID reales. El despliegue con Docker tampoco se ha probado todavía.

## [0.3.0] - 2026-10-15

### Añadido
- Fecha y hora en las tareas, con recurrencia (diaria, semanal, mensual o anual; cada N; días de la semana; termina nunca o tras N veces) y zona horaria propia: la hora local se conserva al cruzar el cambio de hora.
- Edición de tareas (título, descripción, fecha y recurrencia) y navegación común con cierre de sesión.
- Agenda con vista de lista (próximos 30 días) y calendario mensual (FullCalendar), alimentada por `GET /agenda`.
- Exportación `.ics` (RFC 5545) con `GET /agenda.ics` y enlace de descarga en la web.

### Corregido
- Registros simultáneos con el mismo correo devolvían 500; ahora devuelven 409.
- `rrule` no se importaba en Node (la API no arrancaba con la recurrencia); ahora funciona en Node y en Vite.

## [0.2.0] - 2026-10-14

### Añadido
- Columnas configurables por proyecto: crear, renombrar, reordenar y borrar. Cada proyecto nuevo empieza con «Pendiente», «En curso» y «Hecha».
- Tablero Kanban con dnd-kit: arrastrar tarjetas entre columnas y reordenarlas, con la posición guardada en la API y alternativa sin arrastre (selector «Mover a»).

### Cambiado
- Las tareas ya no tienen `estado`: la columna lo sustituye y cada tarea guarda su `posicion`. La migración conserva los datos existentes (los estados pasan a las columnas por defecto). Cambio incompatible en la API; antes de la 1.0.0 cuenta como versión menor.

### Corregido
- Un PATCH de tarea sin `estado` ya no lo reiniciaba a «pendiente».

## [0.1.0] - 2026-10-14

### Añadido
- Monorepo pnpm (`apps/api`, `apps/web`, `packages/shared`) con TypeScript estricto, ESLint, Prettier y Vitest.
- API Fastify con Drizzle y PostgreSQL: tablas `usuarios`, `proyectos`, `tareas` y `sesiones`, con migraciones y `GET /salud`.
- Autenticación: registro, inicio y cierre de sesión con argon2 y cookie de sesión httpOnly.
- CRUD de proyectos y tareas, aislado por propietario y con validación zod compartida.
- Web mínima en español (React, Vite, i18n): acceso, proyectos y tareas.
- Docker Compose de desarrollo y CI en GitHub Actions.

## [0.0.1] - 2026-10-14

### Añadido
- Documentación inicial: README, CHANGELOG, TODO, arquitectura y hoja de ruta.
- Plan de trabajo ejecutable para las versiones 0.1 y 0.2.
- Archivo `VERSION`.
