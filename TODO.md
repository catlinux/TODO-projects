# Pendiente

## Prioridad alta

- Acceso personal solo con PIN (6 a 12 dígitos) y huella (passkeys/WebAuthn), sin correo ni contraseña; el PIN con argon2, límite por IP y bloqueo escalonado, y la huella fuera de ese bloqueo (0.7.0).

- Decidir la licencia del proyecto (usar la Skill `licencias`) antes de publicar código.
- Revisión de seguridad de la autenticación por un modelo potente (el fallo del registro simultáneo ya está corregido).
- Rediseño del aspecto de la web (tablero a ancho completo, columnas compactas, tarjetas limpias, color de acento); secundario frente a lo funcional.

- Probar la restauración de una copia de PostgreSQL y activar la copia diaria (timer propuesto en `docs/DESPLIEGUE.md`).

- Probar los avisos con un SMTP y claves VAPID reales (correo y Web Push) y configurar `.env` en producción.

## Prioridad media

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
