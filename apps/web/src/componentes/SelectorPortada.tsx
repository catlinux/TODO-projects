import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { peticion, type PortadaTareaApi } from "../api";
import { COLORES_PORTADA, PATRONES_PORTADA, estiloPortada } from "../portada";
import { nombreColor } from "./SelectorEtiquetas";

export interface PropiedadesSelectorPortada {
  tareaId: string;
  proyectoId: string;
  portada?: PortadaTareaApi | null;
}

export function SelectorPortada({
  tareaId,
  proyectoId,
  portada = null,
}: PropiedadesSelectorPortada) {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refBoton = useRef<HTMLButtonElement>(null);

  // La de imagen se ignora hasta la fase E: aquí solo cuenta el color/patrón.
  const valorActual = portada?.tipo === "color" ? portada.valor : null;

  const opciones = [
    ...COLORES_PORTADA.map((color) => ({
      valor: color as string,
      nombre: t(`labels.colors.${nombreColor(color)}`),
    })),
    ...PATRONES_PORTADA.map((patron) => ({
      valor: patron as string,
      nombre: t(`cover.patterns.${patron}`),
    })),
  ];

  const nombreActual = opciones.find((opcion) => opcion.valor === valorActual)?.nombre;

  function invalidar() {
    void cliente.invalidateQueries({ queryKey: ["tarea", tareaId] });
    void cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
    void cliente.invalidateQueries({ queryKey: ["actividad", tareaId] });
  }

  const guardar = useMutation({
    mutationFn: async (nueva: PortadaTareaApi | null) =>
      peticion(`/tareas/${tareaId}`, {
        method: "PATCH",
        body: JSON.stringify({ portada: nueva }),
      }),
    onSuccess: () => {
      setError(null);
      setAbierto(false);
      refBoton.current?.focus();
      invalidar();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t("auth.error")),
  });

  function cerrar() {
    setAbierto(false);
    setError(null);
    refBoton.current?.focus();
  }

  return (
    <section className="tarjeta-detalle__seccion">
      <div className="tarjeta-detalle__seccion-cabecera">
        <h3>{t("cover.section")}</h3>
        <button
          type="button"
          ref={refBoton}
          className="boton-texto"
          aria-haspopup="dialog"
          aria-expanded={abierto}
          onClick={() => (abierto ? cerrar() : setAbierto(true))}
        >
          {t("cover.button")}
        </button>
      </div>

      {abierto && (
        <div
          className="selector-portada"
          role="dialog"
          aria-label={t("cover.section")}
          onKeyDown={(evento) => {
            if (evento.key === "Escape") {
              evento.preventDefault();
              evento.stopPropagation();
              cerrar();
            }
          }}
        >
          <p className="selector-portada__actual">
            {nombreActual ? `${t("cover.section")}: ${nombreActual}` : t("cover.none")}
          </p>

          <div className="selector-portada__muestras" role="radiogroup" aria-label={t("cover.choose")}>
            {opciones.map((opcion) => {
              const seleccionada = opcion.valor === valorActual;
              return (
                <button
                  key={opcion.valor}
                  type="button"
                  role="radio"
                  aria-checked={seleccionada}
                  aria-label={opcion.nombre}
                  className="selector-portada__muestra"
                  style={estiloPortada({ tipo: "color", valor: opcion.valor }) ?? undefined}
                  disabled={guardar.isPending}
                  onClick={() => guardar.mutate({ tipo: "color", valor: opcion.valor })}
                >
                  {seleccionada && <span aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>

          <div className="selector-portada__acciones">
            <button
              type="button"
              className="boton-texto"
              disabled={!portada || guardar.isPending}
              onClick={() => guardar.mutate(null)}
            >
              {t("cover.remove")}
            </button>
          </div>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
