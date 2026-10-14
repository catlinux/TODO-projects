# Plan base: versiones 0.1 y 0.2

Contexto: ver `README.md` y `docs/ARQUITECTURA.md`. Idioma: español en interfaz, commits y docs; comentarios de código solo con el porqué. Cada paso: marcar `[x]` al acabar; ante un imprevisto de diseño, parar y anotarlo aquí.

## 0.1

- [x] **1. Monorepo.** pnpm workspaces, TypeScript estricto, ESLint, Prettier, Vitest; carpetas `apps/api`, `apps/web`, `packages/shared`. Criterio: `pnpm install && pnpm test` pasan. Ejecutor: AgentRelay (esfuerzo medio). Sin entrada de CHANGELOG hasta cerrar la 0.1.
- [x] **2. Base de datos y API.** Fastify + Drizzle + PostgreSQL (Docker Compose para desarrollo); tablas `usuarios`, `proyectos`, `tareas` con UUID, `created_at` y `updated_at`. Criterio: las migraciones se aplican y hay tests de integración. Ejecutor: AgentRelay (medio).
- [x] **3. Autenticación.** Registro e inicio de sesión (argon2, sesión por cookie httpOnly). Criterio: tests de registro, login y rutas protegidas. Revisión de seguridad por Opus. **Pendiente: revisión de seguridad por Opus** (implementado por AgentRelay; posible 500 en registro concurrente con el mismo correo por la restricción única).
- [x] **4. CRUD de proyectos y tareas** en la API, con validación zod compartida desde `packages/shared`. Ejecutor: AgentRelay (medio).
- [x] **5. Web mínima.** React + Vite: login, lista de proyectos, lista de tareas, crear/editar/borrar. Interfaz en español con i18n. Ejecutor: AgentRelay (medio).
- [x] **6. CI y cierre.** GitHub Actions (lint, test, build), README con instalación y uso reales, CHANGELOG, versión **0.1.0** (menor: primera funcionalidad).

## 0.2

- [ ] **7. Columnas configurables por proyecto** (modelo, API y gestión en la web).
- [ ] **8. Tablero Kanban** con dnd-kit: arrastrar tarjetas entre columnas y reordenar, persistiendo la posición. Versión **0.2.0** (menor).
