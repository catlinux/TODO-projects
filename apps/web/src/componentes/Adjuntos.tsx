import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  ErrorHttp,
  esImagenPermitida,
  peticion,
  subirArchivo,
  type ArchivoApi,
  type PortadaTareaApi,
} from "../api";
import { urlArchivo } from "../portada";

/** Límite de la API (ARCHIVOS_MAX_MB): se rechaza en el cliente antes de subir. */
export const MAX_BYTES = 10 * 1024 * 1024;

/** Tamaño legible en KB o MB. */
export function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function IconoArchivo() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export interface PropiedadesAdjuntos {
  id?: string;
  tareaId: string;
  proyectoId: string;
  portada?: PortadaTareaApi | null;
}

export function Adjuntos({ id, tareaId, proyectoId, portada = null }: PropiedadesAdjuntos) {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const refEntrada = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  const archivos = useQuery({
    queryKey: ["archivos", tareaId],
    queryFn: () => peticion<ArchivoApi[]>(`/tareas/${tareaId}/archivos`),
    enabled: Boolean(tareaId),
  });

  const lista = Array.isArray(archivos.data) ? archivos.data : [];

  function invalidar() {
    void cliente.invalidateQueries({ queryKey: ["archivos", tareaId] });
    void cliente.invalidateQueries({ queryKey: ["tarea", tareaId] });
    void cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
  }

  function mensajeError(err: unknown): string {
    if (err instanceof ErrorHttp && err.status === 413) return t("attachments.tooLarge");
    return err instanceof Error ? err.message : t("auth.error");
  }

  const subir = useMutation({
    mutationFn: async (ficheros: File[]) => {
      for (const fichero of ficheros) {
        await subirArchivo(`/tareas/${tareaId}/archivos`, "archivo", fichero);
      }
    },
    onSuccess: () => {
      setError(null);
      invalidar();
    },
    onError: (err: unknown) => setError(mensajeError(err)),
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => peticion(`/archivos/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setError(null);
      invalidar();
    },
    onError: (err: unknown) => setError(mensajeError(err)),
  });

  const cambiarPortada = useMutation({
    mutationFn: async (nueva: PortadaTareaApi | null) =>
      peticion(`/tareas/${tareaId}`, {
        method: "PATCH",
        body: JSON.stringify({ portada: nueva }),
      }),
    onSuccess: () => {
      setError(null);
      invalidar();
    },
    onError: (err: unknown) => setError(mensajeError(err)),
  });

  function subirFicheros(ficheros: FileList | File[] | null) {
    if (!ficheros) return;
    const seleccion = Array.from(ficheros);
    if (seleccion.length === 0) return;

    if (seleccion.some((fichero) => fichero.size > MAX_BYTES)) {
      setError(t("attachments.tooLarge"));
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

  function confirmarBorrado(archivo: ArchivoApi) {
    if (!confirm(t("attachments.confirmDelete", { nombre: archivo.nombre }))) return;
    borrar.mutate(archivo.id);
  }

  function esPortadaDe(archivoId: string): boolean {
    return portada?.tipo === "imagen" && portada.archivoId === archivoId;
  }

  const ocupado = subir.isPending || borrar.isPending || cambiarPortada.isPending;

  return (
    <section id={id} className="tarjeta-detalle__seccion">
      <div className="tarjeta-detalle__seccion-cabecera">
        <h3>{t("attachments.section")}</h3>
      </div>

      <input
        ref={refEntrada}
        id="adjuntos-archivo"
        className="adjuntos__entrada"
        type="file"
        multiple
        tabIndex={-1}
        aria-label={t("attachments.choose")}
        onChange={(evento) => {
          subirFicheros(evento.target.files);
          evento.target.value = "";
        }}
      />

      <div
        className={`adjuntos__zona${arrastrando ? " adjuntos__zona--activa" : ""}`}
        aria-describedby="adjuntos-ayuda"
        onDragOver={(evento) => {
          evento.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={soltar}
      >
        <p id="adjuntos-ayuda" className="adjuntos__ayuda">
          {t("attachments.dropHint")}
        </p>
        <button
          type="button"
          className="boton-principal adjuntos__boton"
          aria-controls="adjuntos-archivo"
          onClick={() => refEntrada.current?.click()}
        >
          {t("attachments.add")}
        </button>
      </div>

      {subir.isPending && (
        <p className="adjuntos__estado" role="status">
          {t("attachments.uploading")}
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {archivos.isError && (
        <p className="error" role="alert">
          {t("attachments.loadError")}
        </p>
      )}

      <ul className="adjuntos__lista">
        {lista.length === 0 && <li className="adjuntos__vacia">{t("attachments.empty")}</li>}
        {lista.map((archivo) => {
          const url = urlArchivo(archivo.id);
          const imagen = esImagenPermitida(archivo.mime);
          const esPortada = esPortadaDe(archivo.id);
          const accion = imagen ? t("attachments.open") : t("attachments.download");
          return (
            <li key={archivo.id} className="adjuntos__item">
              <span className="adjuntos__vista">
                {imagen && url ? (
                  <img className="adjuntos__miniatura" src={url} loading="lazy" alt={archivo.nombre} />
                ) : (
                  <span className="adjuntos__icono" aria-hidden="true">
                    <IconoArchivo />
                  </span>
                )}
              </span>

              <span className="adjuntos__datos">
                <span className="adjuntos__nombre">{archivo.nombre}</span>
                <span className="adjuntos__tamano cifra">{formatearTamano(archivo.tamano)}</span>
              </span>

              <span className="adjuntos__acciones">
                {url && (
                  <a
                    className="adjuntos__abrir"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${accion} ${archivo.nombre}`}
                  >
                    {accion}
                  </a>
                )}
                {imagen && url && (
                  <button
                    type="button"
                    className="boton-texto"
                    aria-label={`${
                      esPortada ? t("cover.remove") : t("attachments.useCover")
                    } ${archivo.nombre}`}
                    disabled={ocupado}
                    onClick={() =>
                      esPortada
                        ? cambiarPortada.mutate(null)
                        : cambiarPortada.mutate({ tipo: "imagen", archivoId: archivo.id })
                    }
                  >
                    {esPortada ? t("cover.remove") : t("attachments.useCover")}
                  </button>
                )}
                <button
                  type="button"
                  className="boton-texto adjuntos__borrar"
                  aria-label={t("attachments.deleteNamed", { nombre: archivo.nombre })}
                  disabled={ocupado}
                  onClick={() => confirmarBorrado(archivo)}
                >
                  {t("attachments.delete")}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
