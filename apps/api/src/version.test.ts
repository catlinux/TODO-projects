import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { VERSION } from "./version.js";

describe("VERSION", () => {
  it("coincide con el archivo VERSION de la raíz", () => {
    const esperada = readFileSync(new URL("../../../VERSION", import.meta.url), "utf8").trim();
    expect(VERSION).toBe(esperada);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
