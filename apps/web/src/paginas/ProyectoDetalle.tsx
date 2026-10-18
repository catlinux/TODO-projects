import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Outlet, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

import { peticion, type ColumnaApi, type EtiquetaApi, type ProyectoApi, type TareaApi } from "../api";
import { CamposTarea, type ValoresFormularioTarea } from "../componentes/CamposTarea";
import { FondoProyecto } from "../componentes/FondoProyecto";
import { ListaTareas } from "../componentes/ListaTareas";
import { PersonalizarProyecto } from "../componentes/PersonalizarProyecto";
import { PastillaEtiqueta } from "../componentes/SelectorEtiquetas";
import { Tablero } from "../componentes/Tablero";
import { inicial } from "../inicial";
import { aIsoUtc, construirRegla, recurrenciaPorDefecto, zonaNavegador } from "../recurrencia-web";

export interface PropiedadesProyectoDetalle {
  /** Abre el diálogo de personalizar. Sin él, lo abre el estado de la propia página (A6). */
  onAbrirFondo?: () => void;
}

type VistaProyecto = "tablero" | "lista";

/** Vista elegida para el proyecto; ausente, ilegible o inválida → «tablero». */
function leerVista(proyectoId: string): VistaProyecto {
  try {
    return window.localStorage.getItem(`todo.vista.${proyectoId}`) === "lista"
      ? "lista"
      : "tablero";
  } catch {
    return "tablero";
  }
}

function guardarVista(proyectoId: string, vista: VistaProyecto): void {
  try {
    window.localStorage.setItem(`todo.vista.${proyectoId}`, vista);
  } catch {
    // Sin localStorage (modo privado): la elección dura lo que la página.
  }
}

function valoresIniciales(): ValoresFormularioTarea {
  return {
    titulo: "",
    descripcion: "",
    venceEnLocal: "",
    recurrencia: recurrenciaPorDefecto(),
    recordatorioMin: null,
  };
}

function IconoFiltro() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5h16l-6 7v6l-4 2v-8z" />
    </svg>
  );
}

function IconoFondo() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 15l-5-5-7 7" />
    </svg>
  );
}

function IconoCerrar() {
  return (
    <svg
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
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

export default function ProyectoDetalle({ onAbrirFondo }: PropiedadesProyectoDetalle) {
  const { t } = useTranslation();
  const { id } = useParams();
  const proyectoId = id ?? "";
  const [parametros, setParametros] = useSearchParams();
  const cliente = useQueryClient();

  const proyecto = useQuery({
    queryKey: ["proyecto", proyectoId],
    queryFn: () => peticion<ProyectoApi>(`/proyectos/${proyectoId}`),
    enabled: Boolean(proyectoId),
  });

  const columnas = useQuery({
    queryKey: ["columnas", proyectoId],
    queryFn: () => peticion<ColumnaApi[]>(`/proyectos/${proyectoId}/columnas`),
    enabled: Boolean(proyectoId),
  });

  const tareas = useQuery({
    queryKey: ["tareas", proyectoId],
    queryFn: () => peticion<TareaApi[]>(`/proyectos/${proyectoId}/tareas`),
    enabled: Boolean(proyectoId),
  });

  const etiquetas = useQuery({
    queryKey: ["etiquetas", proyectoId],
    queryFn: () => peticion<EtiquetaApi[]>(`/proyectos/${proyectoId}/etiquetas`),
    enabled: Boolean(proyectoId),
  });

  const [valores, setValores] = useState<ValoresFormularioTarea>(valoresIniciales);
  const [dialogoTareaAbierto, setDialogoTareaAbierto] = useState(false);
  const [personalizarAbierto, setPersonalizarAbierto] = useState(false);
  const [filtroEtiquetas, setFiltroEtiquetas] = useState<string[]>([]);
  const [filtroAbierto, setFiltroAbierto] = useState(false);
  const [vista, setVista] = useState<VistaProyecto>(() => leerVista(proyectoId));
  const [columnaSeleccionada, setColumnaSeleccionada] = useState("");
  const [errorColumna, setErrorColumna] = useState<string | null>(null);
  const refDialogo = useRef<HTMLDialogElement>(null);

  // Al cambiar de proyecto, la vista guardada de ese proyecto.
  useEffect(() => {
    setVista(leerVista(proyectoId));
  }, [proyectoId]);

  useEffect(() => {
    if (!columnaSeleccionada && columnas.data && columnas.data.length > 0 && columnas.data[0]) {
      setColumnaSeleccionada(columnas.data[0].id);
    }
  }, [columnas.data, columnaSeleccionada]);

  // «?nueva=1» (desde la paleta o el atajo «N»): abre el diálogo y limpia el parámetro.
  useEffect(() => {
    if (parametros.get("nueva") !== "1") return;
    setDialogoTareaAbierto(true);
    const copia = new URLSearchParams(parametros);
    copia.delete("nueva");
    setParametros(copia, { replace: true });
  }, [parametros, setParametros]);

  useEffect(() => {
    const dialogo = refDialogo.current;
    if (!dialogo) return;
    if (dialogoTareaAbierto) {
      if (typeof dialogo.showModal === "function") {
        if (!dialogo.open) dialogo.showModal();
      } else {
        dialogo.setAttribute("open", "");
      }
      dialogo.querySelector<HTMLElement>("input, select, textarea")?.focus();
    } else if (typeof dialogo.close === "function") {
      if (dialogo.open) dialogo.close();
    } else {
      dialogo.removeAttribute("open");
    }
  }, [dialogoTareaAbierto]);

  const crearTarea = useMutation({
    mutationFn: async () => {
      const venceEn = aIsoUtc(valores.venceEnLocal);
      return peticion(`/proyectos/${proyectoId}/tareas`, {
        method: "POST",
        body: JSON.stringify({
          titulo: valores.titulo,
          descripcion: valores.descripcion,
          columnaId: columnaSeleccionada || undefined,
          venceEn,
          recurrencia: venceEn ? construirRegla(valores.recurrencia) : null,
          zona: zonaNavegador(),
          recordatorioMin: venceEn ? valores.recordatorioMin : null,
        }),
      });
    },
    onSuccess: async () => {
      setValores(valoresIniciales());
      setDialogoTareaAbierto(false);
      await cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
    },
  });

  const crearTareaRapida = useMutation({
    mutationFn: async ({ columnaId, titulo }: { columnaId: string; titulo: string }) =>
      peticion(`/proyectos/${proyectoId}/tareas`, {
        method: "POST",
        body: JSON.stringify({ titulo, columnaId }),
      }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
    },
    onError: (err: unknown) => {
      setErrorColumna(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  const crearColumna = useMutation({
    mutationFn: async (nombre: string) =>
      peticion(`/proyectos/${proyectoId}/columnas`, {
        method: "POST",
        body: JSON.stringify({ nombre }),
      }),
    onSuccess: async () => {
      setErrorColumna(null);
      await cliente.invalidateQueries({ queryKey: ["columnas", proyectoId] });
      await cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
    },
    onError: (err: unknown) => {
      setErrorColumna(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  const renombrarColumna = useMutation({
    mutationFn: async ({ columnaId, nombre }: { columnaId: string; nombre: string }) =>
      peticion(`/columnas/${columnaId}`, {
        method: "PATCH",
        body: JSON.stringify({ nombre }),
      }),
    onSuccess: async () => {
      setErrorColumna(null);
      await cliente.invalidateQueries({ queryKey: ["columnas", proyectoId] });
    },
    onError: (err: unknown) => {
      setErrorColumna(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  const reordenarColumna = useMutation({
    mutationFn: async ({ columnaId, posicion }: { columnaId: string; posicion: number }) =>
      peticion(`/columnas/${columnaId}`, {
        method: "PATCH",
        body: JSON.stringify({ posicion }),
      }),
    onSuccess: async () => {
      setErrorColumna(null);
      await cliente.invalidateQueries({ queryKey: ["columnas", proyectoId] });
    },
    onError: (err: unknown) => {
      setErrorColumna(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  const borrarColumna = useMutation({
    mutationFn: async (columnaId: string) =>
      peticion(`/columnas/${columnaId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setErrorColumna(null);
      await cliente.invalidateQueries({ queryKey: ["columnas", proyectoId] });
      await cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
    },
    onError: (err: unknown) => {
      setErrorColumna(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  if (proyecto.isLoading || columnas.isLoading || tareas.isLoading) {
    return (
      <main className="proyecto proyecto--estado">
        <p>{t("app.loading")}</p>
      </main>
    );
  }
  if (proyecto.isError || columnas.isError || tareas.isError) {
    return (
      <main className="proyecto proyecto--estado">
        <p className="error">{t("auth.error")}</p>
      </main>
    );
  }

  const listaColumnas = (columnas.data ?? []).slice().sort((a, b) => a.posicion - b.posicion);
  const listaEtiquetas = etiquetas.data ?? [];
  const listaTareas = tareas.data ?? [];
  const tareasFiltradas =
    filtroEtiquetas.length === 0
      ? listaTareas
      : listaTareas.filter((tarea) =>
          (tarea.etiquetas ?? []).some((id) => filtroEtiquetas.includes(id)),
        );

  function alternarFiltro(etiquetaId: string, activa: boolean) {
    setFiltroEtiquetas((actuales) =>
      activa ? [...new Set([...actuales, etiquetaId])] : actuales.filter((id) => id !== etiquetaId),
    );
  }

  function cambiarVista(nueva: VistaProyecto) {
    setVista(nueva);
    guardarVista(proyectoId, nueva);
  }

  return (
    <main className="proyecto">
      <FondoProyecto fondo={proyecto.data?.fondo ?? null} />
      <div className="proyecto__contenido">
        <header className="cabecera-proyecto">
          <span className="cabecera-proyecto__inicial" aria-hidden="true">
            {inicial(proyecto.data?.nombre ?? "")}
          </span>
          <h1 title={proyecto.data?.nombre ?? t("projects.title")}>
            {proyecto.data?.nombre ?? t("projects.title")}
          </h1>
          <div className="cabecera-proyecto__acciones">
            <div className="control-vista" role="radiogroup" aria-label={t("projects.view")}>
              <button
                type="button"
                role="radio"
                aria-checked={vista === "tablero"}
                className={`boton-cabecera control-vista__opcion${
                  vista === "tablero" ? " boton-cabecera--blanco" : ""
                }`}
                onClick={() => cambiarVista("tablero")}
              >
                {t("projects.board")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={vista === "lista"}
                className={`boton-cabecera control-vista__opcion${
                  vista === "lista" ? " boton-cabecera--blanco" : ""
                }`}
                onClick={() => cambiarVista("lista")}
              >
                {t("projects.list")}
              </button>
            </div>
            <button
              type="button"
              className="boton-cabecera"
              aria-expanded={filtroAbierto}
              onClick={() => setFiltroAbierto((abierto) => !abierto)}
            >
              <IconoFiltro />
              {t("projects.filter")}
              {filtroEtiquetas.length > 0 && (
                <span className="cabecera-proyecto__filtro-contador cifra">
                  {filtroEtiquetas.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className="boton-cabecera"
              aria-haspopup="dialog"
              onClick={onAbrirFondo ?? (() => setPersonalizarAbierto(true))}
            >
              <IconoFondo />
              {t("projects.background")}
            </button>
            <button
              type="button"
              className="boton-cabecera boton-cabecera--blanco"
              aria-haspopup="dialog"
              onClick={() => setDialogoTareaAbierto(true)}
            >
              {t("tasks.new")}
            </button>
          </div>
        </header>

        {filtroAbierto && (
          <section
            className="filtro-etiquetas"
            aria-label={t("projects.filterPanel")}
            onKeyDown={(evento) => {
              if (evento.key === "Escape") {
                evento.preventDefault();
                setFiltroAbierto(false);
              }
            }}
          >
            {listaEtiquetas.length === 0 ? (
              <p className="filtro-etiquetas__vacia">{t("projects.filterEmpty")}</p>
            ) : (
              <ul className="filtro-etiquetas__lista">
                {listaEtiquetas.map((etiqueta) => (
                  <li key={etiqueta.id}>
                    <label className="filtro-etiquetas__opcion">
                      <input
                        type="checkbox"
                        checked={filtroEtiquetas.includes(etiqueta.id)}
                        onChange={(evento) => alternarFiltro(etiqueta.id, evento.target.checked)}
                      />
                      <PastillaEtiqueta etiqueta={etiqueta} />
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="boton-texto"
              onClick={() => setFiltroEtiquetas([])}
              disabled={filtroEtiquetas.length === 0}
            >
              {t("projects.filterClear")}
            </button>
          </section>
        )}

        {errorColumna && <p className="error proyecto__error">{errorColumna}</p>}

        {vista === "lista" ? (
          <ListaTareas
            proyectoId={proyectoId}
            columnas={listaColumnas}
            tareas={tareasFiltradas}
            etiquetas={listaEtiquetas}
            filtroActivo={filtroEtiquetas.length > 0}
            onNuevaTarea={() => setDialogoTareaAbierto(true)}
          />
        ) : (
          <Tablero
            proyectoId={proyectoId}
            columnas={listaColumnas}
            tareas={tareasFiltradas}
            etiquetas={listaEtiquetas}
            onCrearTarea={(columnaId, titulo) => crearTareaRapida.mutate({ columnaId, titulo })}
            onCrearColumna={(nombre) => crearColumna.mutate(nombre)}
            onRenombrarColumna={(columnaId, nombre) =>
              renombrarColumna.mutate({ columnaId, nombre })
            }
            onMoverColumna={(columnaId, posicion) => reordenarColumna.mutate({ columnaId, posicion })}
            onEliminarColumna={(columnaId) => borrarColumna.mutate(columnaId)}
          />
        )}
      </div>

      <dialog
        ref={refDialogo}
        className="dialogo"
        aria-labelledby="titulo-dialogo-tarea"
        onCancel={(evento) => {
          evento.preventDefault();
          setDialogoTareaAbierto(false);
        }}
        onKeyDown={(evento) => {
          if (evento.key === "Escape") {
            evento.preventDefault();
            setDialogoTareaAbierto(false);
          }
        }}
      >
        {dialogoTareaAbierto && (
          <div className="dialogo__cuerpo">
            <div className="dialogo__cabecera">
              <h2 id="titulo-dialogo-tarea">{t("tasks.new")}</h2>
              <button
                type="button"
                className="boton-icono"
                aria-label={t("tasks.closeDialog")}
                onClick={() => setDialogoTareaAbierto(false)}
              >
                <IconoCerrar />
              </button>
            </div>
            <form
              className="formulario"
              onSubmit={(e) => {
                e.preventDefault();
                void crearTarea.mutate();
              }}
            >
              <CamposTarea valores={valores} onCambio={setValores} />
              <label>
                {t("columns.title")}
                <select
                  value={columnaSeleccionada}
                  onChange={(e) => setColumnaSeleccionada(e.target.value)}
                >
                  {listaColumnas.map((columna) => (
                    <option key={columna.id} value={columna.id}>
                      {columna.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <div className="dialogo__pie">
                <button type="submit" className="boton-principal" disabled={crearTarea.isPending}>
                  {t("tasks.create")}
                </button>
              </div>
            </form>
          </div>
        )}
      </dialog>
      {proyecto.data && (
        <PersonalizarProyecto
          proyecto={proyecto.data}
          abierto={personalizarAbierto}
          onCerrar={() => setPersonalizarAbierto(false)}
        />
      )}
      {/* Ruta anidada: la tarjeta abierta se pinta encima del tablero (B3). */}
      <Outlet />
    </main>
  );
}
