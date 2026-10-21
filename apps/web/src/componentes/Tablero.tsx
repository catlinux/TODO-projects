import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type Active,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { peticion, type ColumnaApi, type ElementoChecklistTarjetaApi, type EtiquetaApi, type TareaApi } from "../api";
import { chipFecha } from "../fechas";
import { datosPortadaTarjeta } from "../portada";
import { moverTareaEnLista } from "../tablero-utils";
import { DialogoElementoChecklist } from "./DialogoElementoChecklist";
import { IconoAdjunto, IconoCampana, IconoComentario, IconoDescripcion, IconoRepeticion } from "./IconosTarea";
import { PastillaEtiqueta } from "./SelectorEtiquetas";

export interface PropiedadesTablero {
  proyectoId: string;
  columnas: ColumnaApi[];
  tareas: TareaApi[];
  /** Etiquetas del proyecto; sin ellas las tarjetas no pintan pastillas. */
  etiquetas?: EtiquetaApi[];
  onCrearTarea(columnaId: string, titulo: string): void;
  onCrearColumna(nombre: string): void;
  onRenombrarColumna(columnaId: string, nombre: string): void;
  onMoverColumna(columnaId: string, posicion: number): void;
  onEliminarColumna(columnaId: string): void;
  /** Columnas en vista compacta (solo el título de cada tarjeta). */
  columnasCompactas: string[];
  onAlternarColumnaCompacta(columnaId: string): void;
}

export interface ControlTablero {
  gestionarFinArrastre(event: DragEndEvent): Promise<void>;
}

interface TarjetaProps {
  tarea: TareaApi;
  proyectoId: string;
  columnas: ColumnaApi[];
  etiquetas: EtiquetaApi[];
  hecha: boolean;
  compacta: boolean;
  borrarTarea(tareaId: string): Promise<void>;
  moverTarea(tareaId: string, columnaId: string): Promise<void>;
  alternarElemento(elementoId: string, hecho: boolean): Promise<void>;
  abrirElemento(elemento: ElementoChecklistTarjetaApi): void;
}

/** Elementos del checklist que se ven en la tarjeta antes del «+N más». */
const MAX_ELEMENTOS_EN_TARJETA = 4;

/** Aplica el cambio de un elemento en la lista de tareas sin esperar a la API. */
function alternarElementoEnTareas(
  tareas: TareaApi[],
  elementoId: string,
  hecho: boolean,
): TareaApi[] {
  return tareas.map((tarea) => {
    const checklist = tarea.checklist;
    const items = checklist?.items;
    if (!checklist || !items || !items.some((item) => item.id === elementoId)) {
      return tarea;
    }
    const actualizados = items.map((item) => (item.id === elementoId ? { ...item, hecho } : item));
    return {
      ...tarea,
      checklist: {
        hechos: actualizados.filter((item) => item.hecho).length,
        total: checklist.total,
        items: actualizados,
      },
    };
  });
}

function TarjetaArrastrable({
  tarea,
  proyectoId,
  columnas,
  etiquetas,
  hecha,
  compacta,
  borrarTarea,
  moverTarea,
  alternarElemento,
  abrirElemento,
}: TarjetaProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tarea.id,
    data: { titulo: tarea.titulo },
  });
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [submenuMover, setSubmenuMover] = useState(false);
  const [imagenFallida, setImagenFallida] = useState(false);
  const [checklistExpandido, setChecklistExpandido] = useState(false);
  const refOpciones = useRef<HTMLButtonElement>(null);

  const estilo = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const columnasOrdenadas = columnas.slice().sort((a, b) => a.posicion - b.posicion);
  const rutaTarjeta = `/proyectos/${proyectoId}/tareas/${tarea.id}`;

  function cerrarMenu(devolverFoco = true) {
    setMenuAbierto(false);
    setSubmenuMover(false);
    if (devolverFoco) {
      refOpciones.current?.focus();
    }
  }

  const chip = chipFecha(tarea.venceEn);
  const estadoChip = hecha ? "hecha" : chip?.estado;
  const tieneAviso = tarea.recordatorioMin !== null && tarea.recordatorioMin !== undefined;
  const tieneRecurrencia = Boolean(tarea.recurrencia);
  const portada = datosPortadaTarjeta(tarea.id, imagenFallida ? null : tarea.portada);
  const comentarios = tarea.comentarios ?? 0;
  const tieneComentarios = comentarios > 0;
  const adjuntos = tarea.adjuntos ?? 0;
  const tieneAdjuntos = adjuntos > 0;

  const asignadas = tarea.etiquetas ?? [];
  const etiquetasDeTarea = etiquetas.filter((etiqueta) => asignadas.includes(etiqueta.id));
  const checklist = tarea.checklist;
  const tieneChecklist = Boolean(checklist && checklist.total > 0);
  const checklistCompleto = Boolean(checklist && checklist.total > 0 && checklist.hechos === checklist.total);
  const elementosChecklist = checklist?.items ?? [];
  const elementosVisibles = elementosChecklist.slice(0, MAX_ELEMENTOS_EN_TARJETA);
  const elementosRestantes = elementosChecklist.length - elementosVisibles.length;
  const elementosAMostrar = checklistExpandido ? elementosChecklist : elementosVisibles;

  const botonAsa = (
    <button
      type="button"
      className="boton-icono tarjeta-kanban__asa"
      aria-label={t("tasks.drag")}
      {...attributes}
      {...listeners}
    >
      ≡
    </button>
  );

  const botonOpciones = (
    <button
      type="button"
      className="boton-icono tarjeta-kanban__opciones"
      ref={refOpciones}
      aria-label={`${t("tasks.options")} ${tarea.titulo}`}
      aria-haspopup="menu"
      aria-expanded={menuAbierto}
      onClick={() => {
        setSubmenuMover(false);
        setMenuAbierto((abierto) => !abierto);
      }}
    >
      ⋯
    </button>
  );

  return (
    <li
      ref={setNodeRef}
      className={`tarjeta-kanban${compacta ? " tarjeta-kanban--compacta" : ""}${
        hecha ? " tarjeta-kanban--hecha" : ""
      }${isDragging ? " tarjeta-kanban--arrastrando" : ""}`}
      style={estilo}
      onKeyDown={(evento) => {
        if (evento.key === "Escape" && menuAbierto) {
          evento.preventDefault();
          evento.stopPropagation();
          cerrarMenu();
        }
      }}
    >
      {compacta ? (
        <div className="tarjeta-kanban__fila-compacta">
          {botonAsa}
          <Link
            id={`tarjeta-${tarea.id}`}
            className="tarjeta-kanban__enlace tarjeta-kanban__enlace--compacto"
            to={rutaTarjeta}
            title={tarea.titulo}
            onClick={() => cerrarMenu(false)}
          >
            <span className="tarjeta-kanban__vineta" aria-hidden="true">
              ›
            </span>
            <span className="tarjeta-kanban__titulo-compacto">{tarea.titulo}</span>
          </Link>
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
          {botonOpciones}
        </div>
      ) : (
        <>
          <div className="tarjeta-kanban__barra">
            {botonAsa}
            {botonOpciones}
          </div>

          <div
            className={`tarjeta-kanban__portada${
              portada.imagen ? " tarjeta-kanban__portada--imagen" : ""
            }`}
            style={portada.imagen ? undefined : portada.estilo}
          >
            {portada.imagen && (
              <img
                className="tarjeta-kanban__imagen"
                src={portada.imagen}
                alt=""
                draggable={false}
                onError={() => setImagenFallida(true)}
              />
            )}
            <Link
              id={`tarjeta-${tarea.id}`}
              className="tarjeta-kanban__enlace"
              to={rutaTarjeta}
              onClick={() => cerrarMenu(false)}
            >
              <span className="tarjeta-kanban__titulo">{tarea.titulo}</span>
            </Link>
          </div>

          {elementosVisibles.length > 0 && (
            <div className="tarjeta-kanban__checklist">
              <ul className="tarjeta-kanban__checklist-lista">
                {elementosAMostrar.map((elemento) => (
                  <li
                    key={elemento.id}
                    className={`tarjeta-kanban__checklist-item${
                      elemento.hecho ? " tarjeta-kanban__checklist-item--hecho" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={elemento.hecho}
                      aria-label={elemento.texto}
                      onPointerDown={(evento) => evento.stopPropagation()}
                      onChange={() => void alternarElemento(elemento.id, !elemento.hecho)}
                    />
                    <button
                      type="button"
                      className="tarjeta-kanban__checklist-boton"
                      aria-label={t("checklist.open", { texto: elemento.texto })}
                      onPointerDown={(evento) => evento.stopPropagation()}
                      onKeyDown={(evento) => evento.stopPropagation()}
                      onClick={(evento) => {
                        evento.stopPropagation();
                        abrirElemento(elemento);
                      }}
                    >
                      <span className="tarjeta-kanban__checklist-texto">{elemento.texto}</span>
                      {elemento.tieneDescripcion ? (
                        <IconoDescripcion etiqueta={t("checklist.hasDescription")} />
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
              {(elementosRestantes > 0 || checklistExpandido) && (
                <button
                  type="button"
                  className="tarjeta-kanban__checklist-mas"
                  aria-expanded={checklistExpandido}
                  onPointerDown={(evento) => evento.stopPropagation()}
                  onKeyDown={(evento) => evento.stopPropagation()}
                  onClick={(evento) => {
                    evento.stopPropagation();
                    setChecklistExpandido((expandido) => !expandido);
                  }}
                >
                  {checklistExpandido
                    ? t("tasks.checklistLess")
                    : t("tasks.checklistMore", { n: elementosRestantes })}
                </button>
              )}
            </div>
          )}

          {(etiquetasDeTarea.length > 0 ||
            chip ||
            tieneAviso ||
            tieneRecurrencia ||
            tieneChecklist ||
            tieneComentarios ||
            tieneAdjuntos) && (
            <div className="tarjeta-kanban__pie">
              {etiquetasDeTarea.length > 0 && (
                <span className="tarjeta-kanban__etiquetas">
                  {etiquetasDeTarea.map((etiqueta) => (
                    <PastillaEtiqueta key={etiqueta.id} etiqueta={etiqueta} />
                  ))}
                </span>
              )}
              <span className="tarjeta-kanban__indicadores">
                {chip && (
                  <span className={`chip-fecha chip-fecha--${estadoChip} cifra`}>{chip.texto}</span>
                )}
                {tieneAviso && <IconoCampana etiqueta={t("tasks.hasReminder")} />}
                {tieneRecurrencia && <IconoRepeticion etiqueta={t("tasks.repeats")} />}
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
                {tieneComentarios && (
                  <span className="tarjeta-kanban__insignia tarjeta-kanban__insignia--comentarios">
                    <IconoComentario etiqueta={t("tasks.commentBadge", { n: comentarios })} />
                    <span className="cifra" aria-hidden="true">
                      {comentarios}
                    </span>
                  </span>
                )}
                {tieneAdjuntos && (
                  <span className="tarjeta-kanban__insignia tarjeta-kanban__insignia--adjuntos">
                    <IconoAdjunto etiqueta={t("tasks.attachmentBadge", { n: adjuntos })} />
                    <span className="cifra" aria-hidden="true">
                      {adjuntos}
                    </span>
                  </span>
                )}
              </span>
            </div>
          )}
        </>
      )}

      {menuAbierto && (
        <div className="menu-tarjeta" role="menu" aria-label={t("tasks.options")}>
          <Link
            role="menuitem"
            to={rutaTarjeta}
            onClick={() => cerrarMenu(false)}
          >
            {t("tasks.edit")}
          </Link>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenuMover}
            onClick={() => setSubmenuMover((abierto) => !abierto)}
          >
            {t("tasks.moveTo")}…
          </button>
          {submenuMover && (
            <div className="menu-tarjeta__submenu" role="menu" aria-label={t("tasks.moveTo")}>
              {columnasOrdenadas.map((columna) => (
                <button
                  key={columna.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    cerrarMenu(false);
                    void moverTarea(tarea.id, columna.id);
                  }}
                >
                  {columna.nombre}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              cerrarMenu(false);
              void borrarTarea(tarea.id);
            }}
          >
            {t("tasks.delete")}
          </button>
        </div>
      )}
    </li>
  );
}

export const Tablero = forwardRef<ControlTablero, PropiedadesTablero>(function Tablero(
  {
    proyectoId,
    columnas,
    tareas,
    etiquetas = [],
    onCrearTarea,
    onCrearColumna,
    onRenombrarColumna,
    onMoverColumna,
    onEliminarColumna,
    columnasCompactas,
    onAlternarColumnaCompacta,
  },
  ref,
) {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const queryKey = ["tareas", proyectoId];
  const [activa, setActiva] = useState<TareaApi | null>(null);
  const [elementoAbierto, setElementoAbierto] = useState<{
    tareaId: string;
    elemento: ElementoChecklistTarjetaApi;
  } | null>(null);
  const [menuAbierto, setMenuAbierto] = useState<string | null>(null);
  const [columnaRenombrando, setColumnaRenombrando] = useState<string | null>(null);
  const [nombreRenombrado, setNombreRenombrado] = useState("");
  const [columnaAnadiendo, setColumnaAnadiendo] = useState<string | null>(null);
  const [tituloNuevaTarjeta, setTituloNuevaTarjeta] = useState("");
  const [creandoColumna, setCreandoColumna] = useState(false);
  const [nombreNuevaColumna, setNombreNuevaColumna] = useState("");
  const refsOpciones = useRef<Record<string, HTMLButtonElement | null>>({});

  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columnasOrdenadas = columnas.slice().sort((a, b) => a.posicion - b.posicion);

  const tareasPorColumna = (columnaId: string) =>
    tareas
      .filter((tarea) => tarea.columnaId === columnaId)
      .slice()
      .sort((a, b) => a.posicion - b.posicion);

  async function borrarTarea(tareaId: string) {
    await peticion(`/tareas/${tareaId}`, { method: "DELETE" });
    await cliente.invalidateQueries({ queryKey });
  }

  async function moverTarea(tareaId: string, columnaId: string) {
    await peticion(`/tareas/${tareaId}`, {
      method: "PATCH",
      body: JSON.stringify({ columnaId }),
    });
    await cliente.invalidateQueries({ queryKey });
  }

  async function alternarElemento(elementoId: string, hecho: boolean) {
    const anteriores = cliente.getQueryData<TareaApi[]>(queryKey);
    if (anteriores) {
      cliente.setQueryData(queryKey, alternarElementoEnTareas(anteriores, elementoId, hecho));
    }

    try {
      await peticion(`/checklist/${elementoId}`, {
        method: "PATCH",
        body: JSON.stringify({ hecho }),
      });
      await cliente.invalidateQueries({ queryKey });
    } catch {
      if (anteriores) {
        cliente.setQueryData(queryKey, anteriores);
      }
      await cliente.invalidateQueries({ queryKey });
    }
  }

  function buscarColumnaDeTarea(tareaId: string): string | null {
    return tareas.find((item) => item.id === tareaId)?.columnaId ?? null;
  }

  function cerrarMenu(columnaId: string) {
    setMenuAbierto(null);
    refsOpciones.current[columnaId]?.focus();
  }

  function empezarRenombrado(columna: ColumnaApi) {
    setMenuAbierto(null);
    setNombreRenombrado(columna.nombre);
    setColumnaRenombrando(columna.id);
  }

  function confirmarRenombrado(columnaId: string) {
    const nombre = nombreRenombrado.trim();
    if (!nombre) return;
    onRenombrarColumna(columnaId, nombre);
    setColumnaRenombrando(null);
  }

  function confirmarNuevaColumna() {
    const nombre = nombreNuevaColumna.trim();
    if (!nombre) return;
    onCrearColumna(nombre);
    setNombreNuevaColumna("");
    setCreandoColumna(false);
  }

  function empezarAnadirTarjeta(columnaId: string) {
    setTituloNuevaTarjeta("");
    setColumnaAnadiendo(columnaId);
  }

  function cerrarAnadirTarjeta() {
    setTituloNuevaTarjeta("");
    setColumnaAnadiendo(null);
  }

  function confirmarNuevaTarjeta(columnaId: string) {
    const titulo = tituloNuevaTarjeta.trim();
    if (!titulo) return;
    onCrearTarea(columnaId, titulo);
    // El campo sigue abierto y vacío para encadenar tarjetas.
    setTituloNuevaTarjeta("");
  }

  const gestionarFinArrastre = async (event: DragEndEvent): Promise<void> => {
    setActiva(null);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) {
      return;
    }

    let columnaDestino = overId;
    if (!columnas.some((columna) => columna.id === overId)) {
      const encontrada = buscarColumnaDeTarea(overId);
      if (!encontrada) {
        return;
      }
      columnaDestino = encontrada;
    }

    const columnaOrigen = buscarColumnaDeTarea(activeId);
    if (!columnaOrigen) {
      return;
    }

    const tareasDestinoIds = tareasPorColumna(columnaDestino).map((item) => item.id);
    const indiceAnterior = tareasPorColumna(columnaOrigen)
      .map((item) => item.id)
      .indexOf(activeId);

    const posicionSobre = tareasDestinoIds.indexOf(overId);
    const indiceDestino = posicionSobre === -1 ? tareasDestinoIds.length : posicionSobre;

    if (columnaOrigen === columnaDestino && indiceAnterior === indiceDestino) {
      return;
    }

    const anteriores = cliente.getQueryData<TareaApi[]>(queryKey) ?? [];
    const siguiente = moverTareaEnLista(anteriores, activeId, columnaDestino, indiceDestino);
    cliente.setQueryData(queryKey, siguiente);

    try {
      await peticion(`/tareas/${activeId}`, {
        method: "PATCH",
        body: JSON.stringify({ columnaId: columnaDestino, posicion: indiceDestino }),
      });
      await cliente.invalidateQueries({ queryKey });
    } catch {
      cliente.setQueryData(queryKey, anteriores);
      await cliente.invalidateQueries({ queryKey });
    }
  };

  useImperativeHandle(ref, () => ({ gestionarFinArrastre }), [cliente, columnas, tareas, queryKey]);

  const anuncios = {
    onDragStart({ active: eventoActivo }: { active: Active }) {
      return t("dnd.announcements.start", {
        item: eventoActivo.data?.current?.titulo ?? eventoActivo.id,
      });
    },
    onDragOver({ active: eventoActivo }: { active: Active; over: { id: string | number } | null }) {
      return t("dnd.announcements.over", {
        item: eventoActivo.data?.current?.titulo ?? eventoActivo.id,
      });
    },
    onDragEnd({ active: eventoActivo }: { active: Active; over: { id: string | number } | null }) {
      return t("dnd.announcements.end", {
        item: eventoActivo.data?.current?.titulo ?? eventoActivo.id,
      });
    },
    onDragCancel({ active: eventoActivo }: { active: Active }) {
      return t("dnd.announcements.cancel", {
        item: eventoActivo.data?.current?.titulo ?? eventoActivo.id,
      });
    },
  };

  return (
    <DndContext
      sensors={sensores}
      onDragStart={(event: DragStartEvent) => {
        const encontrado = tareas.find((item) => item.id === event.active.id);
        setActiva(encontrado ?? null);
      }}
      onDragEnd={(event: DragEndEvent) => void gestionarFinArrastre(event)}
      accessibility={{ announcements: anuncios }}
    >
      <div className="tablero" role="list" aria-label={t("tasks.listTitle")}>
        {columnasOrdenadas.map((columna, indice) => {
          const tareasColumna = tareasPorColumna(columna.id);
          const menuVisible = menuAbierto === columna.id;
          const compacta = columnasCompactas.includes(columna.id);
          return (
            <section
              key={columna.id}
              className={`columna-kanban${compacta ? " columna-kanban--compacta" : ""}`}
              aria-label={columna.nombre}
              onKeyDown={(evento) => {
                if (evento.key === "Escape" && menuVisible) {
                  evento.preventDefault();
                  cerrarMenu(columna.id);
                }
              }}
            >
              <div className="columna-kanban__cabecera">
                {columnaRenombrando === columna.id ? (
                  <form
                    className="columna-kanban__renombrar"
                    onSubmit={(evento) => {
                      evento.preventDefault();
                      confirmarRenombrado(columna.id);
                    }}
                  >
                    <input
                      aria-label={t("columns.name")}
                      autoFocus
                      value={nombreRenombrado}
                      onChange={(evento) => setNombreRenombrado(evento.target.value)}
                    />
                    <button type="submit">{t("columns.save")}</button>
                  </form>
                ) : (
                  <div className="columna-kanban__titulo">
                    <h3>{columna.nombre}</h3>
                    <span className="columna-kanban__contador cifra">{tareasColumna.length}</span>
                  </div>
                )}
                <button
                  type="button"
                  className="boton-icono columna-kanban__plegar"
                  aria-expanded={!compacta}
                  aria-label={`${
                    compacta ? t("columns.expand") : t("columns.collapse")
                  } ${columna.nombre}`}
                  onClick={() => onAlternarColumnaCompacta(columna.id)}
                >
                  <IconoChevron plegada={compacta} />
                </button>
                <button
                  type="button"
                  className="boton-icono"
                  ref={(elemento) => {
                    refsOpciones.current[columna.id] = elemento;
                  }}
                  aria-label={`${t("columns.options")} ${columna.nombre}`}
                  aria-haspopup="menu"
                  aria-expanded={menuVisible}
                  onClick={() => setMenuAbierto(menuVisible ? null : columna.id)}
                >
                  ⋯
                </button>
              </div>

              {menuVisible && (
                <div className="menu-columna" role="menu" aria-label={t("columns.options")}>
                  <button type="button" role="menuitem" onClick={() => empezarRenombrado(columna)}>
                    {t("columns.rename")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={indice === 0}
                    onClick={() => {
                      setMenuAbierto(null);
                      onMoverColumna(columna.id, columna.posicion - 1);
                    }}
                  >
                    {t("columns.moveLeft")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={indice === columnasOrdenadas.length - 1}
                    onClick={() => {
                      setMenuAbierto(null);
                      onMoverColumna(columna.id, columna.posicion + 1);
                    }}
                  >
                    {t("columns.moveRight")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuAbierto(null);
                      onEliminarColumna(columna.id);
                    }}
                  >
                    {t("columns.delete")}
                  </button>
                </div>
              )}

              <ColumnaSolt id={columna.id}>
                <SortableContext id={columna.id} items={tareasColumna.map((item) => item.id)}>
                  <ul className="columna-kanban__tareas">
                    {tareasColumna.length === 0 ? (
                      <li className="columna-kanban__vacia">{t("tasks.empty")}</li>
                    ) : (
                      tareasColumna.map((tarea) => (
                        <TarjetaArrastrable
                          key={tarea.id}
                          tarea={tarea}
                          proyectoId={proyectoId}
                          columnas={columnas}
                          etiquetas={etiquetas}
                          hecha={indice === columnasOrdenadas.length - 1}
                          compacta={compacta}
                          borrarTarea={borrarTarea}
                          moverTarea={moverTarea}
                          alternarElemento={alternarElemento}
                          abrirElemento={(elemento) =>
                            setElementoAbierto({ tareaId: tarea.id, elemento })
                          }
                        />
                      ))
                    )}
                  </ul>
                </SortableContext>
              </ColumnaSolt>

              {columnaAnadiendo === columna.id ? (
                <form
                  className="columna-kanban__anadir-form"
                  onSubmit={(evento) => {
                    evento.preventDefault();
                    confirmarNuevaTarjeta(columna.id);
                  }}
                  onKeyDown={(evento) => {
                    if (evento.key === "Escape") {
                      evento.preventDefault();
                      evento.stopPropagation();
                      cerrarAnadirTarjeta();
                    }
                  }}
                >
                  <input
                    aria-label={t("tasks.cardTitle")}
                    placeholder={t("tasks.cardTitle")}
                    autoFocus
                    value={tituloNuevaTarjeta}
                    onChange={(evento) => setTituloNuevaTarjeta(evento.target.value)}
                  />
                  <div className="acciones">
                    <button type="submit" className="boton-principal">
                      {t("tasks.create")}
                    </button>
                    <button type="button" className="boton-fantasma" onClick={cerrarAnadirTarjeta}>
                      {t("tasks.cancel")}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="columna-kanban__anadir boton-fantasma"
                  onClick={() => empezarAnadirTarjeta(columna.id)}
                >
                  <span className="columna-kanban__anadir-signo" aria-hidden="true">
                    +
                  </span>
                  {t("tasks.addCard")}
                </button>
              )}
            </section>
          );
        })}

        {creandoColumna ? (
          <form
            className="columna-agregar"
            onSubmit={(evento) => {
              evento.preventDefault();
              confirmarNuevaColumna();
            }}
          >
            <input
              aria-label={t("columns.name")}
              autoFocus
              value={nombreNuevaColumna}
              onChange={(evento) => setNombreNuevaColumna(evento.target.value)}
            />
            <button type="submit">{t("columns.create")}</button>
          </form>
        ) : (
          <button
            type="button"
            className="columna-agregar"
            onClick={() => setCreandoColumna(true)}
          >
            <span className="columna-agregar__signo" aria-hidden="true">
              +
            </span>
            {t("columns.create")}
          </button>
        )}
      </div>
      <DragOverlay>
        {activa ? (
          <div
            className={`tarjeta-kanban tarjeta-kanban--superpuesta${
              columnasCompactas.includes(activa.columnaId)
                ? " tarjeta-kanban--superpuesta-compacta"
                : ""
            }`}
          >
            {columnasCompactas.includes(activa.columnaId) ? (
              <span className="tarjeta-kanban__titulo-compacto">{activa.titulo}</span>
            ) : (
              activa.titulo
            )}
          </div>
        ) : null}
      </DragOverlay>

      {elementoAbierto && (
        <DialogoElementoChecklist
          key={elementoAbierto.elemento.id}
          tareaId={elementoAbierto.tareaId}
          proyectoId={proyectoId}
          elemento={{
            id: elementoAbierto.elemento.id,
            texto: elementoAbierto.elemento.texto,
            hecho: elementoAbierto.elemento.hecho,
          }}
          onCerrar={() => setElementoAbierto(null)}
        />
      )}
    </DndContext>
  );
});

function IconoChevron({ plegada }: { plegada: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {plegada ? <path d="M6 9l6 6 6-6" /> : <path d="M18 15l-6-6-6 6" />}
    </svg>
  );
}

function ColumnaSolt({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className="columna-kanban__lista">
      {children}
    </div>
  );
}
