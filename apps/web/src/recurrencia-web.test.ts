import { describe, expect, it } from "vitest";

import {
  aIsoUtc,
  aValorLocal,
  analizarRegla,
  construirRegla,
  DIAS_SEMANA,
  formatearFechaHoraEs,
  recurrenciaPorDefecto,
  type DatosRecurrencia,
} from "./recurrencia-web";

describe("construirRegla", () => {
  it("devuelve null sin recurrencia", () => {
    expect(construirRegla(recurrenciaPorDefecto())).toBeNull();
  });

  it("construye una regla diaria", () => {
    const regla = construirRegla({
      frecuencia: "diaria",
      intervalo: 1,
      dias: [],
      fin: { tipo: "nunca" },
    });
    expect(regla).toBe("FREQ=DAILY");
  });

  it("construye una regla semanal con intervalo, días y fin", () => {
    const regla = construirRegla({
      frecuencia: "semanal",
      intervalo: 2,
      dias: ["MO", "WE"],
      fin: { tipo: "veces", veces: 10 },
    });
    expect(regla).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10");
  });

  it("construye una regla mensual y anual", () => {
    expect(
      construirRegla({
        frecuencia: "mensual",
        intervalo: 3,
        dias: [],
        fin: { tipo: "nunca" },
      }),
    ).toBe("FREQ=MONTHLY;INTERVAL=3");

    expect(
      construirRegla({
        frecuencia: "anual",
        intervalo: 1,
        dias: [],
        fin: { tipo: "veces", veces: 5 },
      }),
    ).toBe("FREQ=YEARLY;COUNT=5");
  });

  it("normaliza los días al orden canónico", () => {
    const regla = construirRegla({
      frecuencia: "semanal",
      intervalo: 1,
      dias: ["WE", "MO"],
      fin: { tipo: "nunca" },
    });
    expect(regla).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
  });
});

describe("analizarRegla", () => {
  it("devuelve el valor por defecto sin regla", () => {
    expect(analizarRegla(null)).toEqual(recurrenciaPorDefecto());
    expect(analizarRegla("")).toEqual(recurrenciaPorDefecto());
  });

  it("hace ida y vuelta con las reglas soportadas", () => {
    const casos: DatosRecurrencia[] = [
      { frecuencia: "diaria", intervalo: 1, dias: [], fin: { tipo: "nunca" } },
      {
        frecuencia: "semanal",
        intervalo: 2,
        dias: ["MO", "WE"],
        fin: { tipo: "veces", veces: 10 },
      },
      { frecuencia: "semanal", intervalo: 1, dias: [], fin: { tipo: "nunca" } },
      { frecuencia: "mensual", intervalo: 3, dias: [], fin: { tipo: "nunca" } },
      { frecuencia: "anual", intervalo: 1, dias: [], fin: { tipo: "veces", veces: 5 } },
    ];

    for (const caso of casos) {
      const regla = construirRegla(caso);
      expect(analizarRegla(regla)).toEqual(caso);
    }
  });

  it("ignora UNTIL y conserva el resto", () => {
    const datos = analizarRegla("FREQ=WEEKLY;UNTIL=20261231T000000Z;BYDAY=MO;INTERVAL=2");
    expect(datos).toEqual({
      frecuencia: "semanal",
      intervalo: 2,
      dias: ["MO"],
      fin: { tipo: "nunca" },
    });
  });

  it("ignora partes desconocidas", () => {
    const datos = analizarRegla("FREQ=DAILY;WKST=MO;COUNT=4");
    expect(datos).toEqual({
      frecuencia: "diaria",
      intervalo: 1,
      dias: [],
      fin: { tipo: "veces", veces: 4 },
    });
  });

  it("expone los días de la semana disponibles", () => {
    expect(DIAS_SEMANA).toEqual(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
  });
});

describe("conversión con datetime-local", () => {
  it("convierte hora local de verano a ISO UTC", () => {
    expect(aIsoUtc("2026-05-10T10:00")).toBe("2026-05-10T08:00:00.000Z");
  });

  it("convierte hora local de invierno a ISO UTC", () => {
    expect(aIsoUtc("2026-01-10T10:00")).toBe("2026-01-10T09:00:00.000Z");
  });

  it("convierte ISO UTC a hora local", () => {
    expect(aValorLocal("2026-05-10T08:00:00.000Z")).toBe("2026-05-10T10:00");
    expect(aValorLocal("2026-01-10T09:00:00.000Z")).toBe("2026-01-10T10:00");
  });

  it("devuelve vacío o null con valores ausentes o inválidos", () => {
    expect(aIsoUtc("")).toBeNull();
    expect(aIsoUtc("no-es-fecha")).toBeNull();
    expect(aValorLocal(null)).toBe("");
    expect(aValorLocal("no-es-fecha")).toBe("");
    expect(formatearFechaHoraEs(null)).toBe("");
  });

  it("formatea una fecha en formato es-ES", () => {
    const texto = formatearFechaHoraEs("2026-05-10T08:00:00.000Z");
    expect(texto).toContain("10/5/26");
    expect(texto).toContain("10:00");
  });
});
