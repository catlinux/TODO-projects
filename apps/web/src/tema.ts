import { useCallback, useEffect, useState } from "react";

export type Tema = "claro" | "oscuro" | "sistema";

export const CLAVE_TEMA = "todo.tema";

const CONSULTA_OSCURO = "(prefers-color-scheme: dark)";

function esTema(valor: string | null): valor is Tema {
  return valor === "claro" || valor === "oscuro" || valor === "sistema";
}

/** Lee la preferencia guardada; si falta o no es válida, devuelve "sistema". */
export function leerTema(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE_TEMA);
    return esTema(guardado) ? guardado : "sistema";
  } catch {
    return "sistema";
  }
}

/** Guarda la preferencia; si el almacenamiento no está disponible, no falla. */
export function guardarTema(tema: Tema): void {
  try {
    localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    // Sin localStorage (modo privado, permisos), el tema se aplica igual.
  }
}

/** Tema del sistema según `prefers-color-scheme`. */
export function temaDelSistema(): "claro" | "oscuro" {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(CONSULTA_OSCURO).matches
  ) {
    return "oscuro";
  }
  return "claro";
}

/** Resuelve "sistema" al tema efectivo; el resto se devuelve tal cual. */
export function temaResuelto(tema: Tema): "claro" | "oscuro" {
  return tema === "sistema" ? temaDelSistema() : tema;
}

/** Aplica el tema efectivo en el elemento raíz mediante `data-tema`. */
export function aplicarTema(resuelto: "claro" | "oscuro"): void {
  document.documentElement.dataset.tema = resuelto;
}

/**
 * Gestiona la preferencia de tema: la guarda, la aplica en `data-tema` y, cuando
 * es "sistema", sigue los cambios de `prefers-color-scheme`.
 */
export function useTema() {
  const [tema, setTema] = useState<Tema>(() => leerTema());

  useEffect(() => {
    aplicarTema(temaResuelto(tema));

    if (tema !== "sistema" || typeof window.matchMedia !== "function") {
      return;
    }

    const consulta = window.matchMedia(CONSULTA_OSCURO);
    const alCambiar = () => aplicarTema(consulta.matches ? "oscuro" : "claro");
    consulta.addEventListener("change", alCambiar);
    return () => consulta.removeEventListener("change", alCambiar);
  }, [tema]);

  const cambiarTema = useCallback((nuevo: Tema) => {
    setTema(nuevo);
    guardarTema(nuevo);
  }, []);

  return { tema, cambiarTema };
}
