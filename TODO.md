# Pendiente

## Prioridad alta

- Aplicar en el VPS la v3 (necesita tu aprobación): `git pull`, `up -d --build` (crea el volumen `archivos_data` y aplica las migraciones 0010 a 0015) y probar una subida y una copia de seguridad con archivos.

- Auditoría con Opus de la v3 (seguridad de subidas, permisos de cada endpoint nuevo, accesibilidad, coherencia visual).

- Probar la restauración de una copia de PostgreSQL y activar la copia diaria (timer propuesto en `docs/DESPLIEGUE.md`).

- Probar los avisos con un SMTP y claves VAPID reales (correo y Web Push) y configurar `.env` en producción.

## Prioridad media

- `pnpm test` en paralelo (web y API) hace fallar a veces el `beforeAll` de PGlite por tiempo de espera; por separado pasa siempre. Algo parecido pasa a veces con el test de cerrar sesión de `BarraNavegacion.test.tsx`.
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
