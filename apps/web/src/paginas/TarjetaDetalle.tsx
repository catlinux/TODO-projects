import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { peticion, type ColumnaApi, type TareaApi } from "../api";
import { CamposTarea, type ValoresFormularioTarea } from "../componentes/CamposTarea";
import { formatearTexto } from "../formato";
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

/** Color de la portada; la portada de imagen se ignora hasta la fase E. */
function colorDePortada(tarea: TareaApi): string | null {
  return tarea.portada?.tipo === "color" ? tarea.portada.valor : null;
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
      className="tarjeta-detalle"
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
        <div className="tarjeta-detalle__cuerpo">
          <p className="error">{t("tasks.notFound")}</p>
          <div className="acciones">
            <button type="button" className="boton-principal" onClick={cerrar}>
              {t("tasks.backToBoard")}
            </button>
          </div>
        </div>
      ) : !tareaActual ? (
        <div className="tarjeta-detalle__cuerpo">
          <p>{t("app.loading")}</p>
        </div>
      ) : (
        <div className="tarjeta-detalle__marco">
          {colorDePortada(tareaActual) && (
            <span
              className="tarjeta-detalle__portada"
              style={{ background: colorDePortada(tareaActual)! }}
              aria-hidden="true"
            />
          )}

          <div className="tarjeta-detalle__cuerpo">
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
                className="dialogo-tarea__cerrar"
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

            <section className="tarjeta-detalle__seccion">
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

            <section className="tarjeta-detalle__seccion">
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
          </div>
        </div>
      )}
    </dialog>
  );
}
