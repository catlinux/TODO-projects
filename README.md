# TODO-projects

Gestor de tareas, agenda y proyectos con esteroides: tablero Kanban con tarjetas arrastrables, calendario, avisos por correo y notificaciones, trabajo en equipo en el mismo proyecto y un conector para que una IA pueda gestionarlo.

> **Estado: v0.25.2.** Acceso personal con PIN y huella, vista «Hoy», proyectos, tareas con fecha y recurrencia (con excepciones por ocurrencia), tablero Kanban con columnas configurables, agenda con calendario, asistente de IA con chat y voz (opcional, ver [docs/ASISTENTE.md](docs/ASISTENTE.md)), exportación `.ics` y recordatorios por correo y por el navegador (requieren configurar SMTP y claves VAPID, ver [despliegue](docs/DESPLIEGUE.md)). Aún sin trabajo en equipo: ver la [hoja de ruta](docs/HOJA-DE-RUTA.md).

- **Autor y mantenedor:** CatLinux
- **Idioma:** todo el proyecto (interfaz, documentación y commits) está en español.
- **Licencia:** [WNCL-1.0](LICENSE), uso no comercial (ver [Créditos y licencia](#créditos-y-licencia)).

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
- [Asistente de IA (chat y voz)](docs/ASISTENTE.md)
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

En desarrollo se entra con correo y contraseña. En producción el acceso es personal (ver más abajo) y la puesta en marcha está en [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

## Acceso y seguridad

En producción la aplicación es de un solo usuario y se entra sin correo ni contraseña:

- **PIN** de 6 a 12 dígitos, que se fija en el servidor con `deploy/fijar-pin.sh`. Se guarda con argon2. Además del límite de intentos por IP, cada 5 fallos seguidos (de cualquier IP) el PIN se bloquea para todos 1, 2, 4… minutos, hasta 24 horas.
- **Huella** (o cara, o Windows Hello) mediante passkeys (WebAuthn). La huella nunca sale del dispositivo: el servidor solo guarda una clave pública y comprueba una firma. Se activa desde un dispositivo en el que ya se ha entrado con PIN, en el aviso que aparece al entrar o en Ajustes › Acceso. Las passkeys no pasan por el bloqueo del PIN, así que fallar el PIN a propósito no deja fuera al propietario.
- Las passkeys quedan atadas al dominio (`ORIGEN_PUBLICO`): si cambia el dominio, hay que volver a activarlas.
- La sesión es una cookie `HttpOnly`, `Secure` en producción y `SameSite=Lax`, de una semana. Con `ORIGEN_PUBLICO` definido, la API rechaza las escrituras cuyo `Origin` sea otro (protección contra CSRF).
- Añadir una huella exige haber entrado hace menos de 10 minutos, para que una sesión robada no pueda registrar su propia passkey. En Ajustes › Acceso se pueden cerrar las demás sesiones, y cambiar el PIN con `deploy/fijar-pin.sh` las cierra todas.

Configuración: `ACCESO_CORREO=0`, `REGISTRO_ABIERTO=0` y `ORIGEN_PUBLICO=https://tu-dominio` en `.env` (ver [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md)).

## Versionado

[SemVer](https://semver.org/lang/es/) `x.y.z`. La versión actual está en el archivo [VERSION](VERSION). Antes de la `1.0.0`, un cambio incompatible sube la versión menor.

## Créditos y licencia

**TODO-projects** está desarrollado y mantenido por **CatLinux**.
Copyright (C) 2026 CatLinux.

Licencia [WNCL-1.0](LICENSE): puedes usarlo, estudiarlo, modificarlo y compartirlo gratis con fines no comerciales. Venderlo o cualquier uso comercial requiere permiso por escrito.

Las copias y los forks deben conservar esta atribución y enlazar a https://github.com/catlinux/TODO-projects.

### Material de terceros

Este proyecto no contiene material de terceros. Las dependencias que se instalan con pnpm conservan sus propias licencias.
