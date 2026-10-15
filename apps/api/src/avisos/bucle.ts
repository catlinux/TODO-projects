import type { Database } from "../db/index.js";
import type { Canal } from "./canal.js";
import { procesarAvisos } from "./procesar.js";

export interface RegistradorBucle {
  error(...datos: unknown[]): void;
}

export interface OpcionesBucle {
  db: Database;
  canales: Canal[];
  intervaloMs?: number;
  ahora?: () => Date;
  registrar?: RegistradorBucle;
}

export interface BucleAvisos {
  detener(): Promise<void>;
}

const INTERVALO_POR_DEFECTO_MS = 60_000;

/**
 * Ejecuta `procesarAvisos` cada intervalo sin solapar pasadas: la siguiente
 * se programa al terminar la anterior, así una pasada lenta solo retrasa el
 * bucle. Los errores se registran y no lo detienen.
 */
export function iniciarBucleAvisos({
  db,
  canales,
  intervaloMs = INTERVALO_POR_DEFECTO_MS,
  ahora = () => new Date(),
  registrar = console,
}: OpcionesBucle): BucleAvisos {
  let desde = new Date(ahora().getTime() - intervaloMs);
  let detenido = false;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let pasadaEnCurso: Promise<void> | null = null;

  const programar = (): void => {
    if (detenido) {
      return;
    }
    temporizador = setTimeout(() => {
      void ejecutarPasada();
    }, intervaloMs);
  };

  const ejecutarPasada = (): Promise<void> => {
    if (pasadaEnCurso) {
      return pasadaEnCurso;
    }

    pasadaEnCurso = (async () => {
      const inicio = ahora();
      try {
        await procesarAvisos(db, inicio, desde, canales);
      } catch (error) {
        registrar.error("Error en la pasada de avisos", error);
      }
      desde = inicio;
    })();

    void pasadaEnCurso.finally(() => {
      pasadaEnCurso = null;
      programar();
    });

    return pasadaEnCurso;
  };

  programar();

  return {
    async detener(): Promise<void> {
      detenido = true;
      if (temporizador) {
        clearTimeout(temporizador);
        temporizador = null;
      }
      if (pasadaEnCurso) {
        await pasadaEnCurso;
      }
    },
  };
}
