# Pendiente

## Prioridad alta


- Añadir `Strict-Transport-Security` en el vhost 443 de Apache (configuración del sistema: requiere aprobación).
- Rediseño del aspecto de la web (tablero a ancho completo, columnas compactas, tarjetas limpias, color de acento); secundario frente a lo funcional.

- Probar la restauración de una copia de PostgreSQL y activar la copia diaria (timer propuesto en `docs/DESPLIEGUE.md`).

- Probar los avisos con un SMTP y claves VAPID reales (correo y Web Push) y configurar `.env` en producción.

## Prioridad media

- El snapshot de drizzle-kit (`apps/api/drizzle/meta`) no refleja las migraciones escritas a mano (0002, 0009): `drizzle-kit generate` pide renombrados. Regenerarlo antes de volver a generar migraciones.
- `pnpm test` en paralelo (web y API) hace fallar a veces el `beforeAll` de PGlite por tiempo de espera; por separado pasa siempre.
- El token de `/agenda.ics?token=` queda en los logs de Apache (solo tiene permiso de calendario); valorar no registrar la query de esa ruta.
- El bloqueo global del PIN puede mantenerse a 24 h si alguien insiste a propósito (la huella sigue funcionando); se acepta por diseño.
- Prueba E2E de la huella con el autenticador virtual de Chromium (no hay Playwright en el proyecto).

- Kanban con tarjetas arrastrables (0.2).
- Calendario, agenda, recurrencias y exportación `.ics` (0.3).
- `.ics` con recurrencia: las zonas con horario de verano fuera de la UE (p. ej. `America/New_York`) caen al fallback en UTC porque aún no se generan sus reglas de VTIMEZONE.
- Excepciones de una serie recurrente (mover o editar una sola ocurrencia).
- Suscripción al calendario `.ics` por URL con token (hoy solo descarga con sesión; llega con el token de la 0.6).

## Prioridad baja

- Telegram, SMS y WhatsApp (0.9).
- Android (después de la 1.0).

## Descartado

- Partir de un proyecto existente (Vikunja, Planka, Kanboard, Wekan): se construye desde cero para poder elegir la licencia. Se pueden consultar para sacar ideas.
