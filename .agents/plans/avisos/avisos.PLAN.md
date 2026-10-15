# Plan 0.4: avisos (recordatorios) y endurecimiento

Contexto: `README.md`, `docs/ARQUITECTURA.md`, planes `base` y `calendario` (hechos). Marcar `[x]` al acabar cada paso; ante un imprevisto de diseño, parar y anotarlo aquí.

Decisiones:
- Recordatorio = `tareas.recordatorio_min` (minutos antes de `vence_en`, nullable); en una tarea recurrente aplica a cada ocurrencia.
- Sin colas por ocurrencia: un proceso periódico en el servidor (cada minuto) busca ocurrencias cuyo aviso vence en la ventana desde la última pasada y registra cada envío en `avisos_enviados` (único por tarea, ocurrencia y canal) para no duplicar aunque haya reinicios o varias instancias. `pg-boss` queda para cuando haya trabajos pesados; aquí no hace falta y no se puede probar sin Postgres real.
- Interfaz `Canal` desacoplada: `correo` (Nodemailer; SMTP por variables de entorno, desactivado si faltan) y `push` (Web Push con claves VAPID por variables de entorno). Telegram y demás, en la 0.9.
- Las credenciales (SMTP, claves VAPID) nunca van al repositorio: `.env` y variables de entorno; `.env.example` solo con nombres.

- [x] **A. Límite de intentos.** `@fastify/rate-limit` en `/auth/registro` y `/auth/login` (por IP y por correo en login), 429 en español, configurable por entorno, tests. Versión: parche en el cierre.
- [x] **B. Empaquetado de producción.** `Dockerfile` multi-etapa (API con tsx o compilada, web estática servida por Caddy o nginx con proxy `/api`), `docker-compose.prod.yml` con Postgres, variables en `.env.example`, `docs/DESPLIEGUE.md`. Sin poder probar Docker en el equipo: dejarlo documentado como no probado.
- [x] **C. Núcleo de avisos.** Migración (`recordatorio_min`, tablas `avisos_enviados` y `suscripciones_push`), interfaz `Canal`, canales `correo` y `push`, función `procesarAvisos(db, ahora, canales)` con tests con PGlite (ventana, recurrentes con zona, deduplicación, canal que falla no bloquea al resto), `recordatorioMin` en el esquema zod de tarea.
- [x] **D. Endpoints y arranque.** `GET /push/clave`, `POST/DELETE /push/suscripcion`, bucle periódico en `server.ts` (intervalo y desactivación por entorno), apagado limpio, tests.
- [x] **E. Web.** Campo «Avisar antes» en el formulario de tarea, service worker y botón «Activar avisos del navegador», estado de la suscripción.
- [ ] **F. Cierre 0.4.0.** README, CHANGELOG, TODO, versión (menor). Pendiente del usuario: credenciales SMTP y claves VAPID en producción.
