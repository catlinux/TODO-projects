# TODO-projects

Gestor de tareas, agenda y proyectos con esteroides: tablero Kanban con tarjetas arrastrables, calendario, avisos por correo y notificaciones, trabajo en equipo en el mismo proyecto y un conector para que una IA pueda gestionarlo.

> **Estado: v0.4.0.** Registro e inicio de sesión, proyectos, tareas con fecha y recurrencia, tablero Kanban con columnas configurables, agenda con calendario, exportación `.ics` y recordatorios por correo y por el navegador (requieren configurar SMTP y claves VAPID, ver [despliegue](docs/DESPLIEGUE.md)). Aún sin trabajo en equipo: ver la [hoja de ruta](docs/HOJA-DE-RUTA.md).

- **Autor y mantenedor:** CatLinux
- **Idioma:** todo el proyecto (interfaz, documentación y commits) está en español.
- **Licencia:** pendiente de decidir. Hasta entonces, todos los derechos reservados.

## Qué quiere ser

- Lista de tareas y **agenda** con **calendario** (recurrencias, exportación `.ics`).
- **Avisos** por correo y notificaciones del navegador; más adelante Telegram, SMS o WhatsApp.
- **Envíos automatizados** de correos.
- **Planificador de proyectos**: Kanban, lista, calendario y línea de tiempo.
- **Multiusuario** en el mismo proyecto, con roles y cambios en directo.
- **Configurable**: columnas, etiquetas, campos y tarjetas arrastrables.
- **Conector de IA** (servidor MCP) para gestionar, editar y revisar con un asistente, con registro de actividad y opción de deshacer.

## Plataformas

1. Web, con servidor propio (primera versión).
2. Escritorio para Windows y Linux (Tauri), con la misma interfaz web.
3. Android, cuando lo anterior sea funcional.

## Tecnología prevista

TypeScript en todo el proyecto, con monorepo pnpm: Fastify + Drizzle + PostgreSQL (API), React + Vite (web), dnd-kit, FullCalendar, pg-boss (tareas programadas) y un servidor MCP. Detalle y motivos en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Documentación

- [Arquitectura](docs/ARQUITECTURA.md)
- [Hoja de ruta](docs/HOJA-DE-RUTA.md)
- [Despliegue en producción](docs/DESPLIEGUE.md)
- [Plan de trabajo ejecutable](.agents/plans/base/base.PLAN.md)
- [Cambios](CHANGELOG.md) · [Pendiente](TODO.md)

## Instalación y uso

Requisitos: Node.js 24, pnpm 10 y Docker (para PostgreSQL).

```sh
pnpm install
docker compose up -d          # PostgreSQL 16 de desarrollo (usuario, clave y base: todo)
```

En dos terminales (la API aplica las migraciones al arrancar):

```sh
export DATABASE_URL=postgres://todo:todo@localhost:5432/todo   # PowerShell: $env:DATABASE_URL = "..."
pnpm --filter @todo/api dev     # API en http://localhost:3000
pnpm --filter @todo/web dev     # web en http://localhost:5173 (proxifica /api a la API)
```

Abre la web, crea una cuenta y un proyecto: arrastra las tarjetas entre columnas, ponles fecha (con repetición si quieres) y míralas en la Agenda. El calendario se descarga en `/api/agenda.ics`.

Comprobaciones: `pnpm lint`, `pnpm typecheck`, `pnpm test` (los tests de la API usan PGlite y no necesitan Docker) y `pnpm --filter @todo/web build`.

Pendiente para producción: empaquetado con Docker, límite de intentos de acceso y revisión de seguridad (ver [TODO](TODO.md)).

## Versionado

[SemVer](https://semver.org/lang/es/) `x.y.z`. La versión actual está en el archivo [VERSION](VERSION). Antes de la `1.0.0`, un cambio incompatible sube la versión menor.
