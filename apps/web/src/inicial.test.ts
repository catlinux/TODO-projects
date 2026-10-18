import { describe, expect, it } from "vitest";

import { INICIAL_POR_DEFECTO, inicial } from "./inicial";

describe("inicial", () => {
  it("toma la primera letra ignorando signos y espacios", () => {
    expect(inicial("[Prueba] Viaje")).toBe("P");
    expect(inicial("  ¿Qué?")).toBe("Q");
  });

  it("acepta dígitos", () => {
    expect(inicial("123")).toBe("1");
  });

  it("respeta la eñe y las mayúsculas del castellano", () => {
    expect(inicial("ñandú")).toBe("Ñ");
  });

  it("devuelve el símbolo por defecto sin letras ni dígitos", () => {
    expect(inicial("[]")).toBe(INICIAL_POR_DEFECTO);
    expect(inicial("   ")).toBe(INICIAL_POR_DEFECTO);
    expect(inicial("")).toBe(INICIAL_POR_DEFECTO);
  });
});
