import { describe, expect, it } from "vitest";

import type { OcurrenciaAgenda } from "./api";
import {
  agruparHoy,
  DIAS_ATRASADAS,
  fechaCabecera,
  pendientesHoy,
  rangoHoy,
} from "./hoy";

const AHORA = new Date(2026, 4, 10, 12, 0, 0);

function ocurrencia(
  fecha: Date,
  cambios: Partial<OcurrenciaAgenda> = {},
): OcurrenciaAgenda {
  return {
    tareaId: "t1",
    titulo: "Tarea",
    proyectoId: "p1",
    proyectoNombre: "Proyecto",
    columnaId: "c1",
    columnaNombre: "Pendiente",
    primeraColumnaId: "c1",
    ultimaColumnaId: "c-last",
    fecha: fecha.toISOString(),
    esRecurrente: false,
    hecha: false,
    recordatorioMin: null,
    ...cambios,
  };
}

function aLasHoras(dia: number, hora: number): Date {
  return new Date(2026, 4, dia, hora, 0, 0);
}

describe("agruparHoy", () => {
  it("separa atrasadas, hoy y próximos", () => {
    const secciones = agruparHoy(
      [
        ocurrencia(aLasHoras(9, 8), { tareaId: "ayer" }),
        ocurrencia(aLasHoras(10, 9), { tareaId: "hoy-manana" }),
        ocurrencia(aLasHoras(10, 20), { tareaId: "hoy-tarde" }),
        ocurrencia(aLasHoras(11, 7), { tareaId: "manana" }),
        ocurrencia(aLasHoras(17, 7), { tareaId: "semana" }),
        ocurrencia(aLasHoras(18, 7), { tareaId: "fuera" }),
      ],
      AHORA,
    );

    expect(secciones.atrasadas.map((o) => o.tareaId)).toEqual(["ayer"]);
    expect(secciones.hoy.map((o) => o.tareaId)).toEqual(["hoy-manana", "hoy-tarde"]);
    expect(secciones.proximos.map((o) => o.tareaId)).toEqual(["manana", "semana"]);
  });

  it("deja fuera las atrasadas de hace más de 30 días", () => {
    const secciones = agruparHoy(
      [
        ocurrencia(aLasHoras(1, 8), { tareaId: "reciente" }),
        ocurrencia(new Date(2026, 3, 9, 8, 0, 0), { tareaId: "antigua" }),
      ],
      AHORA,
    );

    expect(secciones.atrasadas.map((o) => o.tareaId)).toEqual(["reciente"]);
  });

  it("incluye las hechas de hoy pero no las hechas de otros días", () => {
    const secciones = agruparHoy(
      [
        ocurrencia(aLasHoras(10, 9), { tareaId: "hoy-hecha", hecha: true }),
        ocurrencia(aLasHoras(9, 9), { tareaId: "ayer-hecha", hecha: true }),
        ocurrencia(aLasHoras(11, 9), { tareaId: "manana-hecha", hecha: true }),
      ],
      AHORA,
    );

    expect(secciones.hoy.map((o) => o.tareaId)).toEqual(["hoy-hecha"]);
    expect(secciones.atrasadas).toEqual([]);
    expect(secciones.proximos).toEqual([]);
  });

  it("ordena cada sección por fecha", () => {
    const secciones = agruparHoy(
      [
        ocurrencia(aLasHoras(10, 20), { tareaId: "tarde" }),
        ocurrencia(aLasHoras(10, 8), { tareaId: "temprano" }),
      ],
      AHORA,
    );

    expect(secciones.hoy.map((o) => o.tareaId)).toEqual(["temprano", "tarde"]);
  });

  it("cuenta las pendientes de atrasadas y de hoy", () => {
    const secciones = agruparHoy(
      [
        ocurrencia(aLasHoras(9, 8)),
        ocurrencia(aLasHoras(10, 9)),
        ocurrencia(aLasHoras(10, 10), { hecha: true }),
        ocurrencia(aLasHoras(12, 9)),
      ],
      AHORA,
    );

    expect(pendientesHoy(secciones)).toBe(2);
  });
});

describe("rangoHoy", () => {
  it("cubre los últimos 30 días y los próximos 7 desde el inicio del día", () => {
    const rango = rangoHoy(AHORA);

    expect(rango.desde).toBe(new Date(2026, 3, 10, 0, 0, 0).toISOString());
    expect(rango.hasta).toBe(new Date(2026, 4, 18, 0, 0, 0).toISOString());
    expect(DIAS_ATRASADAS).toBe(30);
  });
});

describe("fechaCabecera", () => {
  it("devuelve la fecha en mayúsculas sin punto", () => {
    expect(fechaCabecera(AHORA)).toBe("DOMINGO 10 MAY");
  });
});
