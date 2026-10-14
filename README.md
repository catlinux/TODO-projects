# TODO-projects

Gestor de tareas, agenda y proyectos con esteroides: tablero Kanban con tarjetas arrastrables, calendario, avisos por correo y notificaciones, trabajo en equipo en el mismo proyecto y un conector para que una IA pueda gestionarlo.

> **Estado: fase de diseño (v0.0.1).** Todavía no hay código. Este repositorio contiene solo la documentación y el plan de trabajo.

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
- [Plan de trabajo ejecutable](.agents/plans/base/base.PLAN.md)
- [Cambios](CHANGELOG.md) · [Pendiente](TODO.md)

## Instalación y uso

Aún no disponibles: no hay nada que instalar todavía. Se documentarán aquí (o en `docs/INSTALACION.md` y `docs/USO.md`) cuando exista la primera versión usable.

## Versionado

[SemVer](https://semver.org/lang/es/) `x.y.z`. La versión actual está en el archivo [VERSION](VERSION). Antes de la `1.0.0`, un cambio incompatible sube la versión menor.
