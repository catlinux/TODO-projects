# Pendiente

## Prioridad alta

- Probar en producción una subida de archivo y `deploy/backup-postgres.sh` con archivos (copia y restauración del `tar`).

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

- Deshacer con el conector el borrado de una tarea no recupera sus adjuntos (los ficheros se borran del disco al borrarla). Auditoría v3.
- Los registros de actividad de etiquetas y archivos guardan `antes = despues`, así que deshacerlos no cambia nada. Auditoría v3.
- El límite de 20 adjuntos por tarea y 10 fondos por proyecto se comprueba antes de subir, sin bloqueo: dos subidas simultáneas pueden superarlo en uno. Auditoría v3.
- Telegram, SMS y WhatsApp (0.9).
- Android (después de la 1.0).

## Descartado

- Partir de un proyecto existente (Vikunja, Planka, Kanboard, Wekan): se construye desde cero para poder elegir la licencia. Se pueden consultar para sacar ideas.
