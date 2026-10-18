import { describe, expect, it } from "vitest";

import {
  PATRONES_PORTADA,
  datosPortadaTarjeta,
  estiloPortada,
  portadaAutomatica,
} from "./portada";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("portadaAutomatica", () => {
  it("es determinista: la misma tarea siempre luce igual", () => {
    expect(portadaAutomatica("tarea-42")).toEqual(portadaAutomatica("tarea-42"));
  });

  it("varía entre tareas distintas", () => {
    const ids = Array.from({ length: 48 }, (_, indice) => `tarea-${indice}`);
    const portadas = ids.map((id) => portadaAutomatica(id));

    expect(new Set(portadas.map((portada) => portada.tono)).size).toBeGreaterThan(1);
    expect(new Set(portadas.map((portada) => portada.angulo)).size).toBeGreaterThan(1);
    expect(new Set(portadas.map((portada) => portada.patron).filter(Boolean)).size).toBeGreaterThan(1);

    // Cada tarea tiene su propia combinación salvo colisiones puntuales del hash.
    expect(new Set(portadas.map((portada) => JSON.stringify(portada))).size).toBeGreaterThan(40);
  });

  it("elige tonos y patrones conocidos con variaciones dentro de rango", () => {
    const patrones = new Set<string>([...PATRONES_PORTADA]);

    for (let indice = 0; indice < 60; indice += 1) {
      const portada = portadaAutomatica(`id-${indice}`);
      expect(portada.tono).toMatch(/^#[0-9a-f]{6}$/i);
      expect(portada.patron === null || patrones.has(portada.patron)).toBe(true);
      expect(portada.angulo).toBeGreaterThanOrEqual(0);
      expect(portada.angulo).toBeLessThan(360);
      expect(portada.x).toMatch(/%$/);
      expect(portada.y).toMatch(/%$/);
    }
  });
});

describe("datosPortadaTarjeta", () => {
  it("genera una portada automática cuando la tarea no tiene portada", () => {
    const datos = datosPortadaTarjeta("t1", null);

    expect(datos.automatica).toBe(true);
    expect(datos.imagen).toBeNull();
    expect(datos.estilo["--portada-tono"]).toBe(portadaAutomatica("t1").tono);
    expect(String(datos.estilo.backgroundImage)).toContain("color-mix");
    expect(String(datos.estilo.backgroundImage)).toContain("var(--superficie");
  });

  it("respeta la portada guardada de color y de patrón", () => {
    const color = datosPortadaTarjeta("t1", { tipo: "color", valor: "#2563D9" });
    expect(color.automatica).toBe(false);
    expect(color.estilo["--portada-tono"]).toBe("#2563D9");
    expect(color.patron).toBeNull();

    const patron = datosPortadaTarjeta("t1", { tipo: "color", valor: "puntos-rosa" });
    expect(patron.automatica).toBe(false);
    expect(patron.patron).toBe("puntos-rosa");
    expect(String(patron.estilo.backgroundImage)).toContain("radial-gradient");
  });

  it("usa la imagen cuando el id es un uuid", () => {
    const datos = datosPortadaTarjeta("t1", { tipo: "imagen", archivoId: UUID });

    expect(datos.imagen).toBe(`/api/archivos/${UUID}`);
    expect(datos.automatica).toBe(false);
    expect(datos.estilo).toEqual({});
  });

  it("cae a la portada automática si la imagen no es válida", () => {
    const datos = datosPortadaTarjeta("t1", { tipo: "imagen", archivoId: "a1" });

    expect(datos.imagen).toBeNull();
    expect(datos.automatica).toBe(true);
  });
});

describe("estiloPortada", () => {
  it("pinta las portadas guardadas con mezclas suaves del tono y la superficie", () => {
    const color = estiloPortada({ tipo: "color", valor: "#18794E" });
    expect(color?.["--portada-tono"]).toBe("#18794E");
    expect(String(color?.backgroundImage)).toContain("color-mix");
    expect(String(color?.backgroundImage)).toContain("var(--superficie");

    const patron = estiloPortada({ tipo: "color", valor: "rayas-ambar" });
    expect(patron?.["--portada-tono"]).toBe("#B4530A");
    expect(String(patron?.backgroundImage)).toContain("repeating-linear-gradient");

    const imagen = estiloPortada({ tipo: "imagen", archivoId: UUID });
    expect(imagen?.backgroundImage).toBe(`url(/api/archivos/${UUID})`);

    expect(estiloPortada(null)).toBeNull();
  });
});
