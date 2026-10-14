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
- Recordatorios por correo y Web Push (0.4).

## Prioridad baja

- Telegram, SMS y WhatsApp (0.9).
- Android (después de la 1.0).

## Descartado

- Partir de un proyecto existente (Vikunja, Planka, Kanboard, Wekan): se construye desde cero para poder elegir la licencia. Se pueden consultar para sacar ideas.
