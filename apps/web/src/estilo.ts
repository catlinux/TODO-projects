import { useCallback, useEffect, useState } from "react";

export type Estilo = "sobrio" | "sereno";

export const CLAVE_ESTILO = "todo.estilo";

/** Estilos disponibles, en el orden en que se muestran. */
export const ESTILOS: readonly Estilo[] = ["sobrio", "sereno"];

function esEstilo(valor: string | null): valor is Estilo {
  return valor === "sobrio" || valor === "sereno";
}

/** Lee la preferencia guardada; si falta o no es válida, devuelve "sobrio". */
export function leerEstilo(): Estilo {
  try {
    const guardado = localStorage.getItem(CLAVE_ESTILO);
    return esEstilo(guardado) ? guardado : "sobrio";
  } catch {
    return "sobrio";
  }
}

/** Guarda la preferencia; si el almacenamiento no está disponible, no falla. */
export function guardarEstilo(estilo: Estilo): void {
  try {
    localStorage.setItem(CLAVE_ESTILO, estilo);
  } catch {
    // Sin localStorage (modo privado, permisos), el estilo se aplica igual.
  }
}

/** Aplica el estilo en el elemento raíz mediante `data-estilo`. */
export function aplicarEstilo(estilo: Estilo): void {
  document.documentElement.dataset.estilo = estilo;
}

// `useEstilo` vive en varios componentes (Ajustes y paleta); los cambios se avisan
// para que todos muestren la misma preferencia, como en `useTema`.
const oyentesEstilo = new Set<(estilo: Estilo) => void>();

/** Gestiona la preferencia de estilo: la guarda y la aplica en `data-estilo`. */
export function useEstilo() {
  const [estilo, setEstilo] = useState<Estilo>(() => leerEstilo());

  useEffect(() => {
    const oyente = (nuevo: Estilo) => setEstilo(nuevo);
    oyentesEstilo.add(oyente);
    return () => {
      oyentesEstilo.delete(oyente);
    };
  }, []);

  useEffect(() => {
    aplicarEstilo(estilo);
  }, [estilo]);

  // En otra pestaña el estilo cambia sin pasar por este hook: se relee al recibir
  // el evento `storage`.
  useEffect(() => {
    const alCambiarAlmacen = (evento: StorageEvent) => {
      if (evento.key !== null && evento.key !== CLAVE_ESTILO) return;
      setEstilo(leerEstilo());
    };
    window.addEventListener("storage", alCambiarAlmacen);
    return () => window.removeEventListener("storage", alCambiarAlmacen);
  }, []);

  const cambiarEstilo = useCallback((nuevo: Estilo) => {
    setEstilo(nuevo);
    guardarEstilo(nuevo);
    oyentesEstilo.forEach((oyente) => oyente(nuevo));
  }, []);

  return { estilo, cambiarEstilo };
}
