import { describe, expect, it } from "vitest";

import { avisosProximos, textoHoraAviso } from "./avisos-proximos";
import type { OcurrenciaAgenda } from "./api";

function ocurrencia(cambios: Partial<OcurrenciaAgenda> = {}): OcurrenciaAgenda {
  return {
    tareaId: "t1",
    titulo: "Tarea",
    proyectoId: "p1",
    proyectoNombre: "Proyecto",
    columnaId: "c1",
    columnaNombre: "Pendiente",
    primeraColumnaId: "c1",
    ultimaColumnaId: "c-last",
    fecha: "2026-05-10T10:00:00.000Z",
    fechaOriginal: "2026-05-10T10:00:00.000Z",
    conExcepcion: false,
    esRecurrente: false,
    hecha: false,
    recordatorioMin: null,
    ...cambios,
  };
}

/** ISO de una fecha local (la suite fija la zona en Europe/Madrid). */
function local(anio: number, mes: number, dia: number, hora: number, minuto = 0): string {
  return new Date(anio, mes - 1, dia, hora, minuto).toISOString();
}

describe("avisosProximos", () => {
  const ahora = new Date(2026, 4, 10, 12, 0);

  it("incluye los avisos de los próximos 7 días ordenados por hora de aviso", () => {
    const avisos = avisosProximos(
      [
        ocurrencia({
          tareaId: "tarde",
          titulo: "Más tarde",
          fecha: local(2026, 5, 15, 9, 45),
          recordatorioMin: 60,
        }),
        ocurrencia({
          tareaId: "hoy",
          titulo: "Hoy mismo",
          fecha: local(2026, 5, 10, 18, 30),
          recordatorioMin: 30,
        }),
      ],
      ahora,
    );

    expect(avisos.map((aviso) => aviso.tareaId)).toEqual(["hoy", "tarde"]);
    expect(avisos[0]).toMatchObject({
      titulo: "Hoy mismo",
      proyectoNombre: "Proyecto",
      recordatorioMin: 30,
      horaAviso: local(2026, 5, 10, 18, 0),
      horaAvisoTexto: "HOY 18:00",
    });
    expect(avisos[1]).toMatchObject({
      horaAviso: local(2026, 5, 15, 8, 45),
      horaAvisoTexto: "VIE 15 · 08:45",
    });
  });

  it("descarta las hechas, las que no avisan y los avisos pasados", () => {
    const avisos = avisosProximos(
      [
        ocurrencia({
          tareaId: "hecha",
          hecha: true,
          fecha: local(2026, 5, 10, 18, 30),
          recordatorioMin: 30,
        }),
        ocurrencia({ tareaId: "sinAviso", fecha: local(2026, 5, 10, 18, 30) }),
        ocurrencia({
          tareaId: "pasado",
          fecha: local(2026, 5, 10, 12, 30),
          recordatorioMin: 60,
        }),
      ],
      ahora,
    );

    expect(avisos).toEqual([]);
  });

  it("descarta los avisos que caen más allá de 7 días", () => {
    const justoAlFinal = avisosProximos(
      [ocurrencia({ fecha: local(2026, 5, 17, 12, 0), recordatorioMin: 0 })],
      ahora,
    );
    expect(justoAlFinal).toHaveLength(1);

    const fuera = avisosProximos(
      [ocurrencia({ fecha: local(2026, 5, 17, 12, 1), recordatorioMin: 0 })],
      ahora,
    );
    expect(fuera).toEqual([]);
  });

  it("incluye un aviso que cae justo en el instante actual", () => {
    const avisos = avisosProximos(
      [ocurrencia({ fecha: local(2026, 5, 10, 12, 30), recordatorioMin: 30 })],
      ahora,
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.horaAvisoTexto).toBe("HOY 12:00");
  });
});

describe("textoHoraAviso", () => {
  it("acorta la hora del aviso", () => {
    expect(textoHoraAviso(new Date(2026, 4, 10, 18, 0), new Date(2026, 4, 10, 12, 0))).toBe(
      "HOY 18:00",
    );
    expect(textoHoraAviso(new Date(2026, 4, 15, 8, 45), new Date(2026, 4, 10, 12, 0))).toBe(
      "VIE 15 · 08:45",
    );
  });
});
