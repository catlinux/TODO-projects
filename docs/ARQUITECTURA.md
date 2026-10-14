# Arquitectura prevista

Decisiones de diseño iniciales; se revisarán al implementar.

## Estructura del repositorio (monorepo pnpm)

| Carpeta | Contenido |
|---|---|
| `apps/api` | Servidor: Fastify, Drizzle, PostgreSQL, WebSockets, tareas programadas |
| `apps/web` | Interfaz: React, Vite, TanStack Query, dnd-kit, FullCalendar |
| `apps/mcp` | Servidor MCP para conectar asistentes de IA |
| `packages/shared` | Tipos y esquemas zod compartidos entre API y web |
| `docs` | Documentación extensa |

## Decisiones

- **Servidor central**: necesario para el trabajo multiusuario. Se alojará en el VPS con Docker.
- **Un solo lenguaje (TypeScript)**: los esquemas de validación se comparten entre servidor y cliente.
- **Web primero**: la misma interfaz se empaqueta como app de escritorio (Tauri 2) y, más adelante, Android (Capacitor o Tauri móvil).
- **Tareas programadas con pg-boss**: cola sobre PostgreSQL, sin Redis. Cubre recordatorios y envíos automáticos.
- **Canales de aviso desacoplados**: interfaz común `Canal`. Primero correo (SMTP, Nodemailer) y Web Push; luego Telegram; WhatsApp y SMS al final por su coste y verificación.
- **Fechas**: guardadas en UTC, mostradas en la zona del usuario (por defecto `Europe/Madrid`). Recurrencias con RRULE.
- **Identificadores UUID y `updated_at`** en todas las tablas, para permitir sincronización sin conexión en el futuro.
- **i18n desde el inicio**: interfaz en español, con la puerta abierta a otros idiomas.

## Multiusuario

Roles por proyecto: propietario, administrador, miembro y lector. Invitaciones por correo. Cambios en directo por WebSocket. Comentarios con @menciones.

## Conector de IA

Servidor MCP apoyado en la API REST. Tokens por usuario, revocables y con permisos limitados. Herramientas previstas: `listar_tareas`, `crear_tarea`, `mover_tarjeta`, `resumir_proyecto`, `revisar_vencidas`. Todo lo que haga la IA queda en un **registro de actividad** y se puede deshacer.

## Interoperabilidad

Exportación del calendario en `.ics`; exportación e importación en JSON y CSV.
