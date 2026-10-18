import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { peticion, type EtiquetaApi } from "../api";

/** Paleta fija de etiquetas (coincide con `COLORES_ETIQUETA` de shared). */
export const COLORES_ETIQUETA = [
  "#6E4FE6",
  "#C8303A",
  "#2563D9",
  "#18794E",
  "#B4530A",
  "#0E7490",
  "#A21CAF",
  "#4B5563",
] as const;

const VARIABLE_POR_COLOR: Record<string, string> = {
  "#6E4FE6": "--etiqueta-violeta",
  "#C8303A": "--etiqueta-rojo",
  "#2563D9": "--etiqueta-azul",
  "#18794E": "--etiqueta-verde",
  "#B4530A": "--etiqueta-naranja",
  "#0E7490": "--etiqueta-turquesa",
  "#A21CAF": "--etiqueta-magenta",
  "#4B5563": "--etiqueta-gris",
};

const NOMBRE_POR_COLOR: Record<string, string> = {
  "#6E4FE6": "violeta",
  "#C8303A": "rojo",
  "#2563D9": "azul",
  "#18794E": "verde",
  "#B4530A": "naranja",
  "#0E7490": "turquesa",
  "#A21CAF": "magenta",
  "#4B5563": "gris",
};

export function nombreColor(color: string): string {
  return NOMBRE_POR_COLOR[color.toUpperCase()] ?? "gris";
}

/** Pastilla tintada con el color de la etiqueta: el color nunca es la única información. */
export function PastillaEtiqueta({ etiqueta }: { etiqueta: Pick<EtiquetaApi, "nombre" | "color"> }) {
  const variable = VARIABLE_POR_COLOR[etiqueta.color.toUpperCase()] ?? "--etiqueta-gris";
  return (
    <span
      className="etiqueta"
      style={{ "--color-etiqueta": `var(${variable})` } as CSSProperties}
    >
      {etiqueta.nombre}
    </span>
  );
}

function PaletaColor({
  valor,
  onCambio,
  etiqueta,
}: {
  valor: string;
  onCambio(color: string): void;
  etiqueta: string;
}) {
  const { t } = useTranslation();
  const grupo = useRef(`paleta-${Math.random().toString(36).slice(2)}`);
  const normalizado = valor.toUpperCase();

  return (
    <div className="paleta-color" role="radiogroup" aria-label={etiqueta}>
      {COLORES_ETIQUETA.map((color) => (
        <label
          key={color}
          className="paleta-color__opcion"
          style={{ background: `var(${VARIABLE_POR_COLOR[color]})` }}
        >
          <input
            type="radio"
            name={grupo.current}
            checked={normalizado === color}
            onChange={() => onCambio(color)}
            aria-label={t(`labels.colors.${nombreColor(color)}`)}
          />
        </label>
      ))}
    </div>
  );
}

export interface PropiedadesSelectorEtiquetas {
  tareaId: string;
  proyectoId: string;
  /** Ids de las etiquetas asignadas a la tarea. */
  asignadas: string[];
}

export function SelectorEtiquetas({ tareaId, proyectoId, asignadas }: PropiedadesSelectorEtiquetas) {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [nombreNueva, setNombreNueva] = useState("");
  const [colorNueva, setColorNueva] = useState<string>(COLORES_ETIQUETA[0]);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEdicion, setNombreEdicion] = useState("");
  const [colorEdicion, setColorEdicion] = useState<string>(COLORES_ETIQUETA[0]);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refBoton = useRef<HTMLButtonElement>(null);
  const refPanel = useRef<HTMLDivElement>(null);
  const refBuscador = useRef<HTMLInputElement>(null);
  const refNombreNueva = useRef<HTMLInputElement>(null);

  const etiquetas = useQuery({
    queryKey: ["etiquetas", proyectoId],
    queryFn: () => peticion<EtiquetaApi[]>(`/proyectos/${proyectoId}/etiquetas`),
    enabled: Boolean(proyectoId),
  });

  const lista = etiquetas.data ?? [];

  useEffect(() => {
    if (abierto) {
      refBuscador.current?.focus();
    }
  }, [abierto]);

  function invalidar() {
    void cliente.invalidateQueries({ queryKey: ["etiquetas", proyectoId] });
    void cliente.invalidateQueries({ queryKey: ["tarea", tareaId] });
    void cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
  }

  const asignar = useMutation({
    mutationFn: async (ids: string[]) =>
      peticion(`/tareas/${tareaId}/etiquetas`, {
        method: "PUT",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: invalidar,
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t("auth.error")),
  });

  const crear = useMutation({
    mutationFn: async (nombre: string) =>
      peticion<EtiquetaApi>(`/proyectos/${proyectoId}/etiquetas`, {
        method: "POST",
        body: JSON.stringify({ nombre, color: colorNueva }),
      }),
    onSuccess: () => {
      setError(null);
      setNombreNueva("");
      setBusqueda("");
      invalidar();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t("auth.error")),
  });

  const actualizar = useMutation({
    mutationFn: async ({ id, cambios }: { id: string; cambios: { nombre?: string; color?: string } }) =>
      peticion(`/etiquetas/${id}`, { method: "PATCH", body: JSON.stringify(cambios) }),
    onSuccess: () => {
      setError(null);
      setEditandoId(null);
      invalidar();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t("auth.error")),
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => peticion(`/etiquetas/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setError(null);
      setConfirmandoId(null);
      invalidar();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t("auth.error")),
  });

  const busquedaNormalizada = busqueda.trim().toLowerCase();
  const filtradas = useMemo(
    () => lista.filter((etiqueta) => etiqueta.nombre.toLowerCase().includes(busquedaNormalizada)),
    [lista, busquedaNormalizada],
  );
  const existeExacta = lista.some(
    (etiqueta) => etiqueta.nombre.trim().toLowerCase() === busquedaNormalizada,
  );
  const ofrecerCrear = busquedaNormalizada.length > 0 && !existeExacta;

  const asignadasOrdenadas = lista.filter((etiqueta) => asignadas.includes(etiqueta.id));

  function cerrar() {
    setAbierto(false);
    setBusqueda("");
    setEditandoId(null);
    setConfirmandoId(null);
    setError(null);
    refBoton.current?.focus();
  }

  function alternar(etiquetaId: string, marcada: boolean) {
    const conjunto = marcada
      ? [...new Set([...asignadas, etiquetaId])]
      : asignadas.filter((id) => id !== etiquetaId);
    asignar.mutate(conjunto);
  }

  function empezarEdicion(etiqueta: EtiquetaApi) {
    setEditandoId(etiqueta.id);
    setNombreEdicion(etiqueta.nombre);
    setColorEdicion(etiqueta.color.toUpperCase());
    setConfirmandoId(null);
  }

  function confirmarEdicion(etiqueta: EtiquetaApi) {
    const nombre = nombreEdicion.trim();
    if (!nombre) {
      setEditandoId(null);
      return;
    }
    const cambios: { nombre?: string; color?: string } = {};
    if (nombre !== etiqueta.nombre) cambios.nombre = nombre;
    if (colorEdicion.toUpperCase() !== etiqueta.color.toUpperCase()) cambios.color = colorEdicion;
    if (Object.keys(cambios).length === 0) {
      setEditandoId(null);
      return;
    }
    actualizar.mutate({ id: etiqueta.id, cambios });
  }

  function confirmarNueva() {
    const nombre = nombreNueva.trim();
    if (!nombre) return;
    crear.mutate(nombre);
  }

  return (
    <section className="tarjeta-detalle__seccion">
      <div className="tarjeta-detalle__seccion-cabecera">
        <h3>{t("labels.section")}</h3>
        <button
          type="button"
          ref={refBoton}
          className="boton-texto"
          aria-haspopup="dialog"
          aria-expanded={abierto}
          onClick={() => (abierto ? cerrar() : setAbierto(true))}
        >
          {t("labels.button")}
        </button>
      </div>

      <div className="selector-etiquetas__asignadas" aria-label={t("labels.assigned")}>
        {asignadasOrdenadas.length === 0 ? (
          <span className="selector-etiquetas__vacia">{t("labels.none")}</span>
        ) : (
          asignadasOrdenadas.map((etiqueta) => (
            <PastillaEtiqueta key={etiqueta.id} etiqueta={etiqueta} />
          ))
        )}
      </div>

      {abierto && (
        <div
          ref={refPanel}
          className="selector-etiquetas"
          role="dialog"
          aria-label={t("labels.section")}
          onKeyDown={(evento) => {
            if (evento.key === "Escape") {
              evento.preventDefault();
              evento.stopPropagation();
              cerrar();
            }
          }}
        >
          <input
            type="search"
            ref={refBuscador}
            className="selector-etiquetas__busqueda"
            aria-label={t("labels.search")}
            placeholder={t("labels.search")}
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
          />

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {ofrecerCrear && (
            <button
              type="button"
              className="selector-etiquetas__sugerencia"
              onClick={() => {
                setNombreNueva(busqueda.trim());
                refNombreNueva.current?.focus();
              }}
            >
              {t("labels.createOffer", { nombre: busqueda.trim() })}
            </button>
          )}

          <ul className="selector-etiquetas__lista">
            {filtradas.length === 0 && (
              <li className="selector-etiquetas__vacia">
                {lista.length === 0 ? t("labels.empty") : t("labels.noResults")}
              </li>
            )}
            {filtradas.map((etiqueta) => (
              <li key={etiqueta.id} className="selector-etiquetas__fila">
                {editandoId === etiqueta.id ? (
                  <form
                    className="selector-etiquetas__edicion"
                    onSubmit={(evento) => {
                      evento.preventDefault();
                      confirmarEdicion(etiqueta);
                    }}
                  >
                    <input
                      aria-label={t("labels.editName")}
                      value={nombreEdicion}
                      onChange={(evento) => setNombreEdicion(evento.target.value)}
                    />
                    <PaletaColor
                      valor={colorEdicion}
                      onCambio={setColorEdicion}
                      etiqueta={t("labels.color")}
                    />
                    <button type="submit" disabled={actualizar.isPending}>
                      {t("labels.save")}
                    </button>
                    <button type="button" onClick={() => setEditandoId(null)}>
                      {t("labels.cancel")}
                    </button>
                  </form>
                ) : (
                  <>
                    <label className="selector-etiquetas__opcion">
                      <input
                        type="checkbox"
                        checked={asignadas.includes(etiqueta.id)}
                        onChange={(evento) => alternar(etiqueta.id, evento.target.checked)}
                      />
                      <PastillaEtiqueta etiqueta={etiqueta} />
                    </label>
                    <button
                      type="button"
                      className="selector-etiquetas__accion"
                      aria-label={`${t("labels.edit")}: ${etiqueta.nombre}`}
                      onClick={() => empezarEdicion(etiqueta)}
                    >
                      {t("labels.editShort")}
                    </button>
                    {confirmandoId === etiqueta.id ? (
                      <span className="selector-etiquetas__confirmar">
                        <span>{t("labels.confirmDelete", { nombre: etiqueta.nombre })}</span>
                        <button
                          type="button"
                          className="selector-etiquetas__accion--peligro"
                          onClick={() => borrar.mutate(etiqueta.id)}
                        >
                          {t("labels.deleteYes")}
                        </button>
                        <button
                          type="button"
                          className="selector-etiquetas__accion"
                          onClick={() => setConfirmandoId(null)}
                        >
                          {t("labels.cancel")}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="selector-etiquetas__accion"
                        aria-label={`${t("labels.delete")}: ${etiqueta.nombre}`}
                        onClick={() => setConfirmandoId(etiqueta.id)}
                      >
                        ✕
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>

          <form
            className="selector-etiquetas__nueva"
            onSubmit={(evento) => {
              evento.preventDefault();
              confirmarNueva();
            }}
          >
            <input
              ref={refNombreNueva}
              aria-label={t("labels.newName")}
              placeholder={t("labels.newName")}
              value={nombreNueva}
              onChange={(evento) => setNombreNueva(evento.target.value)}
            />
            <PaletaColor valor={colorNueva} onCambio={setColorNueva} etiqueta={t("labels.color")} />
            <button type="submit" disabled={!nombreNueva.trim() || crear.isPending}>
              {t("labels.create")}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
