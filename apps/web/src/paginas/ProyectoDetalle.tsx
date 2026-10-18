import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

import { peticion, type ColumnaApi, type ProyectoApi, type TareaApi } from "../api";
import { CamposTarea, type ValoresFormularioTarea } from "../componentes/CamposTarea";
import { Tablero } from "../componentes/Tablero";
import { aIsoUtc, construirRegla, recurrenciaPorDefecto, zonaNavegador } from "../recurrencia-web";

function valoresIniciales(): ValoresFormularioTarea {
  return {
    titulo: "",
    descripcion: "",
    venceEnLocal: "",
    recurrencia: recurrenciaPorDefecto(),
    recordatorioMin: null,
  };
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

export default function ProyectoDetalle() {
  const { t } = useTranslation();
  const { id } = useParams();
  const proyectoId = id ?? "";
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

  const [valores, setValores] = useState<ValoresFormularioTarea>(valoresIniciales);
  const [dialogoTareaAbierto, setDialogoTareaAbierto] = useState(false);
  const [columnaSeleccionada, setColumnaSeleccionada] = useState("");
  const [errorColumna, setErrorColumna] = useState<string | null>(null);
  const refDialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!columnaSeleccionada && columnas.data && columnas.data.length > 0 && columnas.data[0]) {
      setColumnaSeleccionada(columnas.data[0].id);
    }
  }, [columnas.data, columnaSeleccionada]);

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
    return <p>{t("app.loading")}</p>;
  }
  if (proyecto.isError || columnas.isError || tareas.isError) {
    return <p className="error">{t("auth.error")}</p>;
  }

  const listaColumnas = (columnas.data ?? []).slice().sort((a, b) => a.posicion - b.posicion);
  const listaTareas = tareas.data ?? [];

  return (
    <main className="contenedor contenedor--tablero">
      <nav className="migas" aria-label={t("projects.breadcrumb")}>
        <Link to="/proyectos">{t("nav.projects")}</Link>
        <span aria-hidden="true">/</span>
        <span className="migas__actual">{proyecto.data?.nombre ?? t("projects.title")}</span>
      </nav>

      <header className="cabecera-proyecto">
        <h1>{proyecto.data?.nombre ?? t("projects.title")}</h1>
        <button
          type="button"
          className="boton-principal"
          aria-haspopup="dialog"
          onClick={() => setDialogoTareaAbierto(true)}
        >
          {t("tasks.new")}
        </button>
      </header>

      {errorColumna && <p className="error">{errorColumna}</p>}

      <Tablero
        proyectoId={proyectoId}
        columnas={listaColumnas}
        tareas={listaTareas}
        onCrearColumna={(nombre) => crearColumna.mutate(nombre)}
        onRenombrarColumna={(columnaId, nombre) => renombrarColumna.mutate({ columnaId, nombre })}
        onMoverColumna={(columnaId, posicion) => reordenarColumna.mutate({ columnaId, posicion })}
        onEliminarColumna={(columnaId) => borrarColumna.mutate(columnaId)}
      />

      <dialog
        ref={refDialogo}
        className="dialogo-tarea"
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
          <div className="dialogo-tarea__cuerpo">
            <div className="dialogo-tarea__cabecera">
              <h2 id="titulo-dialogo-tarea">{t("tasks.new")}</h2>
              <button
                type="button"
                className="dialogo-tarea__cerrar"
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
              <div className="acciones">
                <button type="submit" className="boton-principal" disabled={crearTarea.isPending}>
                  {t("tasks.create")}
                </button>
              </div>
            </form>
          </div>
        )}
      </dialog>
    </main>
  );
}
