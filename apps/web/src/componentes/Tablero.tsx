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

import { peticion, type ColumnaApi, type TareaApi } from "../api";
import { chipFecha } from "../fechas";
import {
  aIsoUtc,
  aValorLocal,
  analizarRegla,
  construirRegla,
  zonaNavegador,
} from "../recurrencia-web";
import { moverTareaEnLista } from "../tablero-utils";
import { CamposTarea, type ValoresFormularioTarea } from "./CamposTarea";

export interface PropiedadesTablero {
  proyectoId: string;
  columnas: ColumnaApi[];
  tareas: TareaApi[];
  onCrearColumna(nombre: string): void;
  onRenombrarColumna(columnaId: string, nombre: string): void;
  onMoverColumna(columnaId: string, posicion: number): void;
  onEliminarColumna(columnaId: string): void;
}

export interface ControlTablero {
  gestionarFinArrastre(event: DragEndEvent): Promise<void>;
}

interface TarjetaProps {
  tarea: TareaApi;
  columnas: ColumnaApi[];
  borrarTarea(tareaId: string): Promise<void>;
  moverTarea(tareaId: string, columnaId: string): Promise<void>;
  editarTarea(tareaId: string, valores: ValoresFormularioTarea): Promise<void>;
  moverLabel: string;
  eliminarLabel: string;
}

function IconoCampana({ etiqueta }: { etiqueta: string }) {
  return (
    <svg
      className="tarjeta-kanban__icono"
      role="img"
      aria-label={etiqueta}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

function IconoRepeticion({ etiqueta }: { etiqueta: string }) {
  return (
    <svg
      className="tarjeta-kanban__icono"
      role="img"
      aria-label={etiqueta}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function TarjetaArrastrable({
  tarea,
  columnas,
  borrarTarea,
  moverTarea,
  editarTarea,
  moverLabel,
  eliminarLabel,
}: TarjetaProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tarea.id,
    data: { titulo: tarea.titulo },
  });
  const [editando, setEditando] = useState(false);
  const [valores, setValores] = useState<ValoresFormularioTarea>({
    titulo: tarea.titulo,
    descripcion: tarea.descripcion ?? "",
    venceEnLocal: aValorLocal(tarea.venceEn),
    recurrencia: analizarRegla(tarea.recurrencia),
    recordatorioMin: tarea.recordatorioMin ?? null,
  });

  const estilo = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function abrirEdicion() {
    setValores({
      titulo: tarea.titulo,
      descripcion: tarea.descripcion ?? "",
      venceEnLocal: aValorLocal(tarea.venceEn),
      recurrencia: analizarRegla(tarea.recurrencia),
      recordatorioMin: tarea.recordatorioMin ?? null,
    });
    setEditando(true);
  }

  const chip = chipFecha(tarea.venceEn);
  const tieneAviso = tarea.recordatorioMin !== null && tarea.recordatorioMin !== undefined;
  const tieneRecurrencia = Boolean(tarea.recurrencia);

  return (
    <li
      ref={setNodeRef}
      className={`tarjeta-kanban ${isDragging ? "tarjeta-kanban--arrastrando" : ""}`}
      style={estilo}
    >
      <div className="tarjeta-kanban__encabezado">
        <button
          type="button"
          className="tarjeta-kanban__asa"
          aria-label={t("tasks.drag")}
          {...attributes}
          {...listeners}
        >
          ≡
        </button>
        <span className="tarjeta-kanban__titulo">{tarea.titulo}</span>
      </div>

      {(chip || tieneAviso || tieneRecurrencia) && (
        <div className="tarjeta-kanban__meta">
          {chip && <span className={`chip-fecha chip-fecha--${chip.estado} mono`}>{chip.texto}</span>}
          {tieneAviso && <IconoCampana etiqueta={t("tasks.hasReminder")} />}
          {tieneRecurrencia && <IconoRepeticion etiqueta={t("tasks.repeats")} />}
        </div>
      )}

      {editando ? (
        <form
          className="tarjeta-kanban__edicion"
          onSubmit={(evento) => {
            evento.preventDefault();
            void editarTarea(tarea.id, valores).then(() => setEditando(false));
          }}
        >
          <CamposTarea valores={valores} onCambio={setValores} />
          <div className="acciones">
            <button type="submit">{t("tasks.save")}</button>
            <button type="button" onClick={() => setEditando(false)}>
              {t("tasks.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="acciones">
          <button type="button" onClick={abrirEdicion}>
            {t("tasks.edit")}
          </button>
          <label className="tarjeta-kanban__mover">
            {moverLabel}
            <select
              value={tarea.columnaId}
              onChange={(evento) => void moverTarea(tarea.id, evento.target.value)}
            >
              {columnas.map((columna) => (
                <option key={columna.id} value={columna.id}>
                  {columna.nombre}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void borrarTarea(tarea.id)}>
            {eliminarLabel}
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
    onCrearColumna,
    onRenombrarColumna,
    onMoverColumna,
    onEliminarColumna,
  },
  ref,
) {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const queryKey = ["tareas", proyectoId];
  const [activa, setActiva] = useState<TareaApi | null>(null);
  const [menuAbierto, setMenuAbierto] = useState<string | null>(null);
  const [columnaRenombrando, setColumnaRenombrando] = useState<string | null>(null);
  const [nombreRenombrado, setNombreRenombrado] = useState("");
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

  async function editarTarea(tareaId: string, valores: ValoresFormularioTarea) {
    const venceEn = aIsoUtc(valores.venceEnLocal);
    const recurrencia = venceEn ? construirRegla(valores.recurrencia) : null;

    await peticion(`/tareas/${tareaId}`, {
      method: "PATCH",
      body: JSON.stringify({
        titulo: valores.titulo,
        descripcion: valores.descripcion,
        venceEn,
        recurrencia,
        zona: zonaNavegador(),
        recordatorioMin: venceEn ? valores.recordatorioMin : null,
      }),
    });
    await cliente.invalidateQueries({ queryKey });
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
          return (
            <section
              key={columna.id}
              className="columna-kanban"
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
                    <span className="columna-kanban__contador mono">{tareasColumna.length}</span>
                  </div>
                )}
                <button
                  type="button"
                  className="columna-kanban__opciones"
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
                          columnas={columnas}
                          borrarTarea={borrarTarea}
                          moverTarea={moverTarea}
                          editarTarea={editarTarea}
                          moverLabel={t("tasks.moveTo")}
                          eliminarLabel={t("tasks.delete")}
                        />
                      ))
                    )}
                  </ul>
                </SortableContext>
              </ColumnaSolt>
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
            {t("columns.add")}
          </button>
        )}
      </div>
      <DragOverlay>
        {activa ? (
          <div className="tarjeta-kanban tarjeta-kanban--superpuesta">{activa.titulo}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});

function ColumnaSolt({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef}>{children}</div>;
}
