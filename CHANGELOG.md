# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

## [0.16.2] - 2026-10-18

### Corregido
- Los límites de 20 adjuntos por tarea y 10 fondos por proyecto ya no se pueden superar con subidas simultáneas (se comprueban dentro de una transacción con bloqueo de fila) y el fichero solo se escribe en disco si cabe.
- Subir o borrar archivos y cambiar etiquetas con un token de API ya no crea entradas inútiles en el registro de actividad (no eran deshacibles); el historial de la tarjeta se mantiene.

## [0.16.1] - 2026-10-18

### Corregido
- `pnpm test` en la raíz ejecuta los paquetes en secuencia y el `beforeAll` de PGlite tiene un tiempo de espera de 60 s: ya no falla por carga.
- El test de cerrar sesión del menú deja de ser intermitente: simula el 401 posterior al cierre y espera al estado final de la caché.

## [0.16.0] - 2026-10-18

### Añadido
- Estilos visuales intercambiables, independientes del modo claro/oscuro: «Sobrio» (el de la 0.15.0, por defecto) y «Sereno» (grises cálidos, menú lateral tenue en la misma familia que el contenido y menos líneas). Se eligen en Ajustes › Apariencia, que también reúne el modo, o con «Cambiar estilo» en la paleta (Ctrl/⌘+K). La preferencia se guarda en el navegador.

### Cambiado
- Los tokens de cada estilo viven en su propio archivo (`apps/web/src/temas/sobrio.css` y `sereno.css`); `estilos.css` solo contiene estructura y componentes.

## [0.15.0] - 2026-10-18

### Cambiado
- Aspecto v4, más sobrio y legible: tipografía Inter (cifras de ancho fijo en lugar de fuente mono), menú lateral oscuro en ambos temas y contenido en un panel encajado, estados de fecha y etiquetas en tintas suaves, controles y diálogos con un estilo común.
- La página del proyecto ocupa todo el panel con su fondo; columnas y tarjetas refinadas, con desplazamiento dentro de cada columna.
- Tarjeta abierta, Hoy, Agenda, Bandeja, Proyectos, Ajustes y pantallas de entrada adaptadas al nuevo estilo.
- El tema se elige con un control de tres iconos en el menú; «Nuevo proyecto» es un botón «+» junto a la sección de proyectos; los avisos del navegador pasan a Ajustes.

### Corregido
- El menú lateral ya no se desborda en horizontal con nombres de proyecto largos.

## [0.14.1] - 2026-10-18

### Corregido
- La inicial del proyecto ignora signos y corchetes iniciales («[Prueba] Viaje» → «P»).
- El menú lateral ya no desborda con nombres largos (elipsis) y el campo de «Añadir tarjeta» no se sale de la columna.
- Botón «Añadir tarjeta» con más contraste y columnas vacías más discretas.

## [0.14.0] - 2026-10-18

### Añadido
- Adjuntos en la tarjeta (subir con botón o arrastrando, miniaturas, abrir, borrar) y portada con imagen: `POST /tareas/:id/archivos`, `GET /tareas/:id/archivos`, `GET /archivos/:id` y `DELETE /archivos/:id`. El tipo de imagen se decide por los primeros bytes del fichero, el resto se sirve como descarga, y las respuestas llevan `nosniff` y una CSP restrictiva. Límite `ARCHIVOS_MAX_MB` (10) y directorio `ARCHIVOS_DIR` (`/data/archivos`). Migración `0015`.
- Fondos de proyecto con imágenes: una fija o varias en carrusel con fundido (intervalo configurable, sin animación con «reducir movimiento» y en pausa con la pestaña oculta); `POST /proyectos/:id/fondos`.
- Despliegue de los archivos: volumen `archivos_data` en `docker-compose.prod.yml`, `/data/archivos` con el propietario correcto en el Dockerfile, límite de 12 MB en el Caddyfile, copia de los archivos en `deploy/backup-postgres.sh` y sección en `docs/DESPLIEGUE.md`.

## [0.13.0] - 2026-10-18

### Añadido
- Paleta de búsqueda y comandos (Ctrl/⌘+K) con búsqueda de tareas y proyectos (`GET /buscar`, con comodines de `ILIKE` escapados) y acciones rápidas.
- Atajos de teclado fuera de los campos de texto: `N` nueva tarea, `G H` Hoy, `G A` Agenda, `G B` Bandeja y `?` para ver la lista.
- Bandeja de entrada: captura rápida de tareas y «Mover a…» cualquier proyecto y columna; `GET /bandeja` y `POST /tareas/:id/mover` (al cambiar de proyecto se quitan las etiquetas y queda constancia en el historial). Contador en el menú. Migración `0014`.

## [0.12.0] - 2026-10-18

### Añadido
- Comentarios en la tarjeta (Ctrl+Intro para enviar; solo el autor edita o borra) e historial de cambios (creación, movimientos, fechas, etiquetas, checklist y portada) en un panel de actividad: `POST /tareas/:id/comentarios`, `PATCH/DELETE /comentarios/:id` y `GET /tareas/:id/actividad` paginado.
- Portada de tarjeta: 6 colores y 4 patrones, visible en el tablero; `PATCH /tareas/:id` acepta `portada`.
- Insignia de comentarios en las tarjetas; `GET /proyectos/:id/tareas` devuelve `comentarios`. Migración `0013`.

## [0.11.0] - 2026-10-18

### Añadido
- La tarjeta se abre como página propia (`/proyectos/:id/tareas/:tareaId`) con enlace compartible: título editable, columna, casilla «Hecha», fecha, aviso, repetición y descripción con formato (negrita, cursiva, código, listas y enlaces http/https).
- Etiquetas por proyecto (8 colores) con selector, creación, renombrado y borrado; `GET/POST /proyectos/:id/etiquetas`, `PATCH/DELETE /etiquetas/:id` y `PUT /tareas/:id/etiquetas`. Filtro por etiqueta en el tablero.
- Checklist por tarea con progreso, ocultar hechos y reordenación; `GET/POST /tareas/:id/checklist` y `PATCH/DELETE /checklist/:id`. Insignia `n/m` en la tarjeta.
- `GET /proyectos/:id/tareas` devuelve `etiquetas` y `checklist`. Migraciones `0011` y `0012`.

### Cambiado
- La edición en línea de la tarjeta se sustituye por la tarjeta abierta.

## [0.10.0] - 2026-10-18

### Añadido
- Color y fondo propios de cada proyecto (`color` y `fondo` en la API, migración `0010`) y diálogo «Fondo» para personalizar nombre, color y fondo: cinco ambientes con curvas de nivel o color liso.
- Tema claro, oscuro o del sistema, con selector en el menú.
- Alta de tarjetas en línea al pie de cada columna y menú «⋯» en cada tarjeta (editar, mover, eliminar).
- Vista «Hoy» con saludo, cifras y progreso por proyecto; `GET /agenda` devuelve `primeraColumnaId`, `ultimaColumnaId` y `hecha`.

### Cambiado
- Aspecto v3: tipografía Geist, menú lateral con perfil y contador de Hoy, tablero sobre el fondo del proyecto con columnas translúcidas, agenda con eventos compactos (máximo 2 por día).
- «Hecha» significa estar en la última columna del proyecto (las tareas recurrentes se siguen marcando por ocurrencia).

## [0.9.1] - 2026-10-18

### Corregido
- El snapshot de drizzle-kit refleja el esquema real (incluidas las migraciones escritas a mano): `drizzle-kit generate` ya no propone cambios ni renombrados.

## [0.9.0] - 2026-10-18

### Añadido
- Vista «Hoy», nueva página de inicio: atrasadas, hoy y próximos 7 días, con casilla para marcar como hecha y contador en el menú.
- Panel «Próximos avisos» en la agenda (avisos de los próximos 7 días); `GET /agenda` incluye `recordatorioMin` en cada ocurrencia.
- «Cerrar sesión» en Ajustes, para el móvil.

### Cambiado
- Rediseño completo de la web: menú lateral con los proyectos y su color (barra inferior en el móvil), tipografías Plus Jakarta Sans e IBM Plex Mono autoalojadas, tablero a todo el ancho con columnas compactas, tarjetas con chip de fecha (atrasada, próxima o normal) e iconos de aviso y repetición, «Nueva tarea» en un diálogo, gestión de columnas en un menú de cada columna, agenda con el tema nuevo, Ajustes en tarjetas y entrada con la tarjeta centrada.

## [0.8.1] - 2026-10-18

### Añadido
- Licencia WNCL-1.0 (uso no comercial) con titular CatLinux: `LICENSE`, sección «Créditos y licencia» en el README y `author`/`license` en `package.json`.

## [0.8.0] - 2026-10-18

### Añadido
- `POST /auth/cerrar-sesiones` y botón «Cerrar las demás sesiones» en Ajustes › Acceso.

### Seguridad
- Con `ORIGEN_PUBLICO` definido, la API rechaza con 403 las escrituras cuyo `Origin` no coincide (protección contra CSRF además de `SameSite=Lax`).
- Registrar una passkey exige una sesión de menos de 10 minutos; si es más antigua, la web pide salir y volver a entrar.
- `deploy/fijar-pin.sh` cierra todas las sesiones de los usuarios afectados.
- Las sesiones caducadas de un usuario se borran al crear una nueva.

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
