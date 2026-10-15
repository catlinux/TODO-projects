# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

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
