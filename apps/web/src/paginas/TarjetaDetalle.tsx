import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { peticion, type ColumnaApi, type TareaApi } from "../api";
import { Adjuntos } from "../componentes/Adjuntos";
import { CamposTarea, type ValoresFormularioTarea } from "../componentes/CamposTarea";
import { Checklist } from "../componentes/Checklist";
import { PanelActividad } from "../componentes/PanelActividad";
import { SelectorEtiquetas } from "../componentes/SelectorEtiquetas";
import { SelectorPortada } from "../componentes/SelectorPortada";
import { formatearTexto } from "../formato";
import { esPortadaImagen, estiloPortada } from "../portada";
import {
  aIsoUtc,
  aValorLocal,
  analizarRegla,
  construirRegla,
  recurrenciaPorDefecto,
  zonaNavegador,
} from "../recurrencia-web";

function valoresVacios(): ValoresFormularioTarea {
  return {
    titulo: "",
    descripcion: "",
    venceEnLocal: "",
    recurrencia: recurrenciaPorDefecto(),
    recordatorioMin: null,
  };
}

function valoresDesdeTarea(tarea: TareaApi): ValoresFormularioTarea {
  return {
    titulo: tarea.titulo,
    descripcion: tarea.descripcion ?? "",
    venceEnLocal: aValorLocal(tarea.venceEn),
    recurrencia: analizarRegla(tarea.recurrencia),
    recordatorioMin: tarea.recordatorioMin ?? null,
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

/** Iconos de la fila de acciones rápidas (16 px). */
function IconoEtiquetas() {
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
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-6.2-6.2A2 2 0 0 1 3.8 13V5.8A2 2 0 0 1 5.8 3.8H13a2 2 0 0 1 1.4.6l6.2 6.2a2 2 0 0 1 0 2.8z" />
      <circle cx="8.5" cy="8.5" r="1" />
    </svg>
  );
}

function IconoChecklist() {
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
      <path d="M4 6h2l2 2 4-4" />
      <path d="M4 15h2l2 2 4-4" />
      <path d="M14 7h6" />
      <path d="M14 16h6" />
    </svg>
  );
}

function IconoPortada() {
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

function IconoAdjuntar() {
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
      <path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 18a2 2 0 0 1-3-3l7.5-7.5" />
    </svg>
  );
}

/** Lleva el foco a una sección de la tarjeta desde la fila de acciones. */
function irASeccion(id: string) {
  document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
}

export default function TarjetaDetalle() {
  const { t } = useTranslation();
  const navegar = useNavigate();
  const { id, tareaId } = useParams();
  const proyectoId = id ?? "";
  const cliente = useQueryClient();
  const refDialogo = useRef<HTMLDialogElement>(null);

  const tarea = useQuery({
    queryKey: ["tarea", tareaId],
    queryFn: () => peticion<TareaApi>(`/tareas/${tareaId}`),
    enabled: Boolean(tareaId),
    retry: false,
  });

  const columnas = useQuery({
    queryKey: ["columnas", proyectoId],
    queryFn: () => peticion<ColumnaApi[]>(`/proyectos/${proyectoId}/columnas`),
    enabled: Boolean(proyectoId),
  });

  const [valores, setValores] = useState<ValoresFormularioTarea>(valoresVacios);
  const [editandoTitulo, setEditandoTitulo] = useState(false);
  const [editandoDescripcion, setEditandoDescripcion] = useState(false);
  const [focoInicialPuesto, setFocoInicialPuesto] = useState(false);
  const refTitulo = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (tarea.data) {
      setValores(valoresDesdeTarea(tarea.data));
    }
  }, [tarea.data]);

  useEffect(() => {
    const dialogo = refDialogo.current;
    if (!dialogo) return;
    if (typeof dialogo.showModal === "function") {
      if (!dialogo.open) dialogo.showModal();
    } else {
      dialogo.setAttribute("open", "");
    }
  }, []);

  // Al cerrar, el foco vuelve a la tarjeta del tablero, que sigue debajo.
  useEffect(
    () => () => {
      document.getElementById(`tarjeta-${tareaId}`)?.focus();
    },
    [tareaId],
  );

  const guardar = useMutation({
    mutationFn: async (cambios: Record<string, unknown>) =>
      peticion<TareaApi>(`/tareas/${tareaId}`, {
        method: "PATCH",
        body: JSON.stringify(cambios),
      }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
      await cliente.invalidateQueries({ queryKey: ["tarea", tareaId] });
      await cliente.invalidateQueries({ queryKey: ["agenda"] });
    },
  });

  const columnasOrdenadas = useMemo(
    () => (columnas.data ?? []).slice().sort((a, b) => a.posicion - b.posicion),
    [columnas.data],
  );
  const primeraColumnaId = columnasOrdenadas[0]?.id ?? "";
  const ultimaColumnaId = columnasOrdenadas[columnasOrdenadas.length - 1]?.id ?? "";

  const tareaActual = tarea.data;
  const estiloPortadaActual = estiloPortada(tareaActual?.portada);
  const esRecurrente = Boolean(tareaActual?.recurrencia);
  const hecha = Boolean(tareaActual && ultimaColumnaId && tareaActual.columnaId === ultimaColumnaId);

  // Foco inicial en el título en cuanto la tarea está disponible.
  useEffect(() => {
    if (tareaActual && !focoInicialPuesto) {
      refTitulo.current?.focus();
      setFocoInicialPuesto(true);
    }
  }, [tareaActual, focoInicialPuesto]);

  const hayCambiosDatos = Boolean(
    tareaActual &&
      (valores.venceEnLocal !== aValorLocal(tareaActual.venceEn) ||
        valores.recordatorioMin !== (tareaActual.recordatorioMin ?? null) ||
        (valores.venceEnLocal ? construirRegla(valores.recurrencia) : null) !==
          (tareaActual.recurrencia ?? null)),
  );

  function cerrar() {
    navegar(`/proyectos/${proyectoId}`, { replace: true });
  }

  function confirmarTitulo() {
    if (!tareaActual) return;
    const titulo = valores.titulo.trim();
    if (!titulo || titulo === tareaActual.titulo) {
      setValores((actuales) => ({ ...actuales, titulo: tareaActual.titulo }));
      setEditandoTitulo(false);
      return;
    }
    guardar.mutate({ titulo }, { onSuccess: () => setEditandoTitulo(false) });
  }

  function cancelarTitulo() {
    setValores((actuales) => ({ ...actuales, titulo: tareaActual?.titulo ?? actuales.titulo }));
    setEditandoTitulo(false);
  }

  function confirmarDatos() {
    const venceEn = aIsoUtc(valores.venceEnLocal);
    guardar.mutate({
      venceEn,
      recurrencia: venceEn ? construirRegla(valores.recurrencia) : null,
      zona: zonaNavegador(),
      recordatorioMin: venceEn ? valores.recordatorioMin : null,
    });
  }

  function confirmarDescripcion() {
    guardar.mutate(
      { descripcion: valores.descripcion },
      { onSuccess: () => setEditandoDescripcion(false) },
    );
  }

  function cancelarDescripcion() {
    setValores((actuales) => ({
      ...actuales,
      descripcion: tareaActual?.descripcion ?? "",
    }));
    setEditandoDescripcion(false);
  }

  return (
    <dialog
      ref={refDialogo}
      className="dialogo tarjeta-detalle"
      aria-labelledby="titulo-tarjeta"
      onCancel={(evento) => {
        evento.preventDefault();
        cerrar();
      }}
      onKeyDown={(evento) => {
        if (evento.key === "Escape") {
          evento.preventDefault();
          cerrar();
        }
      }}
      onClick={(evento) => {
        // El velo es el propio <dialog>: un clic fuera del contenido lo cierra.
        if (evento.target === refDialogo.current) {
          cerrar();
        }
      }}
    >
      {tarea.isError ? (
        <div className="tarjeta-detalle__principal">
          <p className="error">{t("tasks.notFound")}</p>
          <div className="acciones">
            <button type="button" className="boton-principal" onClick={cerrar}>
              {t("tasks.backToBoard")}
            </button>
          </div>
        </div>
      ) : !tareaActual ? (
        <div className="tarjeta-detalle__principal">
          <p>{t("app.loading")}</p>
        </div>
      ) : (
        <div className="tarjeta-detalle__marco">
          {estiloPortadaActual && (
            <span
              className={`tarjeta-detalle__portada${
                esPortadaImagen(tareaActual.portada) ? " tarjeta-detalle__portada--imagen" : ""
              }`}
              style={estiloPortadaActual}
              aria-hidden="true"
            />
          )}

          <div className="tarjeta-detalle__cuerpo">
            <div className="tarjeta-detalle__principal">
              <header className="tarjeta-detalle__cabecera">
                <label className="tarjeta-detalle__columna">
                  {t("tasks.column")}
                  <select
                    value={tareaActual.columnaId}
                    onChange={(evento) => guardar.mutate({ columnaId: evento.target.value })}
                  >
                    {columnasOrdenadas.map((columna) => (
                      <option key={columna.id} value={columna.id}>
                        {columna.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="boton-icono"
                  aria-label={t("tasks.closeDialog")}
                  onClick={cerrar}
                >
                  <IconoCerrar />
                </button>
              </header>

              <div className="tarjeta-detalle__titulo-fila">
                <h2 id="titulo-tarjeta" className="tarjeta-detalle__titulo">
                  {editandoTitulo ? (
                    <input
                      aria-label={t("tasks.taskTitle")}
                      value={valores.titulo}
                      autoFocus
                      onChange={(evento) =>
                        setValores((actuales) => ({ ...actuales, titulo: evento.target.value }))
                      }
                      onKeyDown={(evento) => {
                        if (evento.key === "Enter") {
                          evento.preventDefault();
                          confirmarTitulo();
                        } else if (evento.key === "Escape") {
                          evento.preventDefault();
                          cancelarTitulo();
                        }
                      }}
                      onBlur={confirmarTitulo}
                    />
                  ) : (
                    <button
                      type="button"
                      ref={refTitulo}
                      className="tarjeta-detalle__titulo-boton"
                      onClick={() => setEditandoTitulo(true)}
                    >
                      {tareaActual.titulo}
                    </button>
                  )}
                </h2>

                {!esRecurrente && (
                  <label className="tarjeta-detalle__hecha">
                    <input
                      type="checkbox"
                      checked={hecha}
                      onChange={(evento) => {
                        const columnaId = evento.target.checked ? ultimaColumnaId : primeraColumnaId;
                        if (columnaId && columnaId !== tareaActual.columnaId) {
                          guardar.mutate({ columnaId });
                        }
                      }}
                    />
                    {t("tasks.done")}
                  </label>
                )}
              </div>

              <div className="tarjeta-detalle__acciones-rapidas">
                <button
                  type="button"
                  className="boton tarjeta-detalle__accion"
                  onClick={() => irASeccion("seccion-etiquetas")}
                >
                  <IconoEtiquetas />
                  {t("labels.button")}
                </button>
                <button
                  type="button"
                  className="boton tarjeta-detalle__accion"
                  onClick={() => irASeccion("seccion-checklist")}
                >
                  <IconoChecklist />
                  {t("checklist.section")}
                </button>
                <button
                  type="button"
                  className="boton tarjeta-detalle__accion"
                  onClick={() => irASeccion("seccion-portada")}
                >
                  <IconoPortada />
                  {t("cover.section")}
                </button>
                <button
                  type="button"
                  className="boton tarjeta-detalle__accion"
                  onClick={() => document.getElementById("adjuntos-archivo")?.click()}
                >
                  <IconoAdjuntar />
                  {t("attachments.attach")}
                </button>
              </div>

              <SelectorEtiquetas
                id="seccion-etiquetas"
                tareaId={tareaId ?? ""}
                proyectoId={proyectoId}
                asignadas={tareaActual.etiquetas ?? []}
              />

              <section id="seccion-fechas" className="tarjeta-detalle__seccion">
                <h3>{t("tasks.dates")}</h3>
                <form
                  className="tarjeta-detalle__datos"
                  onSubmit={(evento) => {
                    evento.preventDefault();
                    confirmarDatos();
                  }}
                >
                  <CamposTarea
                    valores={valores}
                    onCambio={setValores}
                    ocultar={["titulo", "descripcion"]}
                  />
                  {hayCambiosDatos && (
                    <div className="acciones">
                      <button type="submit" className="boton-principal" disabled={guardar.isPending}>
                        {t("tasks.save")}
                      </button>
                    </div>
                  )}
                </form>
              </section>

              <section id="seccion-descripcion" className="tarjeta-detalle__seccion">
                <div className="tarjeta-detalle__seccion-cabecera">
                  <h3>{t("tasks.description")}</h3>
                  {!editandoDescripcion && (
                    <button
                      type="button"
                      className="boton-texto"
                      onClick={() => setEditandoDescripcion(true)}
                    >
                      {t("tasks.editDescription")}
                    </button>
                  )}
                </div>

                {editandoDescripcion ? (
                  <form
                    onSubmit={(evento) => {
                      evento.preventDefault();
                      confirmarDescripcion();
                    }}
                  >
                    <textarea
                      className="tarjeta-detalle__descripcion-textarea"
                      aria-label={t("tasks.description")}
                      rows={6}
                      autoFocus
                      value={valores.descripcion}
                      onChange={(evento) =>
                        setValores((actuales) => ({ ...actuales, descripcion: evento.target.value }))
                      }
                      onKeyDown={(evento) => {
                        if (evento.key === "Escape") {
                          evento.preventDefault();
                          cancelarDescripcion();
                        }
                      }}
                    />
                    <div className="acciones">
                      <button type="submit" className="boton-principal" disabled={guardar.isPending}>
                        {t("tasks.save")}
                      </button>
                      <button type="button" onClick={cancelarDescripcion}>
                        {t("tasks.cancel")}
                      </button>
                    </div>
                  </form>
                ) : valores.descripcion.trim() ? (
                  <div className="tarjeta-detalle__descripcion">{formatearTexto(valores.descripcion)}</div>
                ) : (
                  <button
                    type="button"
                    className="tarjeta-detalle__descripcion-vacia"
                    onClick={() => setEditandoDescripcion(true)}
                  >
                    {t("tasks.addDescription")}
                  </button>
                )}
              </section>

              <Checklist id="seccion-checklist" tareaId={tareaId ?? ""} proyectoId={proyectoId} />

              <SelectorPortada
                id="seccion-portada"
                tareaId={tareaId ?? ""}
                proyectoId={proyectoId}
                portada={tareaActual.portada ?? null}
              />

              <Adjuntos
                id="seccion-adjuntos"
                tareaId={tareaId ?? ""}
                proyectoId={proyectoId}
                portada={tareaActual.portada ?? null}
              />
            </div>

            <PanelActividad tareaId={tareaId ?? ""} proyectoId={proyectoId} />
          </div>
        </div>
      )}
    </dialog>
  );
}
