# Asistente de IA

Chat dentro de la web (menú «Asistente») para pedir cosas en lenguaje natural («crea una tarea mañana a las 10 para llamar al banco», «¿qué tengo esta semana?») y, opcionalmente, hablando con el micrófono. El asistente crea y edita proyectos, tareas, checklists y excepciones de ocurrencias, mueve tareas entre columnas y consulta la agenda. **No puede borrar nada.**

## Puesta en marcha

1. Genera la clave con la que se cifrará la clave del proveedor en la base de datos y ponla en `.env`:

   ```bash
   echo "ASISTENTE_CLAVE_CIFRADO=$(openssl rand -base64 32)" >> .env
   docker compose -f docker-compose.prod.yml up -d
   ```

   Guarda una copia de esa clave junto a tus copias de seguridad: sin ella, la clave del proveedor guardada no se puede descifrar y hay que volver a pegarla.
2. Crea una clave de API en el proveedor que elijas.
3. En **Ajustes → Asistente** elige el proveedor, pega la clave y pulsa «Probar conexión».

## Proveedores

Todos usan el formato Chat Completions de OpenAI, así que sirve cualquier servicio compatible (preset «Personalizado»).

| Preset | URL base | Modelo | Notas |
|---|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` | Formato estándar de herramientas. |
| OpenAI | `https://api.openai.com/v1` | `gpt-6-luna` | Con Chat Completions las herramientas solo funcionan con `reasoning_effort: none`, que el preset ya fija. |
| OpenCode Go (suscripción) | `https://opencode.ai/inference/go/openai/v1` | `deepseek-v4.1-flash` | La clave se obtiene en la consola de OpenCode (suscríbete a Go y cópiala). `gpt-6-luna` no funciona aquí porque usa Responses. El servicio está pensado para agentes de programación: úsalo bajo tu cuenta y riesgo. |

Los nombres de modelo y los precios cambian: compruébalos en la documentación del proveedor y edita el modelo en Ajustes si hace falta.

OpenCode Zen (pago por uso) también se puede usar con el preset «Personalizado» y la URL base `https://opencode.ai/inference/openai/v1`.

Las llamadas al proveedor se identifican con el agente de usuario `TODO-projects-asistente/<versión>`; con OpenCode Go, además, cada conversación envía su id en `x-opencode-session`.

## Mensajes largos y archivos adjuntos

Puedes pegar textos largos (por ejemplo, un changelog entero) o adjuntar archivos de texto con el botón del clip, que está junto al del micrófono. También puedes arrastrarlos y soltarlos sobre el cuadro de mensaje.

- Límites: 120 000 caracteres por mensaje (texto escrito más adjuntos) y 250 000 caracteres en total por petición. Al pasar del 80 % del límite del mensaje aparece un contador; si lo superas, no se envía y se avisa.
- Archivos: hasta 3 por mensaje y 100 000 caracteres por archivo. Se aceptan `.txt`, `.md`, `.markdown`, `.csv`, `.tsv`, `.json`, `.yaml`, `.yml`, `.xml`, `.html`, `.log`, `.ics`, `.toml`, `.ini`, `.sql`, `.diff` y cualquier archivo cuyo tipo empiece por `text/`. Los binarios y los archivos que superan el límite se rechazan con un aviso; no se truncan.
- Cada adjunto se muestra como una pastilla con su nombre y tamaño antes de enviarlo, y se puede quitar. En el hilo, tu mensaje muestra el texto que escribiste y las pastillas, no el contenido del archivo.
- Al enviar, el contenido de cada archivo se añade al mensaje entre `[Archivo adjunto: nombre]` y `[Fin del archivo]`, después de tu instrucción. El modelo lo trata como datos que analizar, nunca como instrucciones.
- El historial se reenvía en cada turno para dar contexto. Para no multiplicar el coste, si la suma supera los 250 000 caracteres se sustituye el contenido de los adjuntos más antiguos por `[Archivo adjunto: nombre — contenido omitido para ahorrar espacio]`; el último mensaje siempre se envía completo.

El contenido de los adjuntos se envía al proveedor elegido, igual que el texto del chat. No adjuntes archivos con datos que no quieras compartir con ese proveedor.

## Privacidad y seguridad

- El texto del chat, el contenido de los archivos adjuntos y los datos de tus proyectos y tareas que el asistente consulta se envían al proveedor elegido.
- La clave del proveedor se guarda cifrada (AES-256-GCM) y la web nunca la recibe de vuelta.
- Las acciones del asistente usan tu sesión y las mismas rutas que la web, así que quedan en el historial de cada tarea.
- El contenido de las tareas, los mensajes y los archivos adjuntos se tratan como datos, no como instrucciones; aun así, no pegues ni adjuntes textos de origen no fiable si el asistente va a leerlos.
- La URL base acepta `localhost` para modelos locales: si abres el registro a más usuarios, restringe esa opción.

## Voz

El botón de micrófono usa el reconocimiento de voz del navegador (castellano, catalán o inglés). No necesita servidor ni cuenta, pero en Chrome el audio lo procesa Google. Si el navegador no lo soporta, el botón no aparece.
