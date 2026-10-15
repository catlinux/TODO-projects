# Plan: tokens de API y conector de IA (MCP)

Contexto: `docs/ARQUITECTURA.md` (sección «Conector de IA»), planes anteriores hechos. Marcar `[x]` al acabar; ante un imprevisto de diseño, parar y anotarlo aquí. Pensado para un solo usuario por cuenta (el multiusuario está aparcado).

Decisiones:
- Tokens personales: se guardan solo como hash SHA-256; el valor en claro se muestra una única vez al crearlo. Formato `tdp_<32 bytes base64url>`. Permisos: `lectura` (solo GET), `escritura` (lectura y escritura) y `calendario` (solo `GET /agenda.ics`, para suscribirse desde un calendario externo). Revocables, con fecha de último uso y caducidad opcional.
- `requireAuth` acepta la cookie de sesión o `Authorization: Bearer <token>`; con token se aplican los permisos. Los endpoints de gestión de tokens exigen sesión de cookie (un token no puede crear ni listar tokens).
- Registro de actividad: toda modificación hecha con un token queda en `actividad` con el estado anterior y posterior, y se puede deshacer.
- El servidor MCP vive en `apps/mcp`, habla con la API REST usando un token y transporte stdio; no accede a la base de datos.

- [ ] **G1. Tokens de API.** Tabla `tokens_api`, rutas `POST/GET/DELETE /tokens`, Bearer en `requireAuth` con permisos, `GET /agenda.ics` con token de calendario (`?token=` o Bearer), límite de intentos con token inválido, tests; web: página «Ajustes» para crear (mostrando el token una vez), listar y revocar.
- [ ] **G2. Registro de actividad y deshacer.** Tabla `actividad` (origen: web o token, acción, entidad, antes/después), alta automática al crear, editar, mover o borrar tareas con token, `GET /actividad` y `POST /actividad/:id/deshacer` (con comprobación de que el estado actual coincide con el «después»; si no, 409), vista en Ajustes.
- [ ] **G3. Servidor MCP.** `apps/mcp` con `@modelcontextprotocol/sdk`: herramientas `listar_proyectos`, `listar_tareas`, `crear_tarea`, `mover_tarjeta`, `actualizar_tarea`, `revisar_vencidas`, `resumir_proyecto`; configuración por `TODO_API_URL` y `TODO_API_TOKEN`; tests con la API simulada; `docs/CONECTOR-IA.md`.
- [ ] **G4. Cierre.** README, CHANGELOG, TODO, versión (menor).
