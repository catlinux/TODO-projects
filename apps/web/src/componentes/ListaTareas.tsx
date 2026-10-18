import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { peticion, type ColumnaApi, type EtiquetaApi, type TareaApi } from "../api";
import { chipFecha } from "../fechas";
import { IconoAdjunto, IconoCampana, IconoComentario, IconoRepeticion } from "./IconosTarea";
import { PastillaEtiqueta } from "./SelectorEtiquetas";

type OrdenLista = "posicion" | "fecha" | "titulo";

export interface PropiedadesListaTareas {
  proyectoId: string;
  columnas: ColumnaApi[];
  tareas: TareaApi[];
  /** Etiquetas del proyecto; sin ellas las filas no pintan pastillas. */
  etiquetas?: EtiquetaApi[];
  /** Con filtro de etiquetas activo, el vacío habla del filtro, no del proyecto. */
  filtroActivo?: boolean;
  onNuevaTarea(): void;
}

/** Fecha con las tareas sin fecha al final; a igual fecha, el orden de la columna. */
function compararPorFecha(a: TareaApi, b: TareaApi): number {
  const fechaA = a.venceEn ? new Date(a.venceEn).getTime() : Number.POSITIVE_INFINITY;
  const fechaB = b.venceEn ? new Date(b.venceEn).getTime() : Number.POSITIVE_INFINITY;
  return fechaA !== fechaB ? fechaA - fechaB : a.posicion - b.posicion;
}

function compararPorTitulo(a: TareaApi, b: TareaApi): number {
  const comparacion = a.titulo.localeCompare(b.titulo, "es", { sensitivity: "base" });
  return comparacion !== 0 ? comparacion : a.posicion - b.posicion;
}

function ordenarTareas(tareas: TareaApi[], orden: OrdenLista): TareaApi[] {
  const copia = tareas.slice();
  if (orden === "fecha") {
    return copia.sort(compararPorFecha);
  }
  if (orden === "titulo") {
    return copia.sort(compararPorTitulo);
  }
  return copia.sort((a, b) => a.posicion - b.posicion);
}

export function ListaTareas({
  proyectoId,
  columnas,
  tareas,
  etiquetas = [],
  filtroActivo = false,
  onNuevaTarea,
}: PropiedadesListaTareas) {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const [orden, setOrden] = useState<OrdenLista>("posicion");
  const [plegadas, setPlegadas] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const columnasOrdenadas = columnas.slice().sort((a, b) => a.posicion - b.posicion);
  const primeraColumna = columnasOrdenadas[0];
  const ultimaColumna = columnasOrdenadas[columnasOrdenadas.length - 1];

  const etiquetasPorId = new Map(etiquetas.map((etiqueta) => [etiqueta.id, etiqueta]));

  const marcarHecha = useMutation({
    mutationFn: async ({ tarea, hecha }: { tarea: TareaApi; hecha: boolean }) =>
      peticion(`/tareas/${tarea.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          columnaId: hecha ? ultimaColumna?.id : primeraColumna?.id,
        }),
      }),
    onSuccess: async () => {
      setError(null);
      await cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
      await cliente.invalidateQueries({ queryKey: ["agenda"] });
      await cliente.invalidateQueries({ queryKey: ["bandeja"] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  if (tareas.length === 0) {
    return (
      <div className="lista-tareas">
        <section className="panel-tarjeta lista-tareas__panel lista-tareas__vacia">
          <p className="lista-tareas__vacia-texto">
            {t(filtroActivo ? "tasks.filterEmptyList" : "tasks.listEmpty")}
          </p>
          <button type="button" className="boton-principal" onClick={onNuevaTarea}>
            {t("tasks.new")}
          </button>
        </section>
      </div>
    );
  }

  const grupos = columnasOrdenadas
    .map((columna) => ({
      columna,
      tareas: ordenarTareas(
        tareas.filter((tarea) => tarea.columnaId === columna.id),
        orden,
      ),
    }))
    // Con filtro activo, un grupo sin resultados no se muestra.
    .filter((grupo) => grupo.tareas.length > 0);

  return (
    <div className="lista-tareas">
      <section
        className="panel-tarjeta lista-tareas__panel"
        aria-label={t("tasks.listTitle")}
      >
        <div className="lista-tareas__barra">
          <label className="lista-tareas__orden">
            {t("tasks.sortBy")}
            <select value={orden} onChange={(evento) => setOrden(evento.target.value as OrdenLista)}>
              <option value="posicion">{t("tasks.sortPosition")}</option>
              <option value="fecha">{t("tasks.sortDate")}</option>
              <option value="titulo">{t("tasks.sortTitle")}</option>
            </select>
          </label>
        </div>

        {error && <p className="error lista-tareas__error">{error}</p>}

        {grupos.map(({ columna, tareas: tareasGrupo }) => {
          const plegada = Boolean(plegadas[columna.id]);
          const idLista = `lista-grupo-${columna.id}`;
          return (
            <section className="lista-grupo" key={columna.id}>
              <h3 className="lista-grupo__cabecera">
                <button
                  type="button"
                  className="lista-grupo__boton"
                  aria-expanded={!plegada}
                  aria-controls={idLista}
                  onClick={() =>
                    setPlegadas((actuales) => ({
                      ...actuales,
                      [columna.id]: !actuales[columna.id],
                    }))
                  }
                >
                  <span className="lista-grupo__nombre">{columna.nombre}</span>
                  <span className="lista-grupo__cuenta cifra">{tareasGrupo.length}</span>
                </button>
              </h3>

              {!plegada && (
                <ul className="lista-filas" id={idLista}>
                  {tareasGrupo.map((tarea) => {
                    const hecha = Boolean(ultimaColumna && tarea.columnaId === ultimaColumna.id);
                    const recurrente = Boolean(tarea.recurrencia);
                    const chip = chipFecha(tarea.venceEn);
                    const estadoChip = hecha ? "hecha" : chip?.estado;
                    const tieneAviso =
                      tarea.recordatorioMin !== null && tarea.recordatorioMin !== undefined;
                    const comentarios = tarea.comentarios ?? 0;
                    const adjuntos = tarea.adjuntos ?? 0;
                    const checklist = tarea.checklist;
                    const tieneChecklist = Boolean(checklist && checklist.total > 0);
                    const checklistCompleto = Boolean(
                      checklist && checklist.total > 0 && checklist.hechos === checklist.total,
                    );
                    const etiquetasDeTarea = (tarea.etiquetas ?? [])
                      .map((id) => etiquetasPorId.get(id))
                      .filter((etiqueta): etiqueta is EtiquetaApi => Boolean(etiqueta));

                    return (
                      <li
                        key={tarea.id}
                        className={`lista-fila${hecha ? " lista-fila--hecha" : ""}`}
                      >
                        <span className="lista-fila__casilla">
                          {!recurrente && (
                            <label className="lista-fila__casilla-etiqueta">
                              <input
                                type="checkbox"
                                checked={hecha}
                                disabled={!primeraColumna || !ultimaColumna || marcarHecha.isPending}
                                onChange={(evento) =>
                                  marcarHecha.mutate({ tarea, hecha: evento.target.checked })
                                }
                              />
                              <span className="visualmente-oculto">
                                {hecha ? t("hoy.markPending") : t("hoy.markDone")} {tarea.titulo}
                              </span>
                            </label>
                          )}
                        </span>

                        <span className="lista-fila__contenido">
                          <Link
                            className="lista-fila__titulo"
                            to={`/proyectos/${proyectoId}/tareas/${tarea.id}`}
                          >
                            {tarea.titulo}
                          </Link>

                          {(chip ||
                            tieneAviso ||
                            recurrente ||
                            tieneChecklist ||
                            comentarios > 0 ||
                            adjuntos > 0 ||
                            etiquetasDeTarea.length > 0) && (
                            <span className="lista-fila__metadatos">
                              {etiquetasDeTarea.map((etiqueta) => (
                                <PastillaEtiqueta key={etiqueta.id} etiqueta={etiqueta} />
                              ))}
                              {chip && (
                                <span className={`chip-fecha chip-fecha--${estadoChip} cifra`}>
                                  {chip.texto}
                                </span>
                              )}
                              {tieneAviso && <IconoCampana etiqueta={t("tasks.hasReminder")} />}
                              {recurrente && <IconoRepeticion etiqueta={t("tasks.repeats")} />}
                              {tieneChecklist && checklist && (
                                <span
                                  className={`tarjeta-kanban__insignia cifra${
                                    checklistCompleto ? " tarjeta-kanban__insignia--hecha" : ""
                                  }`}
                                  aria-label={t("tasks.checklistBadge", {
                                    hechos: checklist.hechos,
                                    total: checklist.total,
                                  })}
                                >
                                  {checklist.hechos}/{checklist.total}
                                </span>
                              )}
                              {comentarios > 0 && (
                                <span className="tarjeta-kanban__insignia tarjeta-kanban__insignia--comentarios">
                                  <IconoComentario
                                    etiqueta={t("tasks.commentBadge", { n: comentarios })}
                                  />
                                  <span className="cifra" aria-hidden="true">
                                    {comentarios}
                                  </span>
                                </span>
                              )}
                              {adjuntos > 0 && (
                                <span className="tarjeta-kanban__insignia tarjeta-kanban__insignia--adjuntos">
                                  <IconoAdjunto
                                    etiqueta={t("tasks.attachmentBadge", { n: adjuntos })}
                                  />
                                  <span className="cifra" aria-hidden="true">
                                    {adjuntos}
                                  </span>
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </section>
    </div>
  );
}
