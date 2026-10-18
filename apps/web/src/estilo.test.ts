import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CLAVE_ESTILO,
  aplicarEstilo,
  guardarEstilo,
  leerEstilo,
  useEstilo,
} from "./estilo";

describe("estilo", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.estilo;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    delete document.documentElement.dataset.estilo;
  });

  it("lee 'sobrio' cuando no hay preferencia guardada", () => {
    expect(leerEstilo()).toBe("sobrio");
  });

  it("guarda y vuelve a leer la preferencia", () => {
    guardarEstilo("sereno");
    expect(localStorage.getItem(CLAVE_ESTILO)).toBe("sereno");
    expect(leerEstilo()).toBe("sereno");

    guardarEstilo("sobrio");
    expect(leerEstilo()).toBe("sobrio");
  });

  it("ignora un valor inválido en localStorage", () => {
    localStorage.setItem(CLAVE_ESTILO, "barroco");
    expect(leerEstilo()).toBe("sobrio");
  });

  it("aplica el estilo en data-estilo", () => {
    aplicarEstilo("sereno");
    expect(document.documentElement.dataset.estilo).toBe("sereno");
  });

  it("aplica y persiste el estilo al cambiarlo", () => {
    const { result } = renderHook(() => useEstilo());

    expect(result.current.estilo).toBe("sobrio");
    expect(document.documentElement.dataset.estilo).toBe("sobrio");

    act(() => result.current.cambiarEstilo("sereno"));
    expect(result.current.estilo).toBe("sereno");
    expect(document.documentElement.dataset.estilo).toBe("sereno");
    expect(localStorage.getItem(CLAVE_ESTILO)).toBe("sereno");
  });

  it("sincroniza dos usos del hook", () => {
    const primero = renderHook(() => useEstilo());
    const segundo = renderHook(() => useEstilo());

    act(() => primero.result.current.cambiarEstilo("sereno"));

    expect(primero.result.current.estilo).toBe("sereno");
    expect(segundo.result.current.estilo).toBe("sereno");
  });

  it("reacciona al cambio de estilo en otra pestaña", () => {
    const { result } = renderHook(() => useEstilo());

    localStorage.setItem(CLAVE_ESTILO, "sereno");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: CLAVE_ESTILO, newValue: "sereno" }),
      );
    });

    expect(result.current.estilo).toBe("sereno");
    expect(document.documentElement.dataset.estilo).toBe("sereno");
  });
});
