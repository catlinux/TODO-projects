import { useEffect, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  ErrorHttp,
  peticion,
  subirArchivo,
  type AmbienteFondoApi,
  type ArchivoApi,
  type FondoProyectoApi,
  type ProyectoApi,
} from "../api";
import { PALETA_PROYECTO } from "../colores";
import { urlArchivo } from "../portada";
import { MAX_BYTES } from "./Adjuntos";

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

/** Límites de la API para los fondos del proyecto. */
const MAX_IMAGENES = 10;
const INTERVALO_MIN = 10;
const INTERVALO_MAX = 600;
const INTERVALO_POR_DEFECTO = 30;

/** Segundos válidos a partir del campo de texto, o `null` si no lo son. */
function leerIntervalo(valor: string): number | null {
  const segundos = Number(valor);
  return Number.isInteger(segundos) && segundos >= INTERVALO_MIN && segundos <= INTERVALO_MAX
    ? segundos
    : null;
}

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
  const refEntradaImagenes = useRef<HTMLInputElement>(null);

  const [nombre, setNombre] = useState(proyecto.nombre);
  const [color, setColor] = useState<string | null>(proyecto.color ?? null);
  const [fondo, setFondo] = useState<FondoProyectoApi>(normalizarFondo(proyecto.fondo));
  const [error, setError] = useState<string | null>(null);
  const [orden, setOrden] = useState<string[]>([]);
  const [intervalo, setIntervalo] = useState(String(INTERVALO_POR_DEFECTO));
  const [arrastrando, setArrastrando] = useState(false);

  const fondos = useQuery({
    queryKey: ["fondos", proyecto.id],
    queryFn: () => peticion<ArchivoApi[]>(`/proyectos/${proyecto.id}/fondos`),
    enabled: abierto,
  });
  const listaFondos = Array.isArray(fondos.data) ? fondos.data : [];
  const porId = new Map(listaFondos.map((archivo) => [archivo.id, archivo]));
  const imagenesOrdenadas = orden
    .map((id) => ({ id, archivo: porId.get(id) }))
    .filter((item): item is { id: string; archivo: ArchivoApi } => item.archivo !== undefined);

  // Al abrir, parte de los valores actuales del proyecto.
  useEffect(() => {
    if (!abierto) return;
    const fondoActual = normalizarFondo(proyecto.fondo);
    setNombre(proyecto.nombre);
    setColor(proyecto.color ?? null);
    setFondo(fondoActual);
    setOrden(fondoActual.tipo === "imagenes" ? fondoActual.ids : []);
    setIntervalo(
      fondoActual.tipo === "imagenes"
        ? String(fondoActual.intervaloSeg)
        : String(INTERVALO_POR_DEFECTO),
    );
    setError(null);
    // Solo al abrir: no reajustar mientras se edita si la consulta se refresca.
  }, [abierto]);

  // La lista de la API manda: descarta ids que ya no existen y añade los nuevos.
  useEffect(() => {
    if (!abierto || !Array.isArray(fondos.data)) return;
    const datos = fondos.data;
    setOrden((actual) => {
      const disponibles = new Set(datos.map((archivo) => archivo.id));
      const conservados = actual.filter((id) => disponibles.delete(id));
      const siguiente = [...conservados, ...disponibles];
      return siguiente.length === actual.length && siguiente.every((id, i) => id === actual[i])
        ? actual
        : siguiente;
    });
  }, [abierto, fondos.data]);

  /** Si una imagen usada desaparece, el servidor limpia la referencia. */
  function invalidarTrasBorrar(id: string) {
    void cliente.invalidateQueries({ queryKey: ["fondos", proyecto.id] });
    void cliente.invalidateQueries({ queryKey: ["proyecto", proyecto.id] });
    void cliente.invalidateQueries({ queryKey: ["proyectos"] });
    setOrden((actual) => actual.filter((imagenId) => imagenId !== id));
    setFondo((actual) =>
      actual.tipo === "imagenes"
        ? { ...actual, ids: actual.ids.filter((imagenId) => imagenId !== id) }
        : actual,
    );
  }

  function mensajeError(err: unknown): string {
    if (err instanceof ErrorHttp && err.status === 413) {
      return t("projects.personalize.imageTooLarge");
    }
    return err instanceof Error ? err.message : t("auth.error");
  }

  const subir = useMutation({
    mutationFn: async (ficheros: File[]) => {
      // De una en una: cada subida es una petición multipart.
      for (const fichero of ficheros) {
        const creado = await subirArchivo<ArchivoApi>(
          `/proyectos/${proyecto.id}/fondos`,
          "archivo",
          fichero,
        );
        setOrden((actual) => (actual.includes(creado.id) ? actual : [...actual, creado.id]));
      }
    },
    onSuccess: () => {
      setError(null);
      void cliente.invalidateQueries({ queryKey: ["fondos", proyecto.id] });
    },
    onError: (err: unknown) => {
      setError(mensajeError(err));
      void cliente.invalidateQueries({ queryKey: ["fondos", proyecto.id] });
    },
  });

  const quitar = useMutation({
    mutationFn: async (id: string) => peticion(`/archivos/${id}`, { method: "DELETE" }),
    onSuccess: (_datos, id) => {
      setError(null);
      invalidarTrasBorrar(id);
    },
    onError: (err: unknown) => setError(mensajeError(err)),
  });

  function subirFicheros(ficheros: FileList | File[] | null) {
    if (!ficheros) return;
    const seleccion = Array.from(ficheros);
    if (seleccion.length === 0) return;

    const libres = MAX_IMAGENES - orden.length;
    if (libres <= 0) {
      setError(t("projects.personalize.imagesMaxReached"));
      return;
    }
    if (seleccion.length > libres) {
      setError(t("projects.personalize.imagesMaxExceeded"));
      return;
    }
    if (seleccion.some((fichero) => fichero.size > MAX_BYTES)) {
      setError(t("projects.personalize.imageTooLarge"));
      return;
    }

    setError(null);
    subir.mutate(seleccion);
  }

  function soltar(evento: DragEvent<HTMLDivElement>) {
    evento.preventDefault();
    setArrastrando(false);
    subirFicheros(evento.dataTransfer.files);
  }

  function mover(id: string, salto: number) {
    setOrden((actual) => {
      const posicion = actual.indexOf(id);
      const destino = posicion + salto;
      if (posicion < 0 || destino < 0 || destino >= actual.length) return actual;
      const copia = [...actual];
      const movida = copia[posicion]!;
      copia[posicion] = copia[destino]!;
      copia[destino] = movida;
      return copia;
    });
  }

  function confirmarBorrado(archivo: ArchivoApi) {
    if (!confirm(t("projects.personalize.confirmDeleteImage", { nombre: archivo.nombre }))) return;
    quitar.mutate(archivo.id);
  }

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
      let fondoEfectivo = fondo;

      if (fondo.tipo === "imagenes") {
        const segundos = leerIntervalo(intervalo);
        if (orden.length >= 2 && segundos === null) {
          throw new Error(t("projects.personalize.intervalInvalid"));
        }
        fondoEfectivo =
          orden.length === 0
            ? FONDO_POR_DEFECTO
            : {
                tipo: "imagenes",
                ids: orden,
                intervaloSeg: segundos ?? INTERVALO_POR_DEFECTO,
              };
      }

      const cambios: Record<string, unknown> = {};
      if (nombre.trim() !== proyecto.nombre) cambios.nombre = nombre.trim();
      if (color !== (proyecto.color ?? null)) cambios.color = color;
      if (claveFondo(fondoEfectivo) !== claveFondo(proyecto.fondo)) {
        cambios.fondo = fondoEfectivo;
      }
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

  const ocupado = subir.isPending || quitar.isPending || guardar.isPending;
  const segundos = leerIntervalo(intervalo);

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

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

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

            <fieldset className="personalizar__grupo">
              <legend>{t("projects.personalize.images")}</legend>

              <input
                ref={refEntradaImagenes}
                id="personalizar-imagenes"
                className="personalizar__entrada"
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif"
                tabIndex={-1}
                aria-label={t("projects.personalize.chooseImages")}
                onChange={(evento) => {
                  subirFicheros(evento.target.files);
                  evento.target.value = "";
                }}
              />

              <div
                className={`personalizar__zona${
                  arrastrando ? " personalizar__zona--activa" : ""
                }`}
                aria-describedby="personalizar-imagenes-ayuda"
                onDragOver={(evento) => {
                  evento.preventDefault();
                  setArrastrando(true);
                }}
                onDragLeave={() => setArrastrando(false)}
                onDrop={soltar}
              >
                <p id="personalizar-imagenes-ayuda" className="personalizar__ayuda">
                  {t("projects.personalize.imagesHint")}
                </p>
                <button
                  type="button"
                  className="boton-principal personalizar__subir"
                  aria-controls="personalizar-imagenes"
                  disabled={ocupado || orden.length >= MAX_IMAGENES}
                  onClick={() => refEntradaImagenes.current?.click()}
                >
                  {t("projects.personalize.addImages")}
                </button>
              </div>

              {subir.isPending && (
                <p className="personalizar__estado" role="status">
                  {t("projects.personalize.uploadingImages")}
                </p>
              )}

              {fondos.isPending && (
                <p className="personalizar__estado" role="status">
                  {t("projects.personalize.loadingImages")}
                </p>
              )}

              {fondos.isError && (
                <p className="error" role="alert">
                  {t("projects.personalize.loadImagesError")}
                </p>
              )}

              {!fondos.isPending && !fondos.isError && imagenesOrdenadas.length === 0 && (
                <p className="personalizar__etiqueta">
                  {t("projects.personalize.noImages")}
                </p>
              )}

              {imagenesOrdenadas.length > 0 && (
                <ul
                  className="personalizar__imagenes"
                  aria-label={t("projects.personalize.images")}
                >
                  {imagenesOrdenadas.map(({ id, archivo }, posicion) => {
                    const url = urlArchivo(id);
                    return (
                      <li key={id} className="personalizar__imagen">
                        <span className="personalizar__imagen-vista">
                          {url && (
                            <img
                              className="personalizar__imagen-miniatura"
                              src={url}
                              alt={archivo.nombre}
                              loading="lazy"
                            />
                          )}
                        </span>
                        <span className="personalizar__imagen-nombre">{archivo.nombre}</span>
                        <span className="personalizar__imagen-acciones">
                          <button
                            type="button"
                            className="personalizar__mover"
                            aria-label={t("projects.personalize.moveUp", {
                              nombre: archivo.nombre,
                            })}
                            disabled={posicion === 0 || ocupado}
                            onClick={() => mover(id, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="personalizar__mover"
                            aria-label={t("projects.personalize.moveDown", {
                              nombre: archivo.nombre,
                            })}
                            disabled={posicion === imagenesOrdenadas.length - 1 || ocupado}
                            onClick={() => mover(id, 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="boton-texto personalizar__quitar"
                            aria-label={t("projects.personalize.removeImage", {
                              nombre: archivo.nombre,
                            })}
                            disabled={ocupado}
                            onClick={() => confirmarBorrado(archivo)}
                          >
                            {t("projects.personalize.remove")}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {imagenesOrdenadas.length >= 2 && (
                <label className="personalizar__intervalo">
                  {t("projects.personalize.interval")}
                  <input
                    type="number"
                    min={INTERVALO_MIN}
                    max={INTERVALO_MAX}
                    step={1}
                    value={intervalo}
                    onChange={(evento) => setIntervalo(evento.target.value)}
                  />
                </label>
              )}

              <button
                type="button"
                className="personalizar__usar-fondo"
                aria-pressed={fondo.tipo === "imagenes"}
                disabled={orden.length === 0 || ocupado}
                onClick={() => {
                  if (orden.length === 0) return;
                  setFondo({
                    tipo: "imagenes",
                    ids: orden,
                    intervaloSeg: segundos ?? INTERVALO_POR_DEFECTO,
                  });
                }}
              >
                {t("projects.personalize.useAsBackground")}
              </button>
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
