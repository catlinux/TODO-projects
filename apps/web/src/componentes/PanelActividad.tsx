import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  peticion,
  type ElementoActividadApi,
  type ElementoHistorialApi,
  type RespuestaActividadApi,
  type UsuarioApi,
} from "../api";
import { inicial } from "../inicial";

const FORMATO_RELATIVO = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const MES = 30 * DIA;
const ANIO = 365 * DIA;

/** Fecha relativa en castellano («hace 5 minutos», «ayer»). */
export function fechaRelativa(iso: string, ahora: number = Date.now()): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";

  const diferencia = fecha.getTime() - ahora;
  const absoluta = Math.abs(diferencia);

  if (absoluta < MINUTO) return FORMATO_RELATIVO.format(Math.round(diferencia / 1000), "second");
  if (absoluta < HORA) return FORMATO_RELATIVO.format(Math.round(diferencia / MINUTO), "minute");
  if (absoluta < DIA) return FORMATO_RELATIVO.format(Math.round(diferencia / HORA), "hour");
  if (absoluta < MES) return FORMATO_RELATIVO.format(Math.round(diferencia / DIA), "day");
  if (absoluta < ANIO) return FORMATO_RELATIVO.format(Math.round(diferencia / MES), "month");
  return FORMATO_RELATIVO.format(Math.round(diferencia / ANIO), "year");
}

/** Fecha absoluta para el atributo `title` del `<time>`. */
export function fechaAbsoluta(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  return fecha.toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
}

/** Redacta una entrada de historial; los tipos desconocidos caen en genérico. */
export function textoHistorial(elemento: ElementoHistorialApi, t: TFunction): string {
  switch (elemento.historialTipo) {
    case "creada":
      return t("activity.history.creada");
    case "movida":
      if (elemento.desde && elemento.hasta) {
        return t("activity.history.movida", {
          desde: elemento.desde,
          hasta: elemento.hasta,
        });
      }
      return t("activity.history.movidaSinColumnas");
    case "fecha":
      if (!elemento.antes && elemento.despues) return t("activity.history.fechaPuesta");
      if (elemento.antes && !elemento.despues) return t("activity.history.fechaQuitada");
      return t("activity.history.fecha");
    case "etiqueta":
      return elemento.accion === "quitada"
        ? t("activity.history.etiquetaQuitada", { nombre: elemento.nombre ?? "" })
        : t("activity.history.etiquetaAnadida", { nombre: elemento.nombre ?? "" });
    case "checklist":
      return t("activity.history.checklist", { texto: elemento.texto ?? "" });
    case "descripcion":
      return t("activity.history.descripcion", { texto: elemento.texto ?? "" });
    case "portada":
      return t("activity.history.portada");
    case "adjunto":
      return t("activity.history.adjunto");
    case "proyecto":
      return t("activity.history.proyecto");
    default:
      return t("activity.history.desconocido");
  }
}

/** Pide `paginas` páginas seguidas y las une; son 50 elementos por página. */
async function cargarActividad(tareaId: string, paginas: number): Promise<RespuestaActividadApi> {
  const elementos: ElementoActividadApi[] = [];
  let hayMas = false;
  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    const respuesta = await peticion<RespuestaActividadApi>(
      `/tareas/${tareaId}/actividad?pagina=${pagina}`,
    );
    elementos.push(...respuesta.elementos);
    hayMas = respuesta.hayMas;
    if (!hayMas) break;
  }
  return { elementos, hayMas };
}

export interface PropiedadesPanelActividad {
  tareaId: string;
  proyectoId: string;
}

export function PanelActividad({ tareaId, proyectoId }: PropiedadesPanelActividad) {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const [paginas, setPaginas] = useState(1);
  const [texto, setTexto] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [textoEdicion, setTextoEdicion] = useState("");
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // El usuario ya está en caché por la ruta protegida: aquí solo se lee.
  const usuario = useQuery({
    queryKey: ["yo"],
    queryFn: () => peticion<UsuarioApi>("/auth/yo"),
    retry: false,
    staleTime: Infinity,
  });

  const actividad = useQuery({
    queryKey: ["actividad", tareaId, paginas],
    queryFn: () => cargarActividad(tareaId, paginas),
    enabled: Boolean(tareaId),
  });

  const elementos = actividad.data?.elementos ?? [];
  const hayMas = actividad.data?.hayMas ?? false;

  function invalidar() {
    setPaginas(1);
    void cliente.invalidateQueries({ queryKey: ["actividad", tareaId] });
    void cliente.invalidateQueries({ queryKey: ["tarea", tareaId] });
    void cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
  }

  function alFallar(err: unknown) {
    setError(err instanceof Error ? err.message : t("auth.error"));
  }

  const comentar = useMutation({
    mutationFn: async (nuevo: string) =>
      peticion(`/tareas/${tareaId}/comentarios`, {
        method: "POST",
        body: JSON.stringify({ texto: nuevo }),
      }),
    onSuccess: () => {
      setError(null);
      setTexto("");
      invalidar();
    },
    onError: alFallar,
  });

  const actualizar = useMutation({
    mutationFn: async ({ id, nuevo }: { id: string; nuevo: string }) =>
      peticion(`/comentarios/${id}`, { method: "PATCH", body: JSON.stringify({ texto: nuevo }) }),
    onSuccess: () => {
      setError(null);
      setEditandoId(null);
      invalidar();
    },
    onError: alFallar,
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => peticion(`/comentarios/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setError(null);
      setConfirmandoId(null);
      invalidar();
    },
    onError: alFallar,
  });

  function enviar() {
    const limpio = texto.trim();
    if (!limpio) return;
    comentar.mutate(limpio);
  }

  function empezarEdicion(comentario: ElementoActividadApi) {
    if (comentario.tipo !== "comentario") return;
    setEditandoId(comentario.id);
    setTextoEdicion(comentario.texto);
  }

  function confirmarEdicion(id: string, original: string) {
    const limpio = textoEdicion.trim();
    if (!limpio || limpio === original) {
      setEditandoId(null);
      return;
    }
    actualizar.mutate({ id, nuevo: limpio });
  }

  return (
    <section className="panel-actividad" aria-label={t("activity.section")}>
      <h3 className="panel-actividad__titulo">{t("activity.section")}</h3>

      <form
        className="panel-actividad__formulario"
        onSubmit={(evento) => {
          evento.preventDefault();
          enviar();
        }}
      >
        <textarea
          aria-label={t("activity.commentField")}
          placeholder={t("activity.commentPlaceholder")}
          rows={3}
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === "Enter" && (evento.ctrlKey || evento.metaKey)) {
              evento.preventDefault();
              enviar();
            }
          }}
        />
        <p className="panel-actividad__ayuda">{t("activity.commentHint")}</p>
        <div className="acciones">
          <button
            type="submit"
            className="boton-principal"
            disabled={!texto.trim() || comentar.isPending}
          >
            {t("activity.commentButton")}
          </button>
        </div>
      </form>

      {actividad.isError && (
        <p className="error" role="alert">
          {t("activity.loadError")}
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {actividad.isPending ? (
        <p>{t("app.loading")}</p>
      ) : (
        <ul className="panel-actividad__lista">
          {elementos.length === 0 && (
            <li className="panel-actividad__vacia">{t("activity.empty")}</li>
          )}
          {elementos.map((elemento) => {
            const fecha = (
              <time
                className="panel-actividad__fecha cifra"
                dateTime={elemento.creadoEn}
                title={fechaAbsoluta(elemento.creadoEn)}
              >
                {fechaRelativa(elemento.creadoEn)}
              </time>
            );

            if (elemento.tipo === "historial") {
              return (
                <li
                  key={elemento.id}
                  className="panel-actividad__elemento panel-actividad__elemento--historial"
                >
                  <span className="panel-actividad__punto" aria-hidden="true" />
                  <p className="panel-actividad__historial">
                    <strong>{elemento.usuarioNombre}</strong>{" "}
                    {textoHistorial(elemento, t)} {fecha}
                  </p>
                </li>
              );
            }

            const propio =
              Boolean(usuario.data) && elemento.usuarioId === usuario.data?.id;

            return (
              <li
                key={elemento.id}
                className="panel-actividad__elemento panel-actividad__elemento--comentario"
              >
                <span className="panel-actividad__avatar" aria-hidden="true">
                  {inicial(elemento.usuarioNombre)}
                </span>
                <div className="panel-actividad__contenido">
                  <p className="panel-actividad__meta">
                    <strong className="panel-actividad__autor">{elemento.usuarioNombre}</strong> {fecha}
                  </p>

                  {editandoId === elemento.id ? (
                    <form
                      className="panel-actividad__edicion"
                      onSubmit={(evento) => {
                        evento.preventDefault();
                        confirmarEdicion(elemento.id, elemento.texto);
                      }}
                    >
                      <textarea
                        aria-label={t("activity.editComment")}
                        rows={3}
                        autoFocus
                        value={textoEdicion}
                        onChange={(evento) => setTextoEdicion(evento.target.value)}
                      />
                      <div className="acciones">
                        <button
                          type="submit"
                          className="boton-principal"
                          disabled={!textoEdicion.trim() || actualizar.isPending}
                        >
                          {t("activity.save")}
                        </button>
                        <button type="button" onClick={() => setEditandoId(null)}>
                          {t("activity.cancel")}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="panel-actividad__texto">{elemento.texto}</p>
                      {propio && (
                        <div className="panel-actividad__acciones">
                          {confirmandoId === elemento.id ? (
                            <span className="panel-actividad__confirmar">
                              <span>{t("activity.deleteConfirm")}</span>
                              <button
                                type="button"
                                className="boton-texto"
                                onClick={() => borrar.mutate(elemento.id)}
                              >
                                {t("activity.deleteYes")}
                              </button>
                              <button
                                type="button"
                                className="boton-texto"
                                onClick={() => setConfirmandoId(null)}
                              >
                                {t("activity.cancel")}
                              </button>
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="boton-texto"
                                onClick={() => empezarEdicion(elemento)}
                              >
                                {t("activity.edit")}
                              </button>
                              <button
                                type="button"
                                className="boton-texto"
                                onClick={() => setConfirmandoId(elemento.id)}
                              >
                                {t("activity.delete")}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hayMas && (
        <button
          type="button"
          className="boton-texto"
          disabled={actividad.isFetching}
          onClick={() => setPaginas((actual) => actual + 1)}
        >
          {t("activity.loadMore")}
        </button>
      )}
    </section>
  );
}
