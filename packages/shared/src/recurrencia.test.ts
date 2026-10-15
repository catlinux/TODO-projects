import { describe, expect, it } from "vitest";

import {
  esReglaRecurrenciaValida,
  esquemaRecurrencia,
  esquemaZona,
  expandirOcurrencias,
  partesEnZona,
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

describe("esquemaZona", () => {
  it("acepta zonas IANA conocidas", () => {
    for (const zona of ["Europe/Madrid", "UTC", "America/New_York", "  Europe/Madrid  "]) {
      expect(esquemaZona.safeParse(zona).success).toBe(true);
    }
  });

  it("rechaza zonas desconocidas o demasiado largas", () => {
    for (const zona of ["Marte/Olympus", "Europe/Madrid;", "a".repeat(65)]) {
      expect(esquemaZona.safeParse(zona).success).toBe(false);
    }
  });
});

describe("expandirOcurrencias con zona horaria", () => {
  function horaPared(fecha: Date, zona: string): string {
    const partes = partesEnZona(fecha, zona);
    return `${partes.hora}:${String(partes.minuto).padStart(2, "0")}`;
  }

  it("conserva las 04:17 locales al cruzar el cambio de octubre", () => {
    const ocurrencias = expandirOcurrencias(
      {
        inicio: new Date("2026-10-05T02:17:00.000Z"),
        recurrencia: "FREQ=WEEKLY;COUNT=5",
        zona: "Europe/Madrid",
      },
      new Date("2026-10-01T00:00:00.000Z"),
      new Date("2026-11-10T00:00:00.000Z"),
    );

    expect(ocurrencias.map(iso)).toEqual([
      "2026-10-05T02:17:00.000Z",
      "2026-10-12T02:17:00.000Z",
      "2026-10-19T02:17:00.000Z",
      "2026-10-26T03:17:00.000Z",
      "2026-11-02T03:17:00.000Z",
    ]);
    expect(ocurrencias.map((fecha) => horaPared(fecha, "Europe/Madrid"))).toEqual([
      "4:17",
      "4:17",
      "4:17",
      "4:17",
      "4:17",
    ]);
  });

  it("conserva las 04:17 locales al cruzar el cambio de marzo", () => {
    const ocurrencias = expandirOcurrencias(
      {
        inicio: new Date("2026-03-23T03:17:00.000Z"),
        recurrencia: "FREQ=WEEKLY;COUNT=4",
        zona: "Europe/Madrid",
      },
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-04-30T00:00:00.000Z"),
    );

    expect(ocurrencias.map(iso)).toEqual([
      "2026-03-23T03:17:00.000Z",
      "2026-03-30T02:17:00.000Z",
      "2026-04-06T02:17:00.000Z",
      "2026-04-13T02:17:00.000Z",
    ]);
    expect(ocurrencias.every((fecha) => horaPared(fecha, "Europe/Madrid") === "4:17")).toBe(true);
  });

  it("desplaza la hora inexistente del salto de primavera", () => {
    const ocurrencias = expandirOcurrencias(
      {
        inicio: new Date("2026-03-27T01:30:00.000Z"),
        recurrencia: "FREQ=DAILY;COUNT=4",
        zona: "Europe/Madrid",
      },
      new Date("2026-03-20T00:00:00.000Z"),
      new Date("2026-04-05T00:00:00.000Z"),
    );

    expect(ocurrencias.map(iso)).toEqual([
      "2026-03-27T01:30:00.000Z",
      "2026-03-28T01:30:00.000Z",
      "2026-03-29T01:30:00.000Z",
      "2026-03-30T00:30:00.000Z",
    ]);
    expect(ocurrencias.map((fecha) => horaPared(fecha, "Europe/Madrid"))).toEqual([
      "2:30",
      "2:30",
      "3:30",
      "2:30",
    ]);
  });

  it("mantiene el día 31 en la recurrencia mensual", () => {
    const ocurrencias = expandirOcurrencias(
      {
        inicio: new Date("2026-01-31T09:00:00.000Z"),
        recurrencia: "FREQ=MONTHLY;COUNT=5",
        zona: "Europe/Madrid",
      },
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-07-01T00:00:00.000Z"),
    );

    expect(ocurrencias.map(iso)).toEqual([
      "2026-01-31T09:00:00.000Z",
      "2026-03-31T08:00:00.000Z",
      "2026-05-31T08:00:00.000Z",
    ]);
    expect(ocurrencias.every((fecha) => horaPared(fecha, "Europe/Madrid") === "10:00")).toBe(true);
  });

  it("respeta la zona America/New_York", () => {
    const ocurrencias = expandirOcurrencias(
      {
        inicio: new Date("2026-10-26T13:00:00.000Z"),
        recurrencia: "FREQ=WEEKLY;COUNT=3",
        zona: "America/New_York",
      },
      new Date("2026-10-01T00:00:00.000Z"),
      new Date("2026-12-01T00:00:00.000Z"),
    );

    expect(ocurrencias.map(iso)).toEqual([
      "2026-10-26T13:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "2026-11-09T14:00:00.000Z",
    ]);
    expect(ocurrencias.every((fecha) => horaPared(fecha, "America/New_York") === "9:00")).toBe(
      true,
    );
  });

  it("mantiene el comportamiento actual con zona UTC o sin zona", () => {
    const argumentos = {
      inicio: new Date("2026-10-19T02:17:00.000Z"),
      recurrencia: "FREQ=WEEKLY;COUNT=3",
    };
    const desde = new Date("2026-10-01T00:00:00.000Z");
    const hasta = new Date("2026-11-10T00:00:00.000Z");
    const esperado = [
      "2026-10-19T02:17:00.000Z",
      "2026-10-26T02:17:00.000Z",
      "2026-11-02T02:17:00.000Z",
    ];

    expect(expandirOcurrencias({ ...argumentos, zona: "UTC" }, desde, hasta).map(iso)).toEqual(
      esperado,
    );
    expect(expandirOcurrencias(argumentos, desde, hasta).map(iso)).toEqual(esperado);
  });

  it("sin recurrencia no depende de la zona", () => {
    const inicio = new Date("2026-05-10T10:00:00.000Z");
    const desde = new Date("2026-05-01T00:00:00.000Z");
    const hasta = new Date("2026-05-31T00:00:00.000Z");
    expect(
      expandirOcurrencias({ inicio, recurrencia: null, zona: "Europe/Madrid" }, desde, hasta),
    ).toEqual([inicio]);
  });
});
