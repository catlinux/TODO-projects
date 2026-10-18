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

export interface OpcionesReconocimientoVoz {
  /** Idioma del reconocimiento, por ejemplo `es-ES`. */
  idioma: string;
  /**
   * Recibe lo reconocido: el texto parcial mientras se habla y, al cerrarse una
   * frase, el texto final. Son incrementos desde la última llamada final, no el
   * texto completo, para que quien los use los vaya añadiendo.
   */
  alTexto: (texto: string, esFinal: boolean) => void;
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
 * Envuelve `SpeechRecognition` con el estado del dictado. Cancela el
 * reconocimiento al desmontar y no vuelve a avisar después de hacerlo.
 */
export function useReconocimientoVoz({
  idioma,
  alTexto,
  alError,
}: OpcionesReconocimientoVoz): ReconocimientoVoz {
  const [estado, setEstado] = useState<EstadoVoz>("idle");
  const [error, setError] = useState<CodigoErrorVoz | null>(null);

  const reconocimientoRef = useRef<SpeechRecognition | null>(null);
  const montadoRef = useRef(true);
  /** Índices de resultado ya entregados como finales en la sesión actual. */
  const finalesRef = useRef<Set<number>>(new Set());
  const idiomaRef = useRef(idioma);
  const alTextoRef = useRef(alTexto);
  const alErrorRef = useRef(alError);
  idiomaRef.current = idioma;
  alTextoRef.current = alTexto;
  alErrorRef.current = alError;

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
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
  }, []);

  useEffect(() => {
    const reconocimiento = reconocimientoRef.current;
    if (reconocimiento) reconocimiento.lang = idioma;
  }, [idioma]);

  const empezar = useCallback(() => {
    if (reconocimientoRef.current) return;
    const Constructor = constructorReconocimiento();
    if (!Constructor) return;

    const reconocimiento = new Constructor();
    reconocimiento.lang = idiomaRef.current;
    reconocimiento.continuous = false;
    reconocimiento.interimResults = true;
    reconocimiento.maxAlternatives = 1;
    finalesRef.current = new Set();

    reconocimiento.onresult = (evento) => {
      let final = "";
      let parcial = "";
      for (let i = evento.resultIndex; i < evento.results.length; i += 1) {
        if (finalesRef.current.has(i)) continue;
        const resultado = evento.results[i];
        if (!resultado) continue;
        const texto = resultado[0]?.transcript ?? "";
        if (resultado.isFinal) {
          finalesRef.current.add(i);
          final += texto;
        } else {
          parcial += texto;
        }
      }
      if (final) alTextoRef.current(final, true);
      if (parcial) alTextoRef.current(parcial, false);
    };

    reconocimiento.onerror = (evento) => {
      const codigo = codigoDeError(evento.error);
      // «aborted» es la cancelación que provocamos nosotros (parar o desmontar).
      if (codigo === "abortado") return;
      reconocimientoRef.current = null;
      if (!montadoRef.current) return;
      setError(codigo);
      setEstado("error");
      alErrorRef.current?.(codigo);
    };

    reconocimiento.onend = () => {
      reconocimientoRef.current = null;
      if (montadoRef.current) setEstado("idle");
    };

    reconocimientoRef.current = reconocimiento;
    try {
      reconocimiento.start();
    } catch {
      reconocimientoRef.current = null;
      setError("desconocido");
      setEstado("error");
      return;
    }
    setError(null);
    setEstado("escuchando");
  }, []);

  const detener = useCallback(() => {
    const reconocimiento = reconocimientoRef.current;
    if (!reconocimiento) return;
    try {
      reconocimiento.stop();
    } catch {
      // Ya estaba detenido.
    }
  }, []);

  const alternar = useCallback(() => {
    if (reconocimientoRef.current) detener();
    else empezar();
  }, [empezar, detener]);

  return { estado, error, empezar, detener, alternar };
}
