import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { peticion, type ChecklistItemApi } from "../api";

export interface PropiedadesChecklist {
  tareaId: string;
  proyectoId: string;
}

export function Checklist({ tareaId, proyectoId }: PropiedadesChecklist) {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const [textoNuevo, setTextoNuevo] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [textoEdicion, setTextoEdicion] = useState("");
  const [ocultarHechos, setOcultarHechos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refNuevo = useRef<HTMLInputElement>(null);

  const elementos = useQuery({
    queryKey: ["checklist", tareaId],
    queryFn: () => peticion<ChecklistItemApi[]>(`/tareas/${tareaId}/checklist`),
    enabled: Boolean(tareaId),
  });

  const lista = useMemo(
    () => (elementos.data ?? []).slice().sort((a, b) => a.posicion - b.posicion),
    [elementos.data],
  );
  const hechos = lista.filter((elemento) => elemento.hecho).length;
  const total = lista.length;
  const visibles = ocultarHechos ? lista.filter((elemento) => !elemento.hecho) : lista;

  function invalidar() {
    void cliente.invalidateQueries({ queryKey: ["checklist", tareaId] });
    void cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
    void cliente.invalidateQueries({ queryKey: ["tarea", tareaId] });
  }

  const crear = useMutation({
    mutationFn: async (texto: string) =>
      peticion(`/tareas/${tareaId}/checklist`, {
        method: "POST",
        body: JSON.stringify({ texto }),
      }),
    onSuccess: invalidar,
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t("auth.error")),
  });

  const actualizar = useMutation({
    mutationFn: async ({
      id,
      cambios,
    }: {
      id: string;
      cambios: { texto?: string; hecho?: boolean; posicion?: number };
    }) => peticion(`/checklist/${id}`, { method: "PATCH", body: JSON.stringify(cambios) }),
    onSuccess: invalidar,
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t("auth.error")),
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => peticion(`/checklist/${id}`, { method: "DELETE" }),
    onSuccess: invalidar,
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t("auth.error")),
  });

  function anadir() {
    const texto = textoNuevo.trim();
    if (!texto) return;
    setError(null);
    crear.mutate(texto, {
      onSuccess: () => {
        setTextoNuevo("");
        // El campo sigue con el foco para encadenar elementos.
        refNuevo.current?.focus();
      },
    });
  }

  function empezarEdicion(elemento: ChecklistItemApi) {
    setEditandoId(elemento.id);
    setTextoEdicion(elemento.texto);
  }

  function confirmarEdicion(elemento: ChecklistItemApi) {
    const texto = textoEdicion.trim();
    if (!texto || texto === elemento.texto) {
      setEditandoId(null);
      return;
    }
    actualizar.mutate({ id: elemento.id, cambios: { texto } }, { onSuccess: () => setEditandoId(null) });
  }

  function mover(elemento: ChecklistItemApi, delta: number) {
    const indice = lista.findIndex((item) => item.id === elemento.id);
    const destino = indice + delta;
    if (indice === -1 || destino < 0 || destino >= lista.length) return;
    actualizar.mutate({ id: elemento.id, cambios: { posicion: destino } });
  }

  return (
    <section className="tarjeta-detalle__seccion">
      <div className="tarjeta-detalle__seccion-cabecera">
        <h3>{t("checklist.section")}</h3>
        {total > 0 && (
          <button
            type="button"
            className="boton-texto"
            aria-pressed={ocultarHechos}
            onClick={() => setOcultarHechos((valor) => !valor)}
          >
            {ocultarHechos ? t("checklist.showDone") : t("checklist.hideDone")}
          </button>
        )}
      </div>

      <div className="checklist__progreso">
        <div
          className="checklist__barra"
          role="progressbar"
          aria-label={t("checklist.progressLabel")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={hechos}
        >
          <span
            className="checklist__barra-relleno"
            style={{ width: `${total > 0 ? (hechos / total) * 100 : 0}%` }}
          />
        </div>
        <span className="checklist__contador mono">
          {t("checklist.progress", { hechos, total })}
        </span>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <ul className="checklist__lista">
        {visibles.length === 0 && (
          <li className="checklist__vacia">
            {total === 0 ? t("checklist.empty") : t("labels.none")}
          </li>
        )}
        {visibles.map((elemento) => {
          const indice = lista.findIndex((item) => item.id === elemento.id);
          return (
            <li key={elemento.id} className="checklist__item">
              <input
                type="checkbox"
                checked={elemento.hecho}
                aria-label={t("checklist.itemDone", { texto: elemento.texto })}
                onChange={() => actualizar.mutate({ id: elemento.id, cambios: { hecho: !elemento.hecho } })}
              />

              {editandoId === elemento.id ? (
                <input
                  className="checklist__texto"
                  aria-label={t("checklist.item")}
                  autoFocus
                  value={textoEdicion}
                  onChange={(evento) => setTextoEdicion(evento.target.value)}
                  onKeyDown={(evento) => {
                    if (evento.key === "Enter") {
                      evento.preventDefault();
                      confirmarEdicion(elemento);
                    } else if (evento.key === "Escape") {
                      evento.preventDefault();
                      setEditandoId(null);
                    }
                  }}
                  onBlur={() => confirmarEdicion(elemento)}
                />
              ) : (
                <button
                  type="button"
                  className={`checklist__texto-boton${elemento.hecho ? " checklist__texto-boton--hecho" : ""}`}
                  onClick={() => empezarEdicion(elemento)}
                >
                  {elemento.texto}
                </button>
              )}

              <button
                type="button"
                className="checklist__accion"
                aria-label={t("checklist.up", { texto: elemento.texto })}
                disabled={indice <= 0}
                onClick={() => mover(elemento, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="checklist__accion"
                aria-label={t("checklist.down", { texto: elemento.texto })}
                disabled={indice === lista.length - 1}
                onClick={() => mover(elemento, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="checklist__accion"
                aria-label={t("checklist.delete", { texto: elemento.texto })}
                onClick={() => borrar.mutate(elemento.id)}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      <form
        className="checklist__anadir"
        onSubmit={(evento) => {
          evento.preventDefault();
          anadir();
        }}
      >
        <input
          ref={refNuevo}
          aria-label={t("checklist.add")}
          placeholder={t("checklist.add")}
          value={textoNuevo}
          onChange={(evento) => setTextoNuevo(evento.target.value)}
        />
        <button type="submit" disabled={!textoNuevo.trim() || crear.isPending}>
          {t("checklist.addButton")}
        </button>
      </form>
    </section>
  );
}
