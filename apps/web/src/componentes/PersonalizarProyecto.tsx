import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { peticion, type AmbienteFondoApi, type FondoProyectoApi, type ProyectoApi } from "../api";
import { PALETA_PROYECTO } from "../colores";

/** Ambientes de fondo, en el orden de la maqueta. */
const AMBIENTES: AmbienteFondoApi[] = ["bosque", "noche", "coral", "pizarra", "ciruela"];

/** Colores lisos de fondo. */
const FONDOS_LISOS = [
  "#0d3b37",
  "#141a3a",
  "#5a1e2a",
  "#1f2933",
  "#3b1f4a",
  "#2f4bc4",
  "#2f8f62",
  "#c2611b",
] as const;

const FONDO_POR_DEFECTO: FondoProyectoApi = { tipo: "ambiente", ambiente: "bosque" };

/** Un fondo nulo equivale al ambiente por defecto de la API. */
function normalizarFondo(fondo: FondoProyectoApi | null | undefined): FondoProyectoApi {
  return fondo ?? FONDO_POR_DEFECTO;
}

/** Clave para comparar fondos (ambiente/color) por valor. */
function claveFondo(fondo: FondoProyectoApi | null | undefined): string {
  return JSON.stringify(normalizarFondo(fondo));
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

export interface PropiedadesPersonalizarProyecto {
  proyecto: ProyectoApi;
  abierto: boolean;
  onCerrar: () => void;
}

export function PersonalizarProyecto({
  proyecto,
  abierto,
  onCerrar,
}: PropiedadesPersonalizarProyecto) {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const refDialogo = useRef<HTMLDialogElement>(null);
  const refFocoAnterior = useRef<HTMLElement | null>(null);

  const [nombre, setNombre] = useState(proyecto.nombre);
  const [color, setColor] = useState<string | null>(proyecto.color ?? null);
  const [fondo, setFondo] = useState<FondoProyectoApi>(normalizarFondo(proyecto.fondo));
  const [error, setError] = useState<string | null>(null);

  // Al abrir, parte de los valores actuales del proyecto.
  useEffect(() => {
    if (!abierto) return;
    setNombre(proyecto.nombre);
    setColor(proyecto.color ?? null);
    setFondo(normalizarFondo(proyecto.fondo));
    setError(null);
    // Solo al abrir: no reajustar mientras se edita si la consulta se refresca.
  }, [abierto]);

  useEffect(() => {
    const dialogo = refDialogo.current;
    if (!dialogo) return;
    if (abierto) {
      refFocoAnterior.current = document.activeElement as HTMLElement | null;
      if (typeof dialogo.showModal === "function") {
        if (!dialogo.open) dialogo.showModal();
      } else {
        dialogo.setAttribute("open", "");
      }
      dialogo.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    } else {
      if (typeof dialogo.close === "function") {
        if (dialogo.open) dialogo.close();
      } else {
        dialogo.removeAttribute("open");
      }
      refFocoAnterior.current?.focus();
      refFocoAnterior.current = null;
    }
  }, [abierto]);

  const guardar = useMutation({
    mutationFn: async () => {
      const cambios: Record<string, unknown> = {};
      if (nombre.trim() !== proyecto.nombre) cambios.nombre = nombre.trim();
      if (color !== (proyecto.color ?? null)) cambios.color = color;
      if (claveFondo(fondo) !== claveFondo(proyecto.fondo)) cambios.fondo = fondo;
      if (Object.keys(cambios).length === 0) return;
      await peticion(`/proyectos/${proyecto.id}`, {
        method: "PATCH",
        body: JSON.stringify(cambios),
      });
    },
    onSuccess: async () => {
      setError(null);
      await cliente.invalidateQueries({ queryKey: ["proyecto", proyecto.id] });
      await cliente.invalidateQueries({ queryKey: ["proyectos"] });
      onCerrar();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  return (
    <dialog
      ref={refDialogo}
      className="dialogo-tarea dialogo-personalizar"
      aria-labelledby="titulo-dialogo-personalizar"
      onCancel={(evento) => {
        evento.preventDefault();
        onCerrar();
      }}
      onKeyDown={(evento) => {
        if (evento.key === "Escape") {
          evento.preventDefault();
          onCerrar();
        }
      }}
    >
      {abierto && (
        <div className="dialogo-tarea__cuerpo">
          <div className="dialogo-tarea__cabecera">
            <h2 id="titulo-dialogo-personalizar">{t("projects.personalize.title")}</h2>
            <button
              type="button"
              className="dialogo-tarea__cerrar"
              aria-label={t("tasks.closeDialog")}
              onClick={onCerrar}
            >
              <IconoCerrar />
            </button>
          </div>

          {error && <p className="error">{error}</p>}

          <form
            className="formulario"
            onSubmit={(evento) => {
              evento.preventDefault();
              void guardar.mutate();
            }}
          >
            <label>
              {t("projects.name")}
              <input
                type="text"
                value={nombre}
                minLength={1}
                maxLength={200}
                required
                onChange={(evento) => setNombre(evento.target.value)}
              />
            </label>

            <fieldset className="personalizar__grupo">
              <legend>{t("projects.personalize.color")}</legend>
              <div
                className="personalizar__muestras"
                role="group"
                aria-label={t("projects.personalize.color")}
              >
                <button
                  type="button"
                  className="personalizar__automatico"
                  aria-pressed={color === null}
                  onClick={() => setColor(null)}
                >
                  {t("projects.personalize.automatic")}
                </button>
                {PALETA_PROYECTO.map((tono) => (
                  <button
                    key={tono}
                    type="button"
                    className="personalizar__muestra"
                    style={{ backgroundColor: tono }}
                    aria-label={`${t("projects.personalize.color")} ${tono}`}
                    aria-pressed={color === tono}
                    onClick={() => setColor(tono)}
                  />
                ))}
                <input
                  type="color"
                  className="personalizar__color"
                  aria-label={t("projects.personalize.customColor")}
                  value={color ?? PALETA_PROYECTO[0]}
                  onChange={(evento) => setColor(evento.target.value.toLowerCase())}
                />
              </div>
            </fieldset>

            <fieldset className="personalizar__grupo">
              <legend>{t("projects.background")}</legend>
              <div
                className="personalizar__ambientes"
                role="group"
                aria-label={t("projects.background")}
              >
                {AMBIENTES.map((ambiente) => (
                  <button
                    key={ambiente}
                    type="button"
                    className="personalizar__ambiente"
                    aria-pressed={fondo.tipo === "ambiente" && fondo.ambiente === ambiente}
                    onClick={() => setFondo({ tipo: "ambiente", ambiente })}
                  >
                    <span
                      className={`personalizar__miniatura fondo-proyecto--${ambiente}`}
                      aria-hidden="true"
                    />
                    <span>{t(`projects.personalize.ambientes.${ambiente}`)}</span>
                  </button>
                ))}
              </div>
              <p className="personalizar__etiqueta">{t("projects.personalize.flatColors")}</p>
              <div
                className="personalizar__muestras"
                role="group"
                aria-label={t("projects.personalize.flatColors")}
              >
                {FONDOS_LISOS.map((tono) => (
                  <button
                    key={tono}
                    type="button"
                    className="personalizar__muestra"
                    style={{ backgroundColor: tono }}
                    aria-label={`${t("projects.personalize.flatColors")} ${tono}`}
                    aria-pressed={fondo.tipo === "color" && fondo.color.toLowerCase() === tono}
                    onClick={() => setFondo({ tipo: "color", color: tono })}
                  />
                ))}
                <input
                  type="color"
                  className="personalizar__color"
                  aria-label={t("projects.personalize.customFlat")}
                  value={fondo.tipo === "color" ? fondo.color : FONDOS_LISOS[0]}
                  onChange={(evento) =>
                    setFondo({ tipo: "color", color: evento.target.value.toLowerCase() })
                  }
                />
              </div>
            </fieldset>

            <fieldset className="personalizar__grupo" disabled>
              <legend>{t("projects.personalize.images")}</legend>
              <p className="personalizar__proximamente">{t("projects.personalize.comingSoon")}</p>
            </fieldset>

            <div className="acciones">
              <button type="button" onClick={onCerrar}>
                {t("tasks.cancel")}
              </button>
              <button type="submit" className="boton-principal" disabled={guardar.isPending}>
                {t("tasks.save")}
              </button>
            </div>
          </form>
        </div>
      )}
    </dialog>
  );
}
