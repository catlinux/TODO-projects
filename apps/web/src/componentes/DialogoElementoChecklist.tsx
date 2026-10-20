import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { peticion, type ChecklistItemApi } from "../api";

export interface ElementoDialogoChecklist {
  id: string;
  texto: string;
  hecho: boolean;
}

export interface PropiedadesDialogoElementoChecklist {
  tareaId: string;
  proyectoId: string;
  elemento: ElementoDialogoChecklist;
  onCerrar: () => void;
}

/** Diálogo con el texto completo del elemento y su descripción editable. */
export function DialogoElementoChecklist({
  tareaId,
  proyectoId,
  elemento,
  onCerrar,
}: PropiedadesDialogoElementoChecklist) {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const refDialogo = useRef<HTMLDialogElement>(null);
  const refTexto = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState(elemento.texto);
  const [descripcion, setDescripcion] = useState("");
  const [cargado, setCargado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const elementos = useQuery({
    queryKey: ["checklist", tareaId],
    queryFn: () => peticion<ChecklistItemApi[]>(`/tareas/${tareaId}/checklist`),
    enabled: Boolean(tareaId),
  });

  const detalle = elementos.data?.find((item) => item.id === elemento.id);

  useEffect(() => {
    if (!detalle || cargado === detalle.id) return;
    setTexto(detalle.texto);
    setDescripcion(detalle.descripcion ?? "");
    setCargado(detalle.id);
  }, [detalle, cargado]);

  useEffect(() => {
    const dialogo = refDialogo.current;
    const anterior = document.activeElement as HTMLElement | null;
    if (!dialogo) return;
    if (typeof dialogo.showModal === "function") {
      if (!dialogo.open) dialogo.showModal();
    } else {
      dialogo.setAttribute("open", "");
    }
    refTexto.current?.focus();

    return () => {
      if (typeof dialogo.close === "function") {
        if (dialogo.open) dialogo.close();
      } else {
        dialogo.removeAttribute("open");
      }
      anterior?.focus();
    };
  }, []);

  function invalidar() {
    void cliente.invalidateQueries({ queryKey: ["checklist", tareaId] });
    void cliente.invalidateQueries({ queryKey: ["tarea", tareaId] });
    void cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
  }

  const guardar = useMutation({
    mutationFn: async () => {
      const limpia = descripcion.trim();
      await peticion(`/checklist/${elemento.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          texto: texto.trim(),
          descripcion: limpia === "" ? null : limpia,
        }),
      });
    },
    onSuccess: async () => {
      invalidar();
      onCerrar();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t("checklist.saveError")),
  });

  function cerrar() {
    if (!guardar.isPending) onCerrar();
  }

  const mensajeError = error ?? (elementos.isError ? t("checklist.loadError") : null);

  return (
    <dialog
      ref={refDialogo}
      className="dialogo dialogo-checklist"
      aria-labelledby="titulo-dialogo-checklist"
      onCancel={(evento) => {
        evento.preventDefault();
        cerrar();
      }}
      onKeyDown={(evento) => {
        if (evento.key === "Escape") {
          evento.preventDefault();
          evento.stopPropagation();
          cerrar();
        }
      }}
      onClick={(evento) => {
        // El clic en el velo llega al propio diálogo, no a su contenido.
        if (evento.target === evento.currentTarget) cerrar();
      }}
    >
      <form
        className="dialogo__cuerpo"
        onSubmit={(evento) => {
          evento.preventDefault();
          if (!texto.trim() || !cargado || guardar.isPending) return;
          setError(null);
          guardar.mutate();
        }}
      >
        <div className="dialogo__cabecera">
          <h2 id="titulo-dialogo-checklist">{t("checklist.dialogTitle")}</h2>
          <span
            className={`dialogo-checklist__estado${
              elemento.hecho ? " dialogo-checklist__estado--hecho" : ""
            }`}
          >
            {elemento.hecho ? t("checklist.done") : t("checklist.pending")}
          </span>
        </div>

        <label className="dialogo-checklist__campo">
          <span>{t("checklist.item")}</span>
          <input
            ref={refTexto}
            value={texto}
            maxLength={500}
            onChange={(evento) => setTexto(evento.target.value)}
          />
        </label>

        <label className="dialogo-checklist__campo">
          <span>{t("checklist.description")}</span>
          <textarea
            rows={7}
            value={descripcion}
            maxLength={5000}
            placeholder={t("checklist.descriptionPlaceholder")}
            onChange={(evento) => setDescripcion(evento.target.value)}
          />
        </label>

        {mensajeError && (
          <p className="error" role="alert">
            {mensajeError}
          </p>
        )}

        <div className="dialogo__pie">
          <button type="button" className="boton-fantasma" onClick={cerrar}>
            {t("checklist.cancel")}
          </button>
          <button
            type="submit"
            className="boton-principal"
            disabled={!texto.trim() || !cargado || guardar.isPending}
          >
            {t("checklist.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
