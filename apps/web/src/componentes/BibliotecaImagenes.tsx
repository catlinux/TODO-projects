import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  ErrorHttp,
  esImagenPermitida,
  peticion,
  subirArchivo,
  type ArchivoApi,
} from "../api";
import { OPCIONES_BIBLIOTECA, reducirImagen } from "../imagenes";
import { urlArchivo } from "../portada";
import { formatearTamano, MAX_BYTES } from "./Adjuntos";

/** Límite de la API para la biblioteca. */
const MAX_IMAGENES = 300;
/** Subidas simultáneas como máximo. */
const EN_PARALELO = 3;

interface ErrorSubida {
  nombre: string;
  mensaje: string;
}

interface Progreso {
  hechos: number;
  total: number;
}

export function BibliotecaImagenes() {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const refEntrada = useRef<HTMLInputElement>(null);

  const [arrastrando, setArrastrando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const [errores, setErrores] = useState<ErrorSubida[]>([]);
  const [errorBorrado, setErrorBorrado] = useState<string | null>(null);

  const biblioteca = useQuery({
    queryKey: ["biblioteca"],
    queryFn: () => peticion<ArchivoApi[]>("/biblioteca"),
  });

  const lista = Array.isArray(biblioteca.data) ? biblioteca.data : [];

  async function invalidar() {
    await Promise.all([
      cliente.invalidateQueries({ queryKey: ["biblioteca"] }),
      cliente.invalidateQueries({ queryKey: ["proyectos"] }),
      cliente.invalidateQueries({ queryKey: ["proyecto"] }),
      cliente.invalidateQueries({ queryKey: ["fondos"] }),
    ]);
  }

  const borrar = useMutation({
    mutationFn: (id: string) => peticion(`/biblioteca/${id}`, { method: "DELETE" }),
    onMutate: () => setErrorBorrado(null),
    onSuccess: async () => {
      await invalidar();
    },
    onError: (err: unknown) => {
      setErrorBorrado(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  function confirmarBorrado(archivo: ArchivoApi) {
    if (!confirm(t("settings.library.deleteConfirm", { nombre: archivo.nombre }))) return;
    borrar.mutate(archivo.id);
  }

  function mensajeError(err: unknown): string {
    if (err instanceof ErrorHttp && err.status === 413) return t("settings.library.tooLarge");
    return err instanceof Error ? err.message : t("auth.error");
  }

  async function subirFicheros(entrada: FileList | File[] | null) {
    if (!entrada) return;
    const ficheros = Array.from(entrada);
    if (ficheros.length === 0) return;

    setErrores([]);
    setErrorBorrado(null);

    const libres = Math.max(0, MAX_IMAGENES - lista.length);
    const validos: File[] = [];
    const rechazados: ErrorSubida[] = [];
    let cupo = libres;

    for (const fichero of ficheros) {
      if (!esImagenPermitida(fichero.type)) {
        rechazados.push({
          nombre: fichero.name,
          mensaje: t("settings.library.typeInvalid", { nombre: fichero.name }),
        });
        continue;
      }
      if (fichero.size > MAX_BYTES) {
        rechazados.push({
          nombre: fichero.name,
          mensaje: t("settings.library.tooLarge", { nombre: fichero.name }),
        });
        continue;
      }
      if (cupo <= 0) {
        rechazados.push({
          nombre: fichero.name,
          mensaje: t("settings.library.limitReached", { nombre: fichero.name }),
        });
        continue;
      }
      cupo -= 1;
      validos.push(fichero);
    }

    const total = ficheros.length;
    setErrores(rechazados);
    setProgreso({ hechos: total - validos.length, total });

    if (validos.length === 0) return;

    setSubiendo(true);
    let siguiente = 0;

    const trabajar = async () => {
      for (;;) {
        const fichero = validos[siguiente];
        siguiente += 1;
        if (!fichero) return;

        try {
          const reducida = await reducirImagen(fichero, OPCIONES_BIBLIOTECA);
          await subirArchivo<ArchivoApi>("/biblioteca", "archivo", reducida);
        } catch (error) {
          setErrores((actual) => [
            ...actual,
            {
              nombre: fichero.name,
              mensaje: t("settings.library.fileError", {
                nombre: fichero.name,
                mensaje: mensajeError(error),
              }),
            },
          ]);
        } finally {
          setProgreso((actual) =>
            actual ? { ...actual, hechos: actual.hechos + 1 } : actual,
          );
        }
      }
    };

    const trabajadores = Math.min(EN_PARALELO, validos.length);
    await Promise.all(Array.from({ length: trabajadores }, () => trabajar()));

    setSubiendo(false);
    await invalidar();
  }

  function soltar(evento: DragEvent<HTMLDivElement>) {
    evento.preventDefault();
    setArrastrando(false);
    void subirFicheros(evento.dataTransfer.files);
  }

  return (
    <section className="panel-tarjeta" aria-labelledby="ajustes-biblioteca">
      <div className="panel-tarjeta__cabecera">
        <h2 className="panel-tarjeta__titulo" id="ajustes-biblioteca">
          {t("settings.library.title")}
        </h2>
        <p className="panel-tarjeta__descripcion">{t("settings.library.description")}</p>
      </div>

      <p className="biblioteca__contador cifra">
        {t("settings.library.counter", { n: lista.length, max: MAX_IMAGENES })}
      </p>

      <input
        ref={refEntrada}
        id="biblioteca-entrada"
        className="personalizar__entrada"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif"
        tabIndex={-1}
        aria-label={t("settings.library.upload")}
        onChange={(evento) => {
          void subirFicheros(evento.target.files);
          evento.target.value = "";
        }}
      />

      <div
        className={`biblioteca__zona${arrastrando ? " biblioteca__zona--activa" : ""}`}
        onDragOver={(evento) => {
          evento.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={soltar}
      >
        <p className="personalizar__ayuda">
          {t(arrastrando ? "settings.library.dropActive" : "settings.library.dropHint")}
        </p>
        <button
          type="button"
          className="boton-principal"
          aria-controls="biblioteca-entrada"
          disabled={subiendo || biblioteca.isPending}
          onClick={() => refEntrada.current?.click()}
        >
          {t("settings.library.upload")}
        </button>
      </div>

      {progreso && (
        <p className="biblioteca__progreso" role="status">
          {subiendo && `${t("settings.library.uploading")} `}
          {t("settings.library.progress", {
            hechos: progreso.hechos,
            total: progreso.total,
          })}
        </p>
      )}

      {errores.length > 0 && (
        <ul className="error biblioteca__errores" aria-label={t("settings.library.errors")}>
          {errores.map((error, indice) => (
            <li key={`${error.nombre}-${indice}`}>{error.mensaje}</li>
          ))}
        </ul>
      )}

      {errorBorrado && (
        <p className="error" role="alert">
          {errorBorrado}
        </p>
      )}

      {biblioteca.isPending && <p>{t("app.loading")}</p>}
      {biblioteca.isError && <p className="error">{t("settings.library.loadError")}</p>}

      {!biblioteca.isPending && !biblioteca.isError && lista.length === 0 && (
        <div className="biblioteca__vacia">
          <p>{t("settings.library.empty")}</p>
          <p>{t("settings.library.emptyHint")}</p>
        </div>
      )}

      {lista.length > 0 && (
        <ul className="biblioteca__rejilla" aria-label={t("settings.library.title")}>
          {lista.map((archivo) => {
            const url = urlArchivo(archivo.id);
            return (
              <li key={archivo.id} className="biblioteca__imagen">
                <span className="biblioteca__vista">
                  {url && (
                    <img
                      className="biblioteca__miniatura"
                      src={url}
                      alt={archivo.nombre}
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </span>
                <span className="biblioteca__nombre">{archivo.nombre}</span>
                <span className="biblioteca__detalle cifra">
                  {formatearTamano(archivo.tamano)}
                </span>
                <button
                  type="button"
                  className="boton-texto biblioteca__eliminar"
                  aria-label={t("settings.library.deleteNamed", { nombre: archivo.nombre })}
                  disabled={borrar.isPending}
                  onClick={() => confirmarBorrado(archivo)}
                >
                  {t("settings.library.delete")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
