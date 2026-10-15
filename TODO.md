# Pendiente

## Prioridad alta

- Decidir la licencia del proyecto (usar la Skill `licencias`) antes de publicar código.
- Revisión de seguridad de la autenticación por un modelo potente (el fallo del registro simultáneo ya está corregido).
- Rediseño del aspecto de la web (tablero a ancho completo, columnas compactas, tarjetas limpias, color de acento); secundario frente a lo funcional.
- Empaquetado de producción: Dockerfile de la API y la web (hoy se arranca con `tsx`).
- Tests de la API: el de `updated_at` fija el valor a mano en lugar de comprobar que cambia solo.
- Rate limit en endpoints de autenticación (pendiente de seguridad).

## Prioridad media

- Kanban con tarjetas arrastrables (0.2).
- Calendario, agenda, recurrencias y exportación `.ics` (0.3).
- `.ics` con recurrencia: las zonas con horario de verano fuera de la UE (p. ej. `America/New_York`) caen al fallback en UTC porque aún no se generan sus reglas de VTIMEZONE.
- Recordatorios por correo y Web Push (0.4).
- Completar una ocurrencia suelta de una tarea recurrente y excepciones de la serie.
- Suscripción al calendario `.ics` por URL con token (hoy solo descarga con sesión; llega con el token de la 0.6).

## Prioridad baja

- Telegram, SMS y WhatsApp (0.9).
- Android (después de la 1.0).

## Descartado

- Partir de un proyecto existente (Vikunja, Planka, Kanboard, Wekan): se construye desde cero para poder elegir la licencia. Se pueden consultar para sacar ideas.
