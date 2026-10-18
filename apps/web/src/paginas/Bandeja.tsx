import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  peticion,
  type ColumnaApi,
  type ProyectoApi,
  type RespuestaBandejaApi,
  type TareaApi,
} from "../api";
import { chipFecha } from "../fechas";

/** Ordena por posición, como las columnas del tablero. */
function porPosicion<T extends { posicion: number }>(elementos: T[]): T[] {
  return elementos.slice().sort((a, b) => a.posicion - b.posicion);
}

export default function Bandeja() {
  const { t } = useTranslation();
  const cliente = useQueryClient();

  const bandeja = useQuery({
    queryKey: ["bandeja"],
    queryFn: () => peticion<RespuestaBandejaApi>("/bandeja"),
  });

  const proyectos = useQuery({
    queryKey: ["proyectos"],
    queryFn: () => peticion<ProyectoApi[]>("/proyectos"),
  });

  const bandejaId = bandeja.data?.proyecto.id ?? "";
  const columnasBandeja = useMemo(() => porPosicion(bandeja.data?.columnas ?? []), [bandeja.data]);
  const tareas = useMemo(() => porPosicion(bandeja.data?.tareas ?? []), [bandeja.data]);

  const [titulo, setTitulo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refCampo = useRef<HTMLInputElement>(null);

  function invalidarBandeja(proyectoId: string) {
    return Promise.all([
      cliente.invalidateQueries({ queryKey: ["bandeja"] }),
      cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] }),
      cliente.invalidateQueries({ queryKey: ["proyectos"] }),
      cliente.invalidateQueries({ queryKey: ["agenda"] }),
    ]);
  }

  const crear = useMutation({
    mutationFn: (texto: string) =>
      peticion(`/proyectos/${bandejaId}/tareas`, {
        method: "POST",
        body: JSON.stringify({ titulo: texto, columnaId: columnasBandeja[0]?.id }),
      }),
    onSuccess: async () => {
      setError(null);
      setTitulo("");
      refCampo.current?.focus();
      await invalidarBandeja(bandejaId);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  const borrar = useMutation({
    mutationFn: (tareaId: string) => peticion(`/tareas/${tareaId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setError(null);
      await invalidarBandeja(bandejaId);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  // Diálogo «Mover a…»: proyecto y columna de destino.
  const [tareaMover, setTareaMover] = useState<TareaApi | null>(null);
  const [proyectoDestino, setProyectoDestino] = useState("");
  const [columnaDestino, setColumnaDestino] = useState("");
  const refDialogo = useRef<HTMLDialogElement>(null);

  const columnasDestino = useQuery({
    queryKey: ["columnas", proyectoDestino],
    queryFn: () => peticion<ColumnaApi[]>(`/proyectos/${proyectoDestino}/columnas`),
    enabled: Boolean(proyectoDestino),
  });

  const columnasDestinoOrdenadas = useMemo(
    () => porPosicion(columnasDestino.data ?? []),
    [columnasDestino.data],
  );

  // Al abrir el diálogo, el primer proyecto (y luego su primera columna).
  useEffect(() => {
    if (!tareaMover) return;
    setProyectoDestino(proyectos.data?.[0]?.id ?? "");
    setColumnaDestino("");
  }, [tareaMover, proyectos.data]);

  useEffect(() => {
    if (!proyectoDestino) return;
    setColumnaDestino(columnasDestinoOrdenadas[0]?.id ?? "");
  }, [proyectoDestino, columnasDestinoOrdenadas]);

  useEffect(() => {
    const dialogo = refDialogo.current;
    if (!dialogo) return;
    if (tareaMover) {
      if (typeof dialogo.showModal === "function") {
        if (!dialogo.open) dialogo.showModal();
      } else {
        dialogo.setAttribute("open", "");
      }
      dialogo.querySelector<HTMLElement>("select, button")?.focus();
    } else {
      if (typeof dialogo.close === "function") {
        if (dialogo.open) dialogo.close();
      } else {
        dialogo.removeAttribute("open");
      }
    }
  }, [tareaMover]);

  const mover = useMutation({
    mutationFn: ({
      tareaId,
      proyectoId,
      columnaId,
    }: {
      tareaId: string;
      proyectoId: string;
      columnaId: string;
    }) =>
      peticion(`/tareas/${tareaId}/mover`, {
        method: "POST",
        body: JSON.stringify({ proyectoId, columnaId }),
      }),
    onSuccess: async (_datos, variables) => {
      setError(null);
      setTareaMover(null);
      await invalidarBandeja(bandejaId);
      await cliente.invalidateQueries({ queryKey: ["tareas", variables.proyectoId] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  function crearDesdeCampo(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const texto = titulo.trim();
    if (!texto) return;
    crear.mutate(texto);
  }

  function confirmarBorrado(tarea: TareaApi) {
    if (!confirm(t("inbox.deleteConfirm", { titulo: tarea.titulo }))) return;
    borrar.mutate(tarea.id);
  }

  return (
    <main className="contenedor contenedor--ancho bandeja">
      <h1>{t("inbox.title")}</h1>

      <form className="bandeja__captura" onSubmit={crearDesdeCampo}>
        <label className="visualmente-oculto" htmlFor="bandeja-captura">
          {t("inbox.captureLabel")}
        </label>
        <input
          id="bandeja-captura"
          ref={refCampo}
          type="text"
          value={titulo}
          placeholder={t("inbox.capturePlaceholder")}
          onChange={(evento) => setTitulo(evento.target.value)}
        />
        <button
          type="submit"
          className="boton-principal"
          disabled={crear.isPending || !titulo.trim()}
        >
          {t("inbox.add")}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {bandeja.isLoading ? (
        <p>{t("app.loading")}</p>
      ) : bandeja.isError ? (
        <p className="error">{t("auth.error")}</p>
      ) : tareas.length === 0 ? (
        <p className="bandeja__vacia">{t("inbox.empty")}</p>
      ) : (
        <ul className="bandeja__lista">
          {tareas.map((tarea) => {
            const chip = chipFecha(tarea.venceEn);
            return (
              <li key={tarea.id} className="bandeja__tarea">
                <Link
                  className="bandeja__titulo"
                  to={`/proyectos/${bandejaId}/tareas/${tarea.id}`}
                >
                  {tarea.titulo}
                </Link>
                {chip && (
                  <span className={`chip-fecha chip-fecha--${chip.estado} mono`}>{chip.texto}</span>
                )}
                <div className="bandeja__acciones">
                  <button
                    type="button"
                    className="boton-fila"
                    aria-haspopup="dialog"
                    onClick={() => setTareaMover(tarea)}
                  >
                    {t("inbox.move")}…
                  </button>
                  <button
                    type="button"
                    className="boton-fila"
                    disabled={borrar.isPending}
                    onClick={() => confirmarBorrado(tarea)}
                  >
                    {t("inbox.delete")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <dialog
        ref={refDialogo}
        className="dialogo-tarea bandeja__dialogo"
        aria-labelledby="titulo-mover-tarea"
        onCancel={(evento) => {
          evento.preventDefault();
          setTareaMover(null);
        }}
        onKeyDown={(evento) => {
          if (evento.key === "Escape") {
            evento.preventDefault();
            setTareaMover(null);
          }
        }}
      >
        {tareaMover && (
          <div className="dialogo-tarea__cuerpo">
            <h2 id="titulo-mover-tarea">{t("inbox.moveTitle", { titulo: tareaMover.titulo })}</h2>
            {proyectos.data && proyectos.data.length === 0 ? (
              <p>{t("inbox.noProjects")}</p>
            ) : (
              <div className="bandeja__mover">
                <label>
                  {t("inbox.project")}
                  <select
                    value={proyectoDestino}
                    onChange={(evento) => setProyectoDestino(evento.target.value)}
                  >
                    {(proyectos.data ?? []).map((proyecto) => (
                      <option key={proyecto.id} value={proyecto.id}>
                        {proyecto.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("inbox.column")}
                  <select
                    value={columnaDestino}
                    disabled={columnasDestinoOrdenadas.length === 0}
                    onChange={(evento) => setColumnaDestino(evento.target.value)}
                  >
                    {columnasDestinoOrdenadas.map((columna) => (
                      <option key={columna.id} value={columna.id}>
                        {columna.nombre}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className="acciones">
              <button
                type="button"
                className="boton-principal"
                disabled={!proyectoDestino || !columnaDestino || mover.isPending}
                onClick={() =>
                  mover.mutate({
                    tareaId: tareaMover.id,
                    proyectoId: proyectoDestino,
                    columnaId: columnaDestino,
                  })
                }
              >
                {t("inbox.confirmMove")}
              </button>
              <button type="button" onClick={() => setTareaMover(null)}>
                {t("inbox.cancel")}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </main>
  );
}
