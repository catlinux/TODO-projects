# Asistente de IA con chat y voz (0.21.0)

Escrito por Sonnet el 2026-10-18. Ejecuta Sonnet delegando en AgentRelay, un paso por vez y en orden. Sin push ni despliegue sin aprobación del usuario.

## Investigación (2026-10-18)

- **DeepSeek Flash**: API compatible con OpenAI Chat Completions. Base `https://api.deepseek.com`, modelo `deepseek-flash` (el alias antiguo `deepseek-v4-flash` sigue valiendo), `tools` en formato OpenAI estándar.
- **GPT-6 Luna (OpenAI)**: modelo `gpt-6-luna`, base `https://api.openai.com/v1`. OpenAI recomienda Responses para herramientas; Chat Completions admite function calling **solo con `reasoning_effort: "none"`**.
- Decisión: **un único cliente Chat Completions** con base URL, modelo y clave configurables, y un parámetro opcional `reasoning_effort` (preset OpenAI lo fija a `none`). Presets: `deepseek`, `openai` y `personalizado` (cualquier servicio compatible). Precios y nombres de modelo cambian: no se fijan en código más allá del preset editable.

## Decisiones de diseño

- La clave del proveedor se pega en Ajustes y se guarda **cifrada** (AES-256-GCM) en la base de datos, por usuario. La clave de cifrado viene del entorno (`ASISTENTE_CLAVE_CIFRADO`, 32 bytes en base64, la pone el usuario en `.env`); sin ella, el asistente aparece como «no configurado». La API nunca devuelve la clave (solo «configurada, termina en …1234»).
- El servidor es sin estado: el chat envía el historial (acotado) en cada petición. La llamada al modelo se hace siempre desde el servidor.
- Las herramientas **reutilizan las rutas existentes** llamándolas con `app.inject` reenviando la cookie/sesión del usuario, así se heredan validación, propiedad, historial y expansión de recurrencias. Sin herramientas de borrado en esta versión.
- Herramientas: `listar_proyectos` (con columnas y etiquetas), `listar_tareas`, `consultar_agenda(desde, hasta)`, `crear_proyecto`, `crear_tarea` (título, descripción, columna, venceEn, recurrencia, recordatorioMin, checklist), `actualizar_tarea`, `mover_tarea`, `completar_tarea`, `anadir_checklist`, `excepcion_ocurrencia` (mover u omitir una sola ocurrencia).
- El prompt de sistema lleva: fecha y hora actuales y zona del usuario, estructura (proyectos, columnas, etiquetas), reglas (responder en el idioma del usuario, preguntar si falta un dato clave, no inventar ids, resumir lo hecho).
- Límites: máx. 6 vueltas de herramientas por mensaje, historial de 20 mensajes, `max_tokens` acotado, tiempo máximo 60 s, límite de peticiones por usuario.
- Voz: reconocimiento del navegador (Web Speech API, `es-ES` por defecto con selector `ca-ES`/`es-ES`/`en-US`); si el navegador no lo soporta, el botón no aparece. El texto reconocido entra en el cuadro de mensaje (se envía al pulsar enviar, o automáticamente si el usuario activa «enviar al terminar»).

## Pasos

### 1 · API: configuración del proveedor · AgentRelay medio · [x]
Archivos: `apps/api/src/db/schema.ts` + migración `asistente_config`, `apps/api/src/asistente/config.ts` (+ cifrado), rutas en `app.ts`, `packages/shared/src/schemas.ts`, tests.
Hecho cuando: `GET/PUT/DELETE /asistente/config` y `POST /asistente/probar` (una llamada mínima al modelo para validar clave, base y modelo); presets; clave cifrada y nunca devuelta; tests de cifrado, aislamiento entre usuarios y clave de cifrado ausente. Versión: sin subir (se publica en el paso 5).

### 2 · API: chat con herramientas · AgentRelay alto · [x]
Archivos: `apps/api/src/asistente/{cliente,herramientas,sistema,chat}.ts`, ruta `POST /asistente/chat`, tests con un servidor LLM falso.
Hecho cuando: bucle de herramientas con los límites anteriores, errores del proveedor traducidos a mensajes claros, respuesta `{mensaje, acciones:[{herramienta, resumen, enlace?}]}`; tests de: crear tarea con fecha relativa, mover de columna, aislamiento entre usuarios, tope de vueltas, proveedor caído, sin configurar.

### 3 · Web: ajustes y chat · AgentRelay alto · [ ]
Archivos: `apps/web/src/paginas/Asistente.tsx`, tarjeta «Asistente» en `Ajustes.tsx`, ruta y entrada de menú, i18n, estilos, tests.
Hecho cuando: en Ajustes se elige proveedor (preset), modelo y clave (campo de contraseña) y se prueba; el chat muestra la conversación, un indicador de «pensando», las acciones realizadas con enlaces, y refresca las consultas de tareas/agenda; si no está configurado, lleva a Ajustes.

### 4 · Web: voz · AgentRelay medio · [ ]
Archivos: `apps/web/src/componentes/BotonVoz.tsx`, integración en el chat, i18n, tests (con `SpeechRecognition` simulado).
Hecho cuando: botón de micrófono accesible con estado (escuchando), selector de idioma, texto parcial en el cuadro, manejo de permiso denegado y de navegador no soportado.

### 5 · Versión 0.21.0 y documentación · sesión · [ ]
`VERSION`, `CHANGELOG`, `README`, `docs/` (cómo configurar el asistente y la variable `ASISTENTE_CLAVE_CIFRADO`; privacidad: el texto del chat y de tus tareas sale hacia el proveedor elegido), `TODO.md`.

## Fuera de este plan (necesitan al usuario)
- Generar y poner `ASISTENTE_CLAVE_CIFRADO` en `.env` y reiniciar la API (cambia la configuración del servidor).
- Crear la clave de API en el proveedor y pegarla en Ajustes.

## Dudas abiertas
_(ninguna)_
