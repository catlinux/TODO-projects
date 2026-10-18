import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { peticion, type ResultadoBusquedaApi } from "../api";
import { useEstilo } from "../estilo";
import { chipFecha, type EstadoFecha } from "../fechas";
import { useTema, type Tema } from "../tema";

/** Espera antes de consultar la API, para no buscar en cada tecla. */
export const ESPERA_BUSQUEDA_MS = 150;
const MIN_CARACTERES = 2;
const ORDEN_TEMA: readonly Tema[] = ["claro", "oscuro", "sistema"];

function siguienteTema(tema: Tema): Tema {
  const indice = ORDEN_TEMA.indexOf(tema);
  return ORDEN_TEMA[(indice + 1) % ORDEN_TEMA.length] ?? "sistema";
}

interface OpcionPaleta {
  id: string;
  grupo: string;
  etiqueta: string;
  ejecutar: () => void;
  detalle?: string;
  color?: string | null;
  fecha?: string | null;
  estadoFecha?: EstadoFecha | null;
  hecha?: boolean;
}

interface AccionPaleta {
  id: string;
  etiqueta: string;
  accion: () => void;
  /** «Cambiar tema» no cierra la paleta para poder seguir rotando. */
  mantenerAbierta?: boolean;
}

export interface PropiedadesPaleta {
  abierto: boolean;
  onCerrar: () => void;
  /** «Nueva tarea» en el proyecto abierto o, si no hay, en el primero. */
  onNuevaTarea: () => void;
}

/**
 * Paleta de búsqueda y comandos (Ctrl/⌘+K): busca tareas y proyectos con una
 * espera de 150 ms y ofrece acciones sobre el texto escrito.
 */
export function Paleta({ abierto, onCerrar, onNuevaTarea }: PropiedadesPaleta) {
  const { t } = useTranslation();
  const navegar = useNavigate();
  const { tema, cambiarTema } = useTema();
  const { estilo, cambiarEstilo } = useEstilo();
  const refDialogo = useRef<HTMLDialogElement>(null);
  const refEntrada = useRef<HTMLInputElement>(null);
  const refFocoAnterior = useRef<HTMLElement | null>(null);

  const [consulta, setConsulta] = useState("");
  const [termino, setTermino] = useState("");
  const [indiceActivo, setIndiceActivo] = useState(0);

  // Espera de 150 ms: solo se consulta cuando el texto lleva quieto ese tiempo.
  useEffect(() => {
    const texto = consulta.trim();
    if (texto.length < MIN_CARACTERES) {
      setTermino("");
      return;
    }
    const id = window.setTimeout(() => setTermino(texto), ESPERA_BUSQUEDA_MS);
    return () => window.clearTimeout(id);
  }, [consulta]);

  const busqueda = useQuery({
    queryKey: ["buscar", termino],
    queryFn: ({ signal }) =>
      peticion<ResultadoBusquedaApi>(`/buscar?q=${encodeURIComponent(termino)}`, { signal }),
    enabled: abierto && termino.length >= MIN_CARACTERES,
  });

  // Al abrir (o cerrar) el diálogo: estado limpio y foco en el campo.
  useEffect(() => {
    const dialogo = refDialogo.current;
    if (!dialogo) return;
    if (abierto) {
      setConsulta("");
      setTermino("");
      setIndiceActivo(0);
      refFocoAnterior.current = document.activeElement as HTMLElement | null;
      if (typeof dialogo.showModal === "function") {
        if (!dialogo.open) dialogo.showModal();
      } else {
        dialogo.setAttribute("open", "");
      }
      refEntrada.current?.focus();
    } else {
      if (typeof dialogo.close === "function") {
        if (dialogo.open) dialogo.close();
      } else {
        dialogo.removeAttribute("open");
      }
      refFocoAnterior.current?.focus();
      refFocoAnterior.current = null;
    }
  }, [abierto]);

  const filtro = consulta.trim().toLocaleLowerCase("es-ES");

  const acciones = useMemo<AccionPaleta[]>(
    () => [
      { id: "nueva-tarea", etiqueta: t("palette.newTask"), accion: () => onNuevaTarea() },
      { id: "ir-hoy", etiqueta: t("palette.goToday"), accion: () => navegar("/hoy") },
      { id: "ir-bandeja", etiqueta: t("palette.goInbox"), accion: () => navegar("/bandeja") },
      { id: "ir-agenda", etiqueta: t("palette.goAgenda"), accion: () => navegar("/agenda") },
      {
        id: "cambiar-tema",
        etiqueta: t("palette.changeTheme"),
        accion: () => cambiarTema(siguienteTema(tema)),
        mantenerAbierta: true,
      },
      {
        id: "cambiar-estilo",
        etiqueta: t("palette.changeStyle"),
        accion: () => cambiarEstilo(estilo === "sobrio" ? "sereno" : "sobrio"),
        mantenerAbierta: true,
      },
    ],
    [t, navegar, onNuevaTarea, cambiarTema, tema, cambiarEstilo, estilo],
  );

  const opciones = useMemo(() => {
    const lista: OpcionPaleta[] = [];

    for (const accion of acciones) {
      if (accion.etiqueta.toLocaleLowerCase("es-ES").includes(filtro)) {
        lista.push({
          id: `paleta-${accion.id}`,
          grupo: t("palette.groupActions"),
          etiqueta: accion.etiqueta,
          ejecutar: () => {
            if (!accion.mantenerAbierta) onCerrar();
            accion.accion();
          },
        });
      }
    }

    const datos = termino.length >= MIN_CARACTERES ? busqueda.data : undefined;
    if (datos) {
      for (const tarea of datos.tareas) {
        const chip = chipFecha(tarea.venceEn);
        lista.push({
          id: `paleta-tarea-${tarea.id}`,
          grupo: t("palette.groupTasks"),
          etiqueta: tarea.titulo,
          detalle: tarea.proyectoNombre,
          color: tarea.proyectoColor,
          fecha: chip?.texto ?? null,
          estadoFecha: chip?.estado ?? null,
          hecha: tarea.hecha,
          ejecutar: () => {
            onCerrar();
            navegar(`/proyectos/${tarea.proyectoId}/tareas/${tarea.id}`);
          },
        });
      }
      for (const proyecto of datos.proyectos) {
        lista.push({
          id: `paleta-proyecto-${proyecto.id}`,
          grupo: t("palette.groupProjects"),
          etiqueta: proyecto.nombre,
          color: proyecto.color,
          ejecutar: () => {
            onCerrar();
            navegar(`/proyectos/${proyecto.id}`);
          },
        });
      }
    }
    return lista;
  }, [acciones, filtro, t, termino, busqueda.data, navegar, onCerrar]);

  const totalResultados =
    termino.length >= MIN_CARACTERES
      ? (busqueda.data?.tareas.length ?? 0) + (busqueda.data?.proyectos.length ?? 0)
      : 0;
  const indice = opciones.length === 0 ? -1 : Math.min(indiceActivo, opciones.length - 1);
  const idActivo = indice >= 0 ? opciones[indice]?.id : undefined;

  let mensaje = "";
  if (termino.length >= MIN_CARACTERES) {
    if (busqueda.isLoading) mensaje = t("palette.searching");
    else if (busqueda.isError) mensaje = t("palette.error");
    else mensaje = t("palette.resultsCount", { n: totalResultados });
  }

  function alPulsarEnEntrada(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      if (opciones.length > 0) setIndiceActivo((actual) => (actual + 1) % opciones.length);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      if (opciones.length > 0) {
        setIndiceActivo((actual) => (actual - 1 + opciones.length) % opciones.length);
      }
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      opciones[indice]?.ejecutar();
    }
  }

  return (
    <dialog
      ref={refDialogo}
      className="dialogo paleta"
      aria-labelledby="titulo-paleta"
      onCancel={(evento) => {
        evento.preventDefault();
        onCerrar();
      }}
      onKeyDown={(evento) => {
        if (evento.key === "Escape") {
          evento.preventDefault();
          onCerrar();
        }
      }}
    >
      {abierto && (
        <div className="paleta__cuerpo">
          <h2 id="titulo-paleta" className="visualmente-oculto">
            {t("palette.title")}
          </h2>
          <div className="paleta__busqueda">
            <svg
              className="paleta__lupa"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              ref={refEntrada}
              type="text"
              className="paleta__campo"
              role="combobox"
              aria-expanded={opciones.length > 0}
              aria-controls="paleta-lista"
              aria-autocomplete="list"
              aria-activedescendant={idActivo}
              aria-label={t("palette.placeholder")}
              placeholder={t("palette.placeholder")}
              value={consulta}
              onChange={(evento) => {
                setConsulta(evento.target.value);
                setIndiceActivo(0);
              }}
              onKeyDown={alPulsarEnEntrada}
            />
            <kbd className="paleta__atajo">{t("palette.shortcutKey")}</kbd>
          </div>

          <p
            className={`paleta__estado${busqueda.isError ? " paleta__estado--error" : ""}`}
            role="status"
            aria-live="polite"
          >
            {mensaje}
          </p>

          <ul
            id="paleta-lista"
            className="paleta__lista"
            role="listbox"
            aria-label={t("palette.results")}
          >
            {opciones.map((opcion, posicion) => {
              const anterior = posicion > 0 ? opciones[posicion - 1] : undefined;
              const cabecera = !anterior || anterior.grupo !== opcion.grupo;
              return (
                <Fragment key={opcion.id}>
                  {cabecera && (
                    <li className="paleta__grupo" role="presentation" aria-hidden="true">
                      {opcion.grupo}
                    </li>
                  )}
                  <li
                    id={opcion.id}
                    role="option"
                    aria-selected={posicion === indice}
                    className={`paleta__opcion${posicion === indice ? " paleta__opcion--activa" : ""}`}
                    onMouseMove={() => setIndiceActivo(posicion)}
                    onClick={() => opcion.ejecutar()}
                  >
                    {opcion.color !== undefined && (
                      <span
                        className="paleta__color"
                        style={opcion.color ? { backgroundColor: opcion.color } : undefined}
                        aria-hidden="true"
                      />
                    )}
                    <span className="paleta__texto">
                      <span
                        className={`paleta__titulo${opcion.hecha ? " paleta__titulo--hecha" : ""}`}
                      >
                        {opcion.etiqueta}
                      </span>
                      {opcion.detalle && <span className="paleta__detalle">{opcion.detalle}</span>}
                    </span>
                    {opcion.fecha && (
                      <span
                        className={`paleta__fecha${opcion.estadoFecha ? ` chip-fecha--${opcion.estadoFecha}` : ""}`}
                      >
                        {opcion.fecha}
                      </span>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ul>

          {termino.length >= MIN_CARACTERES &&
            !busqueda.isLoading &&
            !busqueda.isError &&
            opciones.length === 0 && <p className="paleta__vacio">{t("palette.noResults")}</p>}

          {termino.length < MIN_CARACTERES && <p className="paleta__ayuda">{t("palette.hint")}</p>}
        </div>
      )}
    </dialog>
  );
}
