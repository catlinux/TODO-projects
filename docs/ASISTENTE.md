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

Los nombres de modelo y los precios cambian: compruébalos en la documentación del proveedor y edita el modelo en Ajustes si hace falta.

## Privacidad y seguridad

- El texto del chat y los datos de tus proyectos y tareas que el asistente consulta se envían al proveedor elegido.
- La clave del proveedor se guarda cifrada (AES-256-GCM) y la web nunca la recibe de vuelta.
- Las acciones del asistente usan tu sesión y las mismas rutas que la web, así que quedan en el historial de cada tarea.
- El contenido de las tareas se trata como datos, no como instrucciones; aun así, no pegues en tareas textos de origen no fiable si el asistente va a leerlas.
- La URL base acepta `localhost` para modelos locales: si abres el registro a más usuarios, restringe esa opción.

## Voz

El botón de micrófono usa el reconocimiento de voz del navegador (castellano, catalán o inglés). No necesita servidor ni cuenta, pero en Chrome el audio lo procesa Google. Si el navegador no lo soporta, el botón no aparece.
