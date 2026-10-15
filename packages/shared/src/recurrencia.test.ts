import { describe, expect, it } from "vitest";

import {
  esReglaRecurrenciaValida,
  esquemaRecurrencia,
  expandirOcurrencias,
} from "./recurrencia.js";

function iso(fecha: Date): string {
  return fecha.toISOString();
}

describe("esquemaRecurrencia", () => {
  it("acepta reglas válidas", () => {
    const validas = [
      "FREQ=DAILY",
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10",
      "FREQ=MONTHLY;INTERVAL=99",
      "FREQ=YEARLY;UNTIL=20301231T235959Z",
      "FREQ=DAILY;INTERVAL=1;COUNT=1000",
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU",
    ];

    for (const regla of validas) {
      expect(esquemaRecurrencia.safeParse(regla).success).toBe(true);
      expect(esReglaRecurrenciaValida(regla)).toBe(true);
    }
  });

  it("rechaza reglas inválidas", () => {
    const invalidas = [
      "",
      "RRULE:FREQ=DAILY",
      "DTSTART=20260101T000000Z;FREQ=DAILY",
      "FREQ=HOURLY",
      "FREQ=DAILY;INTERVAL=0",
      "FREQ=DAILY;INTERVAL=100",
      "FREQ=DAILY;INTERVAL=abc",
      "FREQ=WEEKLY;BYDAY=MO,XX",
      "FREQ=WEEKLY;BYDAY=",
      "FREQ=DAILY;COUNT=0",
      "FREQ=DAILY;COUNT=1001",
      "FREQ=DAILY;COUNT=abc",
      "FREQ=DAILY;UNTIL=20261231",
      "FREQ=DAILY;UNTIL=20261301T000000Z",
      "FREQ=DAILY;COUNT=10;UNTIL=20301231T235959Z",
      "FREQ=DAILY;WKST=MO",
      "FREQ=DAILY;INTERVAL=1;INTERVAL=2",
      "FREQ=DAILY;",
      "FREQ",
      "=DAILY",
      "FREQ=DAILY;;COUNT=2",
    ];

    for (const regla of invalidas) {
      expect(esquemaRecurrencia.safeParse(regla).success).toBe(false);
      expect(esReglaRecurrenciaValida(regla)).toBe(false);
    }
  });
});

describe("expandirOcurrencias", () => {
  it("sin recurrencia devuelve el inicio si cae en el rango", () => {
    const inicio = new Date("2026-05-10T10:00:00.000Z");
    const dentro = expandirOcurrencias(
      { inicio, recurrencia: null },
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-31T23:59:59.000Z"),
    );
    expect(dentro.map(iso)).toEqual(["2026-05-10T10:00:00.000Z"]);

    const fuera = expandirOcurrencias(
      { inicio, recurrencia: null },
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-09T23:59:59.000Z"),
    );
    expect(fuera).toEqual([]);
  });

  it("expande una regla diaria", () => {
    const ocurrencias = expandirOcurrencias(
      { inicio: new Date("2026-05-10T08:00:00.000Z"), recurrencia: "FREQ=DAILY" },
      new Date("2026-05-10T00:00:00.000Z"),
      new Date("2026-05-13T23:59:59.000Z"),
    );
    expect(ocurrencias.map(iso)).toEqual([
      "2026-05-10T08:00:00.000Z",
      "2026-05-11T08:00:00.000Z",
      "2026-05-12T08:00:00.000Z",
      "2026-05-13T08:00:00.000Z",
    ]);
  });

  it("expande una regla semanal con BYDAY e intervalo", () => {
    const ocurrencias = expandirOcurrencias(
      {
        inicio: new Date("2026-03-02T08:00:00.000Z"),
        recurrencia: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5",
      },
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-04-30T23:59:59.000Z"),
    );
    expect(ocurrencias.map(iso)).toEqual([
      "2026-03-02T08:00:00.000Z",
      "2026-03-04T08:00:00.000Z",
      "2026-03-16T08:00:00.000Z",
      "2026-03-18T08:00:00.000Z",
      "2026-03-30T08:00:00.000Z",
    ]);
  });

  it("expande una regla mensual", () => {
    const ocurrencias = expandirOcurrencias(
      { inicio: new Date("2026-01-15T09:00:00.000Z"), recurrencia: "FREQ=MONTHLY;COUNT=3" },
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-12-31T23:59:59.000Z"),
    );
    expect(ocurrencias.map(iso)).toEqual([
      "2026-01-15T09:00:00.000Z",
      "2026-02-15T09:00:00.000Z",
      "2026-03-15T09:00:00.000Z",
    ]);
  });

  it("expande una regla anual", () => {
    const ocurrencias = expandirOcurrencias(
      { inicio: new Date("2024-06-01T12:00:00.000Z"), recurrencia: "FREQ=YEARLY;COUNT=2" },
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2026-12-31T23:59:59.000Z"),
    );
    expect(ocurrencias.map(iso)).toEqual(["2024-06-01T12:00:00.000Z", "2025-06-01T12:00:00.000Z"]);
  });

  it("respeta COUNT", () => {
    const ocurrencias = expandirOcurrencias(
      { inicio: new Date("2026-05-10T08:00:00.000Z"), recurrencia: "FREQ=DAILY;COUNT=3" },
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-31T23:59:59.000Z"),
    );
    expect(ocurrencias).toHaveLength(3);
  });

  it("respeta UNTIL", () => {
    const ocurrencias = expandirOcurrencias(
      {
        inicio: new Date("2026-05-10T08:00:00.000Z"),
        recurrencia: "FREQ=DAILY;UNTIL=20260512T080000Z",
      },
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-31T23:59:59.000Z"),
    );
    expect(ocurrencias.map(iso)).toEqual([
      "2026-05-10T08:00:00.000Z",
      "2026-05-11T08:00:00.000Z",
      "2026-05-12T08:00:00.000Z",
    ]);
  });

  it("aplica el intervalo", () => {
    const ocurrencias = expandirOcurrencias(
      {
        inicio: new Date("2026-05-10T08:00:00.000Z"),
        recurrencia: "FREQ=DAILY;INTERVAL=3;COUNT=4",
      },
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-31T23:59:59.000Z"),
    );
    expect(ocurrencias.map(iso)).toEqual([
      "2026-05-10T08:00:00.000Z",
      "2026-05-13T08:00:00.000Z",
      "2026-05-16T08:00:00.000Z",
      "2026-05-19T08:00:00.000Z",
    ]);
  });

  it("devuelve vacío si el rango no contiene ocurrencias", () => {
    const ocurrencias = expandirOcurrencias(
      { inicio: new Date("2020-01-01T08:00:00.000Z"), recurrencia: "FREQ=DAILY;COUNT=3" },
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-31T23:59:59.000Z"),
    );
    expect(ocurrencias).toEqual([]);
  });

  it("devuelve vacío con una regla inválida", () => {
    const ocurrencias = expandirOcurrencias(
      { inicio: new Date("2026-05-10T08:00:00.000Z"), recurrencia: "FREQ=HOURLY" },
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-31T23:59:59.000Z"),
    );
    expect(ocurrencias).toEqual([]);
  });

  it("aplica el tope duro de 1000 ocurrencias", () => {
    const ocurrencias = expandirOcurrencias(
      { inicio: new Date("2020-01-01T00:00:00.000Z"), recurrencia: "FREQ=DAILY" },
      new Date("2020-01-01T00:00:00.000Z"),
      new Date("2035-01-01T00:00:00.000Z"),
    );
    expect(ocurrencias).toHaveLength(1000);
  });
});
