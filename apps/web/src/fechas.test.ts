import { describe, expect, it } from "vitest";

import { chipFecha } from "./fechas";

describe("chipFecha", () => {
  it("devuelve null sin fecha o con una fecha inválida", () => {
    expect(chipFecha(null)).toBeNull();
    expect(chipFecha(undefined)).toBeNull();
    expect(chipFecha("no es una fecha")).toBeNull();
  });

  it("marca como atrasada una tarea ya vencida", () => {
    const ahora = new Date(2026, 9, 18, 12, 0);
    const vencidaHoy = chipFecha(new Date(2026, 9, 18, 9, 0).toISOString(), ahora);
    expect(vencidaHoy).toEqual({ estado: "atrasada", texto: "Hoy 09:00" });

    const ayer = chipFecha(new Date(2026, 9, 17, 10, 30).toISOString(), ahora);
    expect(ayer).toEqual({ estado: "atrasada", texto: "Ayer" });
  });

  it("marca como próxima una tarea que vence en 24 h o menos", () => {
    const ahora = new Date(2026, 9, 18, 12, 0);
    expect(chipFecha(new Date(2026, 9, 18, 18, 30).toISOString(), ahora)).toEqual({
      estado: "proxima",
      texto: "Hoy 18:30",
    });
    expect(chipFecha(new Date(2026, 9, 19, 10, 0).toISOString(), ahora)).toEqual({
      estado: "proxima",
      texto: "Mañana 10:00",
    });
    expect(chipFecha(new Date(2026, 9, 19, 12, 0).toISOString(), ahora)).toEqual({
      estado: "proxima",
      texto: "Mañana 12:00",
    });
  });

  it("marca como normal una tarea que vence a más de 24 h", () => {
    const ahora = new Date(2026, 9, 18, 12, 0);
    expect(chipFecha(new Date(2026, 9, 24, 10, 0).toISOString(), ahora)).toEqual({
      estado: "normal",
      texto: "24 oct",
    });
    expect(chipFecha(new Date(2026, 9, 19, 13, 0).toISOString(), ahora)).toEqual({
      estado: "normal",
      texto: "Mañana 13:00",
    });
  });
});
