# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

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
