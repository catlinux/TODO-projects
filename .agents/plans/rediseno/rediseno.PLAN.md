# Rediseño de la web según la maqueta (0.9.0)

Maqueta aprobada por el usuario: https://claude.ai/artifact/UneU1zYrzgqnNWkwrgJsfZ (tablero de escritorio, agenda con avisos y «Hoy» en el móvil).

## Sistema visual (común a todos los pasos)

- Fondo `#F3F4F6`; superficies `#FFFFFF` con borde `#DDE1E8`; columnas `#E9EBF0`; texto `#1B1F27`, secundario `#5A6272`.
- Acento único `#2F4BC4` (hover `#1F358F`, fondo suave `#EEF1FD`). Estados de fecha: próxima `#FCE9D6`/`#8A3F0C`, atrasada `#FBE3E1`/`#9B1C14`, normal `#EEF0F4`/`#3A4150`. Hecho: verde `#2F8F62`.
- Colores de proyecto (por orden de creación, cíclicos): `#2F4BC4`, `#2F8F62`, `#C2611B`, `#7A56C2`, `#1F7A8C`, `#B23A6B`.
- Tipografía: Plus Jakarta Sans (400–700) para todo y IBM Plex Mono 500 para fechas y horas, autoalojadas con `@fontsource` (no Google Fonts).
- Radios: 8 px controles, 10 px tarjetas, 12 px columnas. Objetivos táctiles ≥ 40 px. Iconos SVG en línea de trazo, nunca emojis.
- Todo en variables CSS en `:root` de `apps/web/src/estilos.css`.

## Pasos

### Paso 1 — Base visual y estructura · AgentRelay, esfuerzo medio · [ ]
- Archivos: `apps/web/src/estilos.css`, `apps/web/src/App.tsx`, `apps/web/src/componentes/BarraNavegacion.tsx` (+ su test), `apps/web/src/main.tsx`, `apps/web/package.json`, `apps/web/src/i18n/es.json`.
- Variables y tipografía; disposición con menú lateral en escritorio (logo, Agenda, lista de proyectos con su color, Ajustes, avisos del navegador y salir abajo) y barra inferior en ≤ 740 px (Proyectos, Agenda, Ajustes).
- Terminado: tests, typecheck y lint de la web pasan; sin cambios de API.

### Paso 2 — Tablero y tarjetas · AgentRelay, esfuerzo medio · [ ]
- Archivos: `componentes/Tablero.tsx`, `paginas/ProyectoDetalle.tsx`, `paginas/Proyectos.tsx`, `estilos.css`.
- Cabecera del proyecto (miga, título, «Nueva tarea» en acento), columnas compactas con contador, tarjetas limpias con chip de fecha (próxima ≤ 24 h, atrasada, normal), icono de campana si `recordatorioMin` y de repetición si `recurrencia`; tarjeta arrastrada rotada con sombra. Lista de proyectos como rejilla de tarjetas con su color.

### Paso 3 — Agenda y próximos avisos · AgentRelay, esfuerzo medio · [ ]
- Archivos: `apps/api/src/agenda.ts` (+ test: añadir `recordatorioMin` a cada ocurrencia), `apps/web/src/api.ts`, `paginas/Agenda.tsx`, `estilos.css`.
- FullCalendar con el tema (eventos con el color del proyecto, hoy resaltado) y panel lateral «Próximos avisos» (siguientes 7 días con aviso: hora del aviso = fecha − `recordatorioMin`). Botones de `.ics` existentes, con el nuevo estilo.

### Paso 4 — Vista «Hoy» · AgentRelay, esfuerzo medio · [ ]
- Archivos: `paginas/Hoy.tsx` (nuevo) + test, `App.tsx`, `componentes/BarraNavegacion.tsx`, `i18n/es.json`.
- Ruta `/hoy`, que pasa a ser la de inicio (`/` redirige allí): Atrasadas, Hoy y Próximos 7 días a partir de `GET /agenda`, con enlace a su proyecto. Casilla para completar solo si ya existe una forma de marcar como hecha (mover a la última columna); si no, sin casilla. Primera entrada de la barra lateral y de la inferior.

### Paso 5 — Pulido y versión · la propia sesión (Sonnet, esfuerzo bajo) · [ ]
- Login, Ajustes y formularios con el nuevo estilo; revisión a 390 px.
- Versión 0.9.0 (menor: vista nueva y rediseño compatible), CHANGELOG, README (estado) y `docs/HOJA-DE-RUTA.md` (las versiones de la tabla se desplazan una posición).
