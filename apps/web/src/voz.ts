import { useCallback, useEffect, useRef, useState } from "react";

/** Estados del dictado: parado, escuchando o con un error que mostrar. */
export type EstadoVoz = "idle" | "escuchando" | "error";

/** Motivos de error del reconocimiento, traducibles en la interfaz. */
export type CodigoErrorVoz =
  | "denegado"
  | "sin-voz"
  | "red"
  | "ocupado"
  | "idioma"
  | "desconocido";

/** Idiomas que ofrece el selector de voz. */
export const IDIOMAS_VOZ = ["es-ES", "ca-ES", "en-US"] as const;
export type IdiomaVoz = (typeof IDIOMAS_VOZ)[number];
export const IDIOMA_VOZ_POR_DEFECTO: IdiomaVoz = "es-ES";

const CLAVE_IDIOMA = "todo-asistente-voz-idioma";
const CLAVE_ENVIO_AUTOMATICO = "todo-asistente-voz-envio";

/**
 * Silencio seguido (en milisegundos) que cierra la escucha. Una pausa para
 * pensar no corta el dictado: solo lo hace este silencio largo. Cada resultado,
 * parcial o final, reinicia la cuenta.
 */
export const SILENCIO_FIN_MS = 5000;

/**
 * Reinicios seguidos del reconocimiento sin ningún resultado nuevo antes de
 * darse por vencido. Chrome puede cerrar la sesión por su cuenta (tiempo
 * máximo, red); hay que relanzarla conservando lo dictado, pero sin bucle.
 */
const MAX_REINICIOS_SEGUIDOS = 5;

export function esIdiomaVoz(valor: unknown): valor is IdiomaVoz {
  return typeof valor === "string" && (IDIOMAS_VOZ as readonly string[]).includes(valor);
}

export function leerIdiomaVoz(): IdiomaVoz {
  try {
    const guardado = localStorage.getItem(CLAVE_IDIOMA);
    return esIdiomaVoz(guardado) ? guardado : IDIOMA_VOZ_POR_DEFECTO;
  } catch {
    return IDIOMA_VOZ_POR_DEFECTO;
  }
}

export function guardarIdiomaVoz(idioma: IdiomaVoz): void {
  try {
    localStorage.setItem(CLAVE_IDIOMA, idioma);
  } catch {
    // Almacenamiento no disponible: la próxima visita usará el idioma por defecto.
  }
}

export function leerEnvioAutomatico(): boolean {
  try {
    return localStorage.getItem(CLAVE_ENVIO_AUTOMATICO) === "1";
  } catch {
    return false;
  }
}

export function guardarEnvioAutomatico(activo: boolean): void {
  try {
    localStorage.setItem(CLAVE_ENVIO_AUTOMATICO, activo ? "1" : "0");
  } catch {
    // Almacenamiento no disponible: la preferencia no se conserva.
  }
}

/** Une dos fragmentos con un solo espacio, sin dejar espacios de sobra. */
export function unirTexto(previo: string, nuevo: string): string {
  const izquierda = previo.trimEnd();
  const derecha = nuevo.trim();
  if (!izquierda) return derecha;
  if (!derecha) return izquierda;
  return `${izquierda} ${derecha}`;
}

type ConstructorReconocimiento = new () => SpeechRecognition;

function constructorReconocimiento(): ConstructorReconocimiento | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/** ¿Este navegador sabe reconocer voz? Si no, el botón no debe pintarse. */
export function soportaVoz(): boolean {
  return constructorReconocimiento() !== null;
}

function codigoDeError(error: string): CodigoErrorVoz | "abortado" {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "denegado";
    case "no-speech":
      return "sin-voz";
    case "network":
      return "red";
    case "audio-capture":
      return "ocupado";
    case "language-not-supported":
      return "idioma";
    case "aborted":
      return "abortado";
    default:
      return "desconocido";
  }
}

/** Texto reconocido en la escucha en curso. */
export interface TextoDictado {
  /** Texto final acumulado en toda la escucha, aunque el navegador la reinicie. */
  final: string;
  /** Texto parcial que se está oyendo ahora y aún no es final. */
  parcial: string;
}

export interface OpcionesReconocimientoVoz {
  /** Idioma del reconocimiento, por ejemplo `es-ES`. */
  idioma: string;
  /**
   * Recibe lo reconocido en la sesión: el final acumulado y el parcial en curso.
   * Quien lo use compone con el texto previo del cuadro.
   */
  alTexto: (texto: TextoDictado) => void;
  /**
   * Se llama una sola vez al cerrar la escucha (el usuario o el silencio) con el
   * texto final acumulado. No se llama si el cierre es por un error irrecuperable.
   */
  alTerminar?: (textoFinal: string) => void;
  /** Aviso opcional del error, además del campo `error` que devuelve el hook. */
  alError?: (codigo: CodigoErrorVoz) => void;
}

export interface ReconocimientoVoz {
  estado: EstadoVoz;
  error: CodigoErrorVoz | null;
  empezar: () => void;
  detener: () => void;
  alternar: () => void;
}

/**
 * Envuelve `SpeechRecognition` con el estado del dictado. Escucha de forma
 * continua, acumula los resultados finales de toda la sesión (sin duplicarlos
 * si el navegador reinicia el reconocimiento), cierra por silencio largo o a
 * petición del usuario, y cancela el reconocimiento al desmontar.
 */
export function useReconocimientoVoz({
  idioma,
  alTexto,
  alTerminar,
  alError,
}: OpcionesReconocimientoVoz): ReconocimientoVoz {
  const [estado, setEstado] = useState<EstadoVoz>("idle");
  const [error, setError] = useState<CodigoErrorVoz | null>(null);

  const reconocimientoRef = useRef<SpeechRecognition | null>(null);
  const montadoRef = useRef(true);
  /** Índices ya entregados como finales en la sesión actual del navegador. */
  const finalesRef = useRef<Set<number>>(new Set());
  /** Texto final acumulado: sobrevive a los reinicios del navegador. */
  const textoFinalRef = useRef("");
  /** El usuario sigue queriendo escuchar hasta que la escucha se cierra. */
  const activoRef = useRef(false);
  /** Estamos cerrando a propósito: el siguiente `onend` cierra la escucha. */
  const cerrandoRef = useRef(false);
  /** Reinicios seguidos sin resultados nuevos (tope anti-bucle). */
  const reiniciosRef = useRef(0);
  /** Error recuperable pendiente de mostrar si se agotan los reinicios. */
  const errorPendienteRef = useRef<CodigoErrorVoz | null>(null);
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idiomaRef = useRef(idioma);
  const alTextoRef = useRef(alTexto);
  const alTerminarRef = useRef(alTerminar);
  const alErrorRef = useRef(alError);
  idiomaRef.current = idioma;
  alTextoRef.current = alTexto;
  alTerminarRef.current = alTerminar;
  alErrorRef.current = alError;

  const limpiarTemporizador = useCallback(() => {
    if (temporizadorRef.current !== null) {
      clearTimeout(temporizadorRef.current);
      temporizadorRef.current = null;
    }
  }, []);

  /** Cierra la escucha: avisa del texto final y vuelve a «parado». */
  const cerrar = useCallback(() => {
    activoRef.current = false;
    cerrandoRef.current = false;
    errorPendienteRef.current = null;
    limpiarTemporizador();
    reconocimientoRef.current = null;
    if (montadoRef.current) setEstado("idle");
    alTerminarRef.current?.(textoFinalRef.current);
  }, [limpiarTemporizador]);

  /** Pide al navegador que pare; el cierre real ocurre en `onend`. */
  const pedirParada = useCallback(() => {
    const reconocimiento = reconocimientoRef.current;
    if (!reconocimiento) {
      cerrar();
      return;
    }
    cerrandoRef.current = true;
    limpiarTemporizador();
    try {
      reconocimiento.stop();
    } catch {
      // Ya estaba parado: `onend` cerrará la escucha igualmente.
    }
  }, [cerrar, limpiarTemporizador]);

  /** Reinicia la cuenta del silencio; cada resultado, parcial o final, la reinicia. */
  const reiniciarSilencio = useCallback(() => {
    limpiarTemporizador();
    temporizadorRef.current = setTimeout(() => {
      temporizadorRef.current = null;
      pedirParada();
    }, SILENCIO_FIN_MS);
  }, [limpiarTemporizador, pedirParada]);

  /** Error irrecuperable: para la escucha y lo muestra. */
  const fallar = useCallback(
    (codigo: CodigoErrorVoz) => {
      activoRef.current = false;
      cerrandoRef.current = false;
      errorPendienteRef.current = null;
      limpiarTemporizador();
      reconocimientoRef.current = null;
      if (!montadoRef.current) return;
      setError(codigo);
      setEstado("error");
      alErrorRef.current?.(codigo);
    },
    [limpiarTemporizador],
  );

  const arrancarRef = useRef<() => void>(() => undefined);

  /** Crea el reconocimiento continuo y lo arranca (también tras un reinicio). */
  const arrancar = useCallback(() => {
    const Constructor = constructorReconocimiento();
    if (!Constructor) return;

    const reconocimiento = new Constructor();
    reconocimiento.lang = idiomaRef.current;
    reconocimiento.continuous = true;
    reconocimiento.interimResults = true;
    reconocimiento.maxAlternatives = 1;
    finalesRef.current = new Set();

    reconocimiento.onresult = (evento) => {
      reiniciosRef.current = 0;
      errorPendienteRef.current = null;
      reiniciarSilencio();
      let parcial = "";
      for (let i = 0; i < evento.results.length; i += 1) {
        const resultado = evento.results[i];
        if (!resultado) continue;
        const texto = resultado[0]?.transcript ?? "";
        if (resultado.isFinal) {
          if (finalesRef.current.has(i)) continue;
          finalesRef.current.add(i);
          textoFinalRef.current = unirTexto(textoFinalRef.current, texto);
        } else {
          parcial = unirTexto(parcial, texto);
        }
      }
      alTextoRef.current({ final: textoFinalRef.current, parcial });
    };

    reconocimiento.onerror = (evento) => {
      const codigo = codigoDeError(evento.error);
      // «aborted» es la cancelación que provocamos nosotros (parar o desmontar).
      if (codigo === "abortado") return;
      // «sin voz» y «red» se pueden reintentar: que decidan el reinicio (o el
      // silencio). Solo si se agotan los reintentos se muestra el error.
      if (codigo === "sin-voz" || codigo === "red") {
        errorPendienteRef.current = codigo;
        return;
      }
      fallar(codigo);
    };

    reconocimiento.onend = () => {
      reconocimientoRef.current = null;
      if (!activoRef.current) return;
      if (cerrandoRef.current) {
        cerrar();
        return;
      }
      // El navegador cerró la sesión por su cuenta: relánzala sin perder texto.
      reiniciosRef.current += 1;
      if (reiniciosRef.current > MAX_REINICIOS_SEGUIDOS) {
        const pendiente = errorPendienteRef.current;
        if (pendiente) fallar(pendiente);
        else cerrar();
        return;
      }
      arrancarRef.current();
    };

    reconocimientoRef.current = reconocimiento;
    try {
      reconocimiento.start();
    } catch {
      fallar("desconocido");
    }
  }, [cerrar, fallar, reiniciarSilencio]);

  arrancarRef.current = arrancar;

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      activoRef.current = false;
      limpiarTemporizador();
      const reconocimiento = reconocimientoRef.current;
      reconocimientoRef.current = null;
      if (!reconocimiento) return;
      reconocimiento.onresult = null;
      reconocimiento.onerror = null;
      reconocimiento.onend = null;
      try {
        reconocimiento.abort();
      } catch {
        // Ya había terminado: no hay nada que cancelar.
      }
    };
  }, [limpiarTemporizador]);

  useEffect(() => {
    const reconocimiento = reconocimientoRef.current;
    if (reconocimiento) reconocimiento.lang = idioma;
  }, [idioma]);

  const empezar = useCallback(() => {
    if (activoRef.current) return;
    if (!constructorReconocimiento()) return;
    activoRef.current = true;
    cerrandoRef.current = false;
    textoFinalRef.current = "";
    reiniciosRef.current = 0;
    errorPendienteRef.current = null;
    finalesRef.current = new Set();
    setError(null);
    setEstado("escuchando");
    arrancar();
    // Si `arrancar` no pudo empezar, ya no hay escucha a la que poner silencio.
    if (activoRef.current) reiniciarSilencio();
  }, [arrancar, reiniciarSilencio]);

  const detener = useCallback(() => {
    if (!activoRef.current) return;
    pedirParada();
  }, [pedirParada]);

  const alternar = useCallback(() => {
    if (activoRef.current) detener();
    else empezar();
  }, [empezar, detener]);

  return { estado, error, empezar, detener, alternar };
}
