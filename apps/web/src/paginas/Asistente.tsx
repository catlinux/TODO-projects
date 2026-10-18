import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  ErrorHttp,
  peticion,
  type AccionAsistenteApi,
  type RespuestaChatAsistenteApi,
} from "../api";

/** Clave de la conversación en `sessionStorage`; se pierde al cerrar la pestaña. */
const CLAVE_CONVERSACION = "todo-asistente-conversacion";

/** Tope de mensajes que se envían al servidor (el servidor no guarda historial). */
const MAX_HISTORIAL = 20;

const EJEMPLOS = ["crearTarea", "semana", "proyectos"] as const;

interface Mensaje {
  id: string;
  rol: "user" | "assistant";
  texto: string;
  acciones?: AccionAsistenteApi[];
}

interface ErrorChat {
  texto: string;
  status: number | null;
  /** ¿Tiene sentido volver a enviar el último mensaje? */
  recurrible: boolean;
}

function esMensaje(valor: unknown): valor is Mensaje {
  if (typeof valor !== "object" || valor === null) return false;
  const mensaje = valor as { id?: unknown; rol?: unknown; texto?: unknown };
  return (
    typeof mensaje.id === "string" &&
    (mensaje.rol === "user" || mensaje.rol === "assistant") &&
    typeof mensaje.texto === "string"
  );
}

function cargarConversacion(): Mensaje[] {
  try {
    const bruto = sessionStorage.getItem(CLAVE_CONVERSACION);
    if (!bruto) return [];
    const datos: unknown = JSON.parse(bruto);
    if (!Array.isArray(datos)) return [];
    return datos.filter(esMensaje);
  } catch {
    return [];
  }
}

function guardarConversacion(mensajes: Mensaje[]): void {
  try {
    sessionStorage.setItem(CLAVE_CONVERSACION, JSON.stringify(mensajes));
  } catch {
    // Sin espacio o almacenamiento bloqueado: la conversación no se conserva.
  }
}

function nuevoId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function zonaLocal(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export default function Asistente() {
  const { t } = useTranslation();
  const cliente = useQueryClient();

  const [mensajes, setMensajes] = useState<Mensaje[]>(cargarConversacion);
  const [borrador, setBorrador] = useState("");
  const [error, setError] = useState<ErrorChat | null>(null);
  const refHilo = useRef<HTMLDivElement>(null);
  const refCuadro = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    guardarConversacion(mensajes);
  }, [mensajes]);

  useEffect(() => {
    const hilo = refHilo.current;
    if (hilo) hilo.scrollTop = hilo.scrollHeight;
  }, [mensajes, error]);

  function describirError(err: unknown): ErrorChat {
    if (err instanceof ErrorHttp) {
      if (err.status === 409) {
        return { texto: t("asistente.notConfigured"), status: 409, recurrible: false };
      }
      const alternativo = err.status === 429 ? t("asistente.errorLimit") : t("asistente.errorProvider");
      return { texto: err.message || alternativo, status: err.status, recurrible: true };
    }
    return { texto: t("asistente.errorNetwork"), status: null, recurrible: true };
  }

  const enviar = useMutation({
    mutationFn: (historial: Mensaje[]) => {
      const zona = zonaLocal();
      return peticion<RespuestaChatAsistenteApi>("/asistente/chat", {
        method: "POST",
        body: JSON.stringify({
          mensajes: historial
            .slice(-MAX_HISTORIAL)
            .map((mensaje) => ({ rol: mensaje.rol, texto: mensaje.texto })),
          ...(zona ? { zona } : {}),
        }),
      });
    },
    onSuccess: async (respuesta, historial) => {
      setError(null);
      const nuevos = historial.slice();
      if (respuesta.mensaje.trim()) {
        nuevos.push({
          id: nuevoId(),
          rol: "assistant",
          texto: respuesta.mensaje,
          ...(respuesta.acciones.length > 0 ? { acciones: respuesta.acciones } : {}),
        });
      }
      setMensajes(nuevos);
      if (respuesta.acciones.length > 0) {
        // Las herramientas han podido crear o mover tareas: refresca lo afectado.
        await Promise.all([
          cliente.invalidateQueries({ queryKey: ["proyectos"] }),
          cliente.invalidateQueries({ queryKey: ["tareas"] }),
          cliente.invalidateQueries({ queryKey: ["agenda"] }),
          cliente.invalidateQueries({ queryKey: ["hoy"] }),
        ]);
      }
    },
    onError: (err, historial) => {
      setMensajes(historial);
      setError(describirError(err));
    },
  });

  const esperando = enviar.isPending;

  function enviarTexto() {
    const texto = borrador.trim();
    if (!texto || esperando) return;
    const historial = [...mensajes, { id: nuevoId(), rol: "user" as const, texto }];
    setMensajes(historial);
    setBorrador("");
    setError(null);
    enviar.mutate(historial);
  }

  function reintentar() {
    if (esperando || mensajes.length === 0) return;
    setError(null);
    enviar.mutate(mensajes);
  }

  function nuevaConversacion() {
    setMensajes([]);
    setError(null);
    setBorrador("");
    refCuadro.current?.focus();
  }

  function usarEjemplo(texto: string) {
    setBorrador(texto);
    refCuadro.current?.focus();
  }

  return (
    <main className="pagina pagina--chat asistente">
      <header className="pagina__cabecera">
        <div>
          <h1 className="pagina__titulo">{t("asistente.title")}</h1>
          <p className="pagina__subtitulo">{t("asistente.subtitle")}</p>
        </div>
        <div className="pagina__acciones">
          <button
            type="button"
            className="boton-fantasma"
            onClick={nuevaConversacion}
            disabled={mensajes.length === 0 && !error}
          >
            {t("asistente.newConversation")}
          </button>
        </div>
      </header>

      <div
        className="asistente__hilo"
        role="log"
        aria-live="polite"
        aria-label={t("asistente.logLabel")}
        ref={refHilo}
      >
        {mensajes.length === 0 && !error && !esperando && (
          <div className="asistente__vacio">
            <h2 className="asistente__vacio-titulo">{t("asistente.emptyTitle")}</h2>
            <p className="asistente__vacio-texto">{t("asistente.emptyHint")}</p>
            <ul className="asistente__ejemplos">
              {EJEMPLOS.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    className="asistente__ejemplo"
                    onClick={() => usarEjemplo(t(`asistente.ejemplos.${id}`))}
                  >
                    {t(`asistente.ejemplos.${id}`)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mensajes.map((mensaje) => (
          <div
            key={mensaje.id}
            className={`asistente__mensaje asistente__mensaje--${
              mensaje.rol === "user" ? "usuario" : "asistente"
            }`}
          >
            <p className="asistente__burbuja">{mensaje.texto}</p>
            {mensaje.acciones && mensaje.acciones.length > 0 && (
              <ul className="asistente__acciones" aria-label={t("asistente.actionsLabel")}>
                {mensaje.acciones.map((accion, indice) => (
                  <li key={`${mensaje.id}-${indice}`}>
                    {accion.enlace ? (
                      <Link className="asistente__accion" to={accion.enlace}>
                        {accion.resumen}
                      </Link>
                    ) : (
                      <span className="asistente__accion">{accion.resumen}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {esperando && (
          <div className="asistente__mensaje asistente__mensaje--asistente">
            <p className="asistente__burbuja asistente__pensando">{t("asistente.thinking")}</p>
          </div>
        )}

        {error && (
          <div className="asistente__mensaje asistente__mensaje--asistente asistente__mensaje--error">
            <p className="asistente__burbuja error">{error.texto}</p>
            {error.status === 409 && (
              <Link className="boton" to="/ajustes">
                {t("asistente.goToSettings")}
              </Link>
            )}
            {error.recurrible && (
              <button type="button" className="boton-fantasma" onClick={reintentar} disabled={esperando}>
                {t("asistente.retry")}
              </button>
            )}
          </div>
        )}
      </div>

      <label className="visualmente-oculto" htmlFor="asistente-cuadro">
        {t("asistente.messageLabel")}
      </label>
      <form
        className="asistente__redactor"
        onSubmit={(evento) => {
          evento.preventDefault();
          enviarTexto();
        }}
      >
        <textarea
          id="asistente-cuadro"
          ref={refCuadro}
          className="asistente__cuadro"
          value={borrador}
          rows={1}
          placeholder={t("asistente.placeholder")}
          onChange={(evento) => setBorrador(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === "Enter" && !evento.shiftKey) {
              evento.preventDefault();
              enviarTexto();
            }
          }}
        />
        <div className="asistente__redactor-botones">
          {/* Hueco reservado para el botón de voz (paso 4), a la izquierda de Enviar. */}
          <span className="asistente__hueco-voz" aria-hidden="true" />
          <button
            type="submit"
            className="boton-principal"
            disabled={!borrador.trim() || esperando}
          >
            {t("asistente.send")}
          </button>
        </div>
      </form>
    </main>
  );
}
