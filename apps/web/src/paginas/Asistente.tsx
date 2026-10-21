import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  ACEPTAR_ARCHIVOS,
  MAX_ADJUNTOS,
  MAX_CARACTERES_ADJUNTO,
  MAX_CARACTERES_CHAT_ASISTENTE,
  MAX_CARACTERES_MENSAJE_ASISTENTE,
  MAX_MENSAJES_CHAT_ASISTENTE,
  componerPeticion,
  contarCaracteres,
  formatearTamano,
  leerAdjunto,
  type AdjuntoChat,
  type MotivoRechazo,
} from "../adjuntos-chat";
import {
  ErrorHttp,
  peticion,
  type AccionAsistenteApi,
  type RespuestaChatAsistenteApi,
} from "../api";
import { BotonVoz } from "../componentes/BotonVoz";
import { TextoAsistente } from "../markdown";

/** Clave de la conversación en `sessionStorage`; se pierde al cerrar la pestaña. */
const CLAVE_CONVERSACION = "todo-asistente-conversacion";

/** Tope de mensajes que se envían al servidor (el servidor no guarda historial). */
const MAX_HISTORIAL = MAX_MENSAJES_CHAT_ASISTENTE;

/** A partir de este porcentaje del límite se muestra el contador de caracteres. */
const UMBRAL_CONTADOR = 0.8;

const EJEMPLOS = ["crearTarea", "semana", "proyectos"] as const;

interface Mensaje {
  id: string;
  rol: "user" | "assistant";
  texto: string;
  /** Metadatos de los archivos; su contenido viaja dentro de la petición. */
  adjuntos?: AdjuntoChat[];
  acciones?: AccionAsistenteApi[];
}

/** La conversación y su id estable viven juntos en `sessionStorage`. */
interface Conversacion {
  conversacionId: string;
  mensajes: Mensaje[];
}

interface ErrorChat {
  texto: string;
  status: number | null;
  /** ¿Tiene sentido volver a enviar el último mensaje? */
  recurrible: boolean;
}

function esAdjunto(valor: unknown): valor is AdjuntoChat {
  if (typeof valor !== "object" || valor === null) return false;
  const adjunto = valor as {
    id?: unknown;
    nombre?: unknown;
    tamano?: unknown;
    contenido?: unknown;
  };
  return (
    typeof adjunto.id === "string" &&
    typeof adjunto.nombre === "string" &&
    typeof adjunto.tamano === "number" &&
    typeof adjunto.contenido === "string"
  );
}

function esMensaje(valor: unknown): valor is Mensaje {
  if (typeof valor !== "object" || valor === null) return false;
  const mensaje = valor as { id?: unknown; rol?: unknown; texto?: unknown; adjuntos?: unknown };
  return (
    typeof mensaje.id === "string" &&
    (mensaje.rol === "user" || mensaje.rol === "assistant") &&
    typeof mensaje.texto === "string" &&
    (mensaje.adjuntos === undefined ||
      (Array.isArray(mensaje.adjuntos) && mensaje.adjuntos.every(esAdjunto)))
  );
}

function cargarConversacion(): Conversacion {
  try {
    const bruto = sessionStorage.getItem(CLAVE_CONVERSACION);
    if (!bruto) return { conversacionId: nuevoConversacionId(), mensajes: [] };
    const datos: unknown = JSON.parse(bruto);
    // Formato anterior: solo la lista de mensajes, sin id de conversación.
    if (Array.isArray(datos)) {
      return { conversacionId: nuevoConversacionId(), mensajes: datos.filter(esMensaje) };
    }
    if (typeof datos === "object" && datos !== null) {
      const guardada = datos as { conversacionId?: unknown; mensajes?: unknown };
      if (
        typeof guardada.conversacionId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          guardada.conversacionId,
        ) &&
        Array.isArray(guardada.mensajes)
      ) {
        return {
          conversacionId: guardada.conversacionId,
          mensajes: guardada.mensajes.filter(esMensaje),
        };
      }
    }
    return { conversacionId: nuevoConversacionId(), mensajes: [] };
  } catch {
    return { conversacionId: nuevoConversacionId(), mensajes: [] };
  }
}

function guardarConversacion(conversacion: Conversacion): void {
  try {
    sessionStorage.setItem(CLAVE_CONVERSACION, JSON.stringify(conversacion));
    return;
  } catch {
    // Sin espacio: se reintenta guardando los adjuntos sin su contenido.
  }
  try {
    const sinContenido: Conversacion = {
      ...conversacion,
      mensajes: conversacion.mensajes.map((mensaje) =>
        mensaje.adjuntos
          ? {
              ...mensaje,
              adjuntos: mensaje.adjuntos.map((adjunto) => ({
                ...adjunto,
                contenido: "",
                omitido: true,
              })),
            }
          : mensaje,
      ),
    };
    sessionStorage.setItem(CLAVE_CONVERSACION, JSON.stringify(sinContenido));
  } catch {
    // Almacenamiento bloqueado o todavía sin espacio: la conversación no se conserva.
  }
}

function nuevoConversacionId(): string {
  return crypto.randomUUID();
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

function BotonCopiar({ texto }: { texto: string }) {
  const { t } = useTranslation();
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const temporizador = setTimeout(() => setCopiado(false), 2000);
    return () => clearTimeout(temporizador);
  }, [copiado]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      // Sin permiso de portapapeles no hay nada que hacer.
    }
  }

  return (
    <button
      type="button"
      className="boton-fantasma asistente__copiar"
      onClick={() => void copiar()}
    >
      {copiado ? t("asistente.copied") : t("asistente.copy")}
    </button>
  );
}

function IconoClip() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.4 11.6 12.3 20.7a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5" />
    </svg>
  );
}

export default function Asistente() {
  const { t } = useTranslation();
  const cliente = useQueryClient();

  const [conversacion, setConversacion] = useState<Conversacion>(cargarConversacion);
  const { mensajes, conversacionId } = conversacion;
  const [borrador, setBorrador] = useState("");
  const [adjuntos, setAdjuntos] = useState<AdjuntoChat[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [error, setError] = useState<ErrorChat | null>(null);
  const refHilo = useRef<HTMLDivElement>(null);
  const refCuadro = useRef<HTMLTextAreaElement>(null);
  const refArchivos = useRef<HTMLInputElement>(null);

  useEffect(() => {
    guardarConversacion(conversacion);
  }, [conversacion]);

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
      const { mensajes: preparados } = componerPeticion(historial.slice(-MAX_HISTORIAL));
      // Sin timeout propio: el servidor corta a los 240 s y aquí se espera lo que haga falta.
      return peticion<RespuestaChatAsistenteApi>("/asistente/chat", {
        method: "POST",
        body: JSON.stringify({
          conversacionId,
          mensajes: preparados,
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
      setConversacion((actual) => ({ ...actual, mensajes: nuevos }));
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
      setConversacion((actual) => ({ ...actual, mensajes: historial }));
      setError(describirError(err));
    },
  });

  const esperando = enviar.isPending;
  const [esperaProlongada, setEsperaProlongada] = useState(false);

  useEffect(() => {
    if (!esperando) {
      setEsperaProlongada(false);
      return;
    }
    // Las respuestas largas pueden tardar minutos: el plazo lo marca el servidor.
    const temporizador = setTimeout(() => setEsperaProlongada(true), 20_000);
    return () => clearTimeout(temporizador);
  }, [esperando]);
  const caracteres = contarCaracteres(borrador, adjuntos);
  const mostrarContador = caracteres > MAX_CARACTERES_MENSAJE_ASISTENTE * UMBRAL_CONTADOR;
  const superaLimite = caracteres > MAX_CARACTERES_MENSAJE_ASISTENTE;
  const avisoVisible = superaLimite
    ? t("asistente.tooLong", { maximo: MAX_CARACTERES_MENSAJE_ASISTENTE })
    : aviso;

  function mensajeMotivo(motivo: MotivoRechazo, nombre: string): string {
    switch (motivo) {
      case "tipo":
        return t("asistente.attachNotText", { nombre });
      case "grande":
        return t("asistente.attachTooLarge", { nombre, maximo: MAX_CARACTERES_ADJUNTO });
      case "binario":
        return t("asistente.attachBinary", { nombre });
      case "lectura":
        return t("asistente.attachReadError", { nombre });
    }
  }

  async function adjuntarArchivos(seleccion: FileList | File[] | null | undefined) {
    if (!seleccion) return;
    const lista = Array.from(seleccion);
    if (lista.length === 0) return;
    if (lista.length > MAX_ADJUNTOS - adjuntos.length) {
      setAviso(t("asistente.attachTooMany", { maximo: MAX_ADJUNTOS }));
      return;
    }

    const nuevos: AdjuntoChat[] = [];
    const errores: string[] = [];
    for (const archivo of lista) {
      const resultado = await leerAdjunto(archivo);
      if (resultado.ok) {
        nuevos.push(resultado.adjunto);
      } else {
        errores.push(mensajeMotivo(resultado.motivo, archivo.name));
      }
    }

    if (nuevos.length > 0) {
      setAdjuntos((actual) => [...actual, ...nuevos].slice(0, MAX_ADJUNTOS));
    }
    setAviso(errores.length > 0 ? errores.join(" ") : null);
  }

  function quitarAdjunto(id: string) {
    setAdjuntos((actual) => actual.filter((adjunto) => adjunto.id !== id));
    setAviso(null);
  }

  function enviarTexto(textoDictado?: string) {
    const texto = (textoDictado ?? borrador).trim();
    // El dictado con envío automático conserva los adjuntos que ya hubiera.
    const adjuntosEnvio = adjuntos;
    if (esperando || (!texto && adjuntosEnvio.length === 0)) return;

    const mensaje: Mensaje = {
      id: nuevoId(),
      rol: "user",
      texto,
      ...(adjuntosEnvio.length > 0 ? { adjuntos: adjuntosEnvio } : {}),
    };
    const historial = [...mensajes, mensaje];

    if (contarCaracteres(texto, adjuntosEnvio) > MAX_CARACTERES_MENSAJE_ASISTENTE) {
      setAviso(t("asistente.tooLong", { maximo: MAX_CARACTERES_MENSAJE_ASISTENTE }));
      return;
    }
    if (componerPeticion(historial.slice(-MAX_HISTORIAL)).total > MAX_CARACTERES_CHAT_ASISTENTE) {
      setAviso(t("asistente.conversationTooLong", { maximo: MAX_CARACTERES_CHAT_ASISTENTE }));
      return;
    }

    setConversacion((actual) => ({ ...actual, mensajes: historial }));
    setBorrador("");
    setAdjuntos([]);
    setAviso(null);
    setError(null);
    enviar.mutate(historial);
  }

  function reintentar() {
    if (esperando || mensajes.length === 0) return;
    setError(null);
    enviar.mutate(mensajes);
  }

  function nuevaConversacion() {
    setConversacion({ conversacionId: nuevoConversacionId(), mensajes: [] });
    setError(null);
    setBorrador("");
    setAdjuntos([]);
    setAviso(null);
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
            {mensaje.texto.trim() &&
              (mensaje.rol === "assistant" ? (
                <div className="asistente__burbuja asistente__burbuja--texto">
                  <TextoAsistente texto={mensaje.texto} />
                  <BotonCopiar texto={mensaje.texto} />
                </div>
              ) : (
                <p className="asistente__burbuja">{mensaje.texto}</p>
              ))}
            {mensaje.adjuntos && mensaje.adjuntos.length > 0 && (
              <ul
                className="asistente__adjuntos asistente__adjuntos--hilo"
                aria-label={t("asistente.attachmentsLabel")}
              >
                {mensaje.adjuntos.map((adjunto) => (
                  <li key={adjunto.id} className="asistente__adjunto">
                    <span className="asistente__adjunto-nombre">{adjunto.nombre}</span>
                    <span className="cifra">{formatearTamano(adjunto.tamano)}</span>
                  </li>
                ))}
              </ul>
            )}
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
            <p className="asistente__burbuja asistente__pensando">
              {esperaProlongada ? t("asistente.thinkingLong") : t("asistente.thinking")}
            </p>
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
              <button
                type="button"
                className="boton-fantasma"
                onClick={reintentar}
                disabled={esperando}
              >
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
        className={`asistente__redactor${arrastrando ? " asistente__redactor--arrastrando" : ""}`}
        onDragOver={(evento) => {
          evento.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(evento) => {
          evento.preventDefault();
          setArrastrando(false);
          void adjuntarArchivos(evento.dataTransfer.files);
        }}
        onSubmit={(evento) => {
          evento.preventDefault();
          enviarTexto();
        }}
      >
        <input
          ref={refArchivos}
          id="asistente-archivos"
          className="adjuntos__entrada"
          type="file"
          multiple
          accept={ACEPTAR_ARCHIVOS}
          tabIndex={-1}
          aria-label={t("asistente.attachChoose")}
          onChange={(evento) => {
            void adjuntarArchivos(evento.target.files);
            evento.target.value = "";
          }}
        />

        {adjuntos.length > 0 && (
          <ul
            className="asistente__adjuntos asistente__adjuntos--borrador"
            aria-label={t("asistente.attachmentsPending")}
          >
            {adjuntos.map((adjunto) => (
              <li key={adjunto.id} className="asistente__adjunto">
                <span className="asistente__adjunto-nombre">{adjunto.nombre}</span>
                <span className="cifra">{formatearTamano(adjunto.tamano)}</span>
                <button
                  type="button"
                  className="asistente__adjunto-quitar"
                  aria-label={t("asistente.removeAttachment", { nombre: adjunto.nombre })}
                  disabled={esperando}
                  onClick={() => quitarAdjunto(adjunto.id)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}

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

        {mostrarContador && (
          <p
            className={`asistente__contador${superaLimite ? " asistente__contador--excedido" : ""}`}
            role={superaLimite ? "alert" : undefined}
          >
            {t("asistente.counter", {
              usados: caracteres.toLocaleString("es-ES"),
              maximo: MAX_CARACTERES_MENSAJE_ASISTENTE.toLocaleString("es-ES"),
            })}
          </p>
        )}

        {avisoVisible && (
          <p className="asistente__aviso error" role="alert">
            {avisoVisible}
          </p>
        )}

        <div className="asistente__redactor-botones">
          <button
            type="button"
            className="boton-fantasma asistente__clip"
            aria-label={t("asistente.attach")}
            title={t("asistente.attachHint", {
              maximo: MAX_ADJUNTOS,
              caracteres: MAX_CARACTERES_ADJUNTO,
            })}
            disabled={esperando}
            onClick={() => refArchivos.current?.click()}
          >
            <IconoClip />
          </button>
          <BotonVoz
            texto={borrador}
            alCambiarTexto={setBorrador}
            alEnviar={enviarTexto}
            deshabilitado={esperando}
          />
          <button
            type="submit"
            className="boton-principal"
            disabled={(!borrador.trim() && adjuntos.length === 0) || superaLimite || esperando}
          >
            {t("asistente.send")}
          </button>
        </div>
      </form>
    </main>
  );
}
