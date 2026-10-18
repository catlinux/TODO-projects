# Pendiente

## Prioridad alta

- Probar en producción una subida de archivo y `deploy/backup-postgres.sh` con archivos (copia y restauración del `tar`).

- Probar la restauración de una copia de PostgreSQL y activar la copia diaria (timer propuesto en `docs/DESPLIEGUE.md`).

- Probar los avisos con un SMTP y claves VAPID reales (correo y Web Push) y configurar `.env` en producción.

## Prioridad media

- El token de `/agenda.ics?token=` queda en los logs de Apache (solo tiene permiso de calendario); valorar no registrar la query de esa ruta.
- El bloqueo global del PIN puede mantenerse a 24 h si alguien insiste a propósito (la huella sigue funcionando); se acepta por diseño.
- Prueba E2E de la huella con el autenticador virtual de Chromium (no hay Playwright en el proyecto).

- `.ics` con recurrencia: las zonas con horario de verano fuera de la UE (p. ej. `America/New_York`) caen al fallback en UTC porque aún no se generan sus reglas de VTIMEZONE.
- Excepciones de una serie recurrente (mover o editar una sola ocurrencia).

## Prioridad baja

- Telegram, SMS y WhatsApp (0.9).
- Android (después de la 1.0).

## Descartado

- Recuperar los adjuntos al deshacer el borrado de una tarea: los ficheros se borran del disco al borrarla y conservarlos exigiría una papelera con caducidad (documentado en `docs/ARQUITECTURA.md`).
- Partir de un proyecto existente (Vikunja, Planka, Kanboard, Wekan): se construye desde cero para poder elegir la licencia. Se pueden consultar para sacar ideas.
