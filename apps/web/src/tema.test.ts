import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CLAVE_TEMA,
  guardarTema,
  leerTema,
  temaDelSistema,
  temaResuelto,
  useTema,
} from "./tema";

interface MatchMediaSimulado {
  cambiar: (oscuro: boolean) => void;
}

/** Sustituye `window.matchMedia` por una consulta oscura controlable. */
function simularMatchMedia(inicialOscuro: boolean): MatchMediaSimulado {
  const oyentes = new Set<() => void>();
  let oscuro = inicialOscuro;

  const consulta = {
    get matches() {
      return oscuro;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_tipo: string, oyente: () => void) => {
      oyentes.add(oyente);
    },
    removeEventListener: (_tipo: string, oyente: () => void) => {
      oyentes.delete(oyente);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  };

  window.matchMedia = (() => consulta) as unknown as typeof window.matchMedia;

  return {
    cambiar(valor: boolean) {
      oscuro = valor;
      oyentes.forEach((oyente) => oyente());
    },
  };
}

const matchMediaOriginal = window.matchMedia;

describe("tema", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.tema;
  });

  afterEach(() => {
    window.matchMedia = matchMediaOriginal;
    localStorage.clear();
    delete document.documentElement.dataset.tema;
  });

  it("lee 'sistema' cuando no hay preferencia guardada", () => {
    expect(leerTema()).toBe("sistema");
  });

  it("guarda y vuelve a leer la preferencia", () => {
    guardarTema("oscuro");
    expect(localStorage.getItem(CLAVE_TEMA)).toBe("oscuro");
    expect(leerTema()).toBe("oscuro");

    guardarTema("claro");
    expect(leerTema()).toBe("claro");
  });

  it("ignora un valor inválido en localStorage", () => {
    localStorage.setItem(CLAVE_TEMA, "turquesa");
    expect(leerTema()).toBe("sistema");
  });

  it("resuelve 'sistema' con matchMedia simulado", () => {
    simularMatchMedia(true);
    expect(temaDelSistema()).toBe("oscuro");
    expect(temaResuelto("sistema")).toBe("oscuro");
    expect(temaResuelto("claro")).toBe("claro");
    expect(temaResuelto("oscuro")).toBe("oscuro");
  });

  it("aplica el tema y lo persiste al cambiarlo", () => {
    simularMatchMedia(false);
    const { result } = renderHook(() => useTema());

    expect(result.current.tema).toBe("sistema");
    expect(document.documentElement.dataset.tema).toBe("claro");

    act(() => result.current.cambiarTema("oscuro"));
    expect(document.documentElement.dataset.tema).toBe("oscuro");
    expect(localStorage.getItem(CLAVE_TEMA)).toBe("oscuro");
  });

  it("sigue los cambios del sistema mientras el tema es 'sistema'", () => {
    const media = simularMatchMedia(false);
    localStorage.setItem(CLAVE_TEMA, "sistema");
    renderHook(() => useTema());

    expect(document.documentElement.dataset.tema).toBe("claro");

    act(() => media.cambiar(true));
    expect(document.documentElement.dataset.tema).toBe("oscuro");
  });
});
