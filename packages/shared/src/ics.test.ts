import { describe, expect, it } from "vitest";

import { aHoraPared, expandirOcurrencias } from "./recurrencia.js";
import { escaparTextoIcs, generarCalendarioIcs, plegarLineaIcs } from "./ics.js";

function octetosUtf8(valor: string): number {
  let total = 0;
  for (const caracter of valor) {
    const punto = caracter.codePointAt(0) ?? 0;
    total += punto <= 0x7f ? 1 : punto <= 0x7ff ? 2 : punto <= 0xffff ? 3 : 4;
  }
  return total;
}

function lineasIcs(calendario: string): string[] {
  return calendario.split("\r\n");
}

function buscarLineaLogica(lineas: string[], prefijo: string): string | null {
  const indice = lineas.findIndex((linea) => linea.startsWith(prefijo));
  if (indice === -1) {
    return null;
  }

  let resultado = lineas[indice]!;
  let siguiente = indice + 1;
  while (siguiente < lineas.length && lineas[siguiente]!.startsWith(" ")) {
    resultado += lineas[siguiente]!.slice(1);
    siguiente += 1;
  }

  return resultado;
}

describe("escaparTextoIcs", () => {
  it("escapa barras, puntos y coma, comas y saltos de línea", () => {
    expect(escaparTextoIcs("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });
});

describe("plegarLineaIcs", () => {
  it("no parte caracteres multibyte y usa un espacio de continuación", () => {
    const original = "ñ".repeat(40) + "😀".repeat(10) + "fin";
    const plegada = plegarLineaIcs(original);

    for (const linea of plegada.split("\r\n")) {
      expect(octetosUtf8(linea)).toBeLessThanOrEqual(75);
    }

    const fisicas = plegada.split("\r\n");
    const reconstruida =
      fisicas[0] +
      fisicas
        .slice(1)
        .map((linea) => linea.slice(1))
        .join("");
    expect(reconstruida).toBe(original);
  });
});

describe("generarCalendarioIcs", () => {
  const base = {
    uid: "11111111-1111-1111-1111-111111111111",
    titulo: "Reunión",
    descripcion: "Detalle",
    inicio: new Date("2026-05-10T10:00:00.000Z"),
    recurrencia: "FREQ=WEEKLY;BYDAY=MO",
    proyecto: "Trabajo",
  };

  it("genera la estructura completa con CRLF", () => {
    const calendario = generarCalendarioIcs([base], {
      ahora: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(calendario.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(calendario.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(calendario.includes("\n") && !calendario.includes("\r\n")).toBe(false);

    for (let i = 0; i < calendario.length; i += 1) {
      if (calendario[i] === "\n") {
        expect(calendario[i - 1]).toBe("\r");
      }
    }

    const lineas = lineasIcs(calendario);
    expect(lineas).toContain("VERSION:2.0");
    expect(lineas).toContain("PRODID:-//TODO-projects//ES//");
    expect(lineas).toContain("CALSCALE:GREGORIAN");
    expect(lineas).toContain("X-WR-CALNAME:TODO-projects");
    expect(lineas).toContain("BEGIN:VEVENT");
    expect(lineas).toContain(`UID:${base.uid}@todo-projects`);
    expect(lineas).toContain("DTSTAMP:20260101T000000Z");
    expect(lineas).toContain("DTSTART:20260510T100000Z");
    expect(lineas).toContain("DTEND:20260510T110000Z");
    expect(lineas).toContain("SUMMARY:Reunión");
    expect(lineas).toContain("DESCRIPTION:Detalle");
    expect(lineas).toContain("CATEGORIES:Trabajo");
    expect(lineas).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(lineas).toContain("END:VEVENT");
  });

  it("omite la descripción si no hay", () => {
    const calendario = generarCalendarioIcs([{ ...base, descripcion: null }]);
    const lineas = lineasIcs(calendario);
    expect(lineas.some((linea) => linea.startsWith("DESCRIPTION:"))).toBe(false);
  });

  it("omite la recurrencia inválida", () => {
    const calendario = generarCalendarioIcs([{ ...base, recurrencia: "FREQ=HOURLY" }]);
    expect(lineasIcs(calendario).some((linea) => linea.startsWith("RRULE:"))).toBe(false);
  });

  it("escapa el texto de título y descripción", () => {
    const calendario = generarCalendarioIcs([
      { ...base, titulo: "Uno; dos, tres\\cuatro\ncinco", descripcion: "a,b;c" },
    ]);
    const lineas = lineasIcs(calendario);
    expect(lineas).toContain("SUMMARY:Uno\\; dos\\, tres\\\\cuatro\\ncinco");
    expect(lineas).toContain("DESCRIPTION:a\\,b\\;c");
  });

  it("pliega las líneas largas con multibyte", () => {
    const titulo = "Reunión " + "ñ".repeat(60) + " 😀";
    const calendario = generarCalendarioIcs([{ ...base, titulo }]);
    const lineas = lineasIcs(calendario);

    for (const linea of lineas) {
      expect(octetosUtf8(linea)).toBeLessThanOrEqual(75);
    }

    const logica = buscarLineaLogica(lineas, "SUMMARY:");
    expect(logica).toBe(`SUMMARY:${escaparTextoIcs(titulo)}`);
  });

  it("mantiene el orden de los eventos", () => {
    const calendario = generarCalendarioIcs([
      { ...base, uid: "aaa", titulo: "Primero" },
      { ...base, uid: "bbb", titulo: "Segundo" },
    ]);
    const lineas = lineasIcs(calendario);
    expect(lineas.indexOf("UID:aaa@todo-projects")).toBeLessThan(
      lineas.indexOf("UID:bbb@todo-projects"),
    );
  });
});

describe("generarCalendarioIcs con zona horaria", () => {
  const inicio = new Date("2026-05-10T08:00:00.000Z");
  const eventoBase = {
    uid: "11111111-1111-1111-1111-111111111111",
    titulo: "Semanal",
    inicio,
    recurrencia: "FREQ=WEEKLY;COUNT=3",
  };

  it("emite DTSTART;TZID con VTIMEZONE de Europe/Madrid", () => {
    const calendario = generarCalendarioIcs([{ ...eventoBase, zona: "Europe/Madrid" }]);
    const lineas = lineasIcs(calendario);

    expect(lineas).toContain("BEGIN:VTIMEZONE");
    expect(lineas).toContain("TZID:Europe/Madrid");
    expect(lineas).toContain("BEGIN:DAYLIGHT");
    expect(lineas).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU");
    expect(lineas).toContain("TZOFFSETTO:+0200");
    expect(lineas).toContain("BEGIN:STANDARD");
    expect(lineas).toContain("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU");
    expect(lineas).toContain("TZOFFSETTO:+0100");
    expect(lineas).toContain("END:VTIMEZONE");

    expect(lineas).toContain("DTSTART;TZID=Europe/Madrid:20260510T100000");
    expect(lineas).toContain("DTEND;TZID=Europe/Madrid:20260510T110000");
  });

  it("mantiene UTC sin recurrencia aunque haya zona", () => {
    const calendario = generarCalendarioIcs([
      { uid: "x", titulo: "Puntual", inicio, zona: "Europe/Madrid" },
    ]);
    const lineas = lineasIcs(calendario);
    expect(lineas).toContain("DTSTART:20260510T080000Z");
    expect(lineas.some((linea) => linea.startsWith("BEGIN:VTIMEZONE"))).toBe(false);
  });

  it("genera un STANDARD para zonas sin horario de verano", () => {
    const calendario = generarCalendarioIcs([{ ...eventoBase, zona: "Asia/Tokyo" }]);
    const lineas = lineasIcs(calendario);

    expect(lineas).toContain("BEGIN:VTIMEZONE");
    expect(lineas).toContain("TZID:Asia/Tokyo");
    expect(lineas).toContain("BEGIN:STANDARD");
    expect(lineas).toContain("TZOFFSETTO:+0900");
    expect(lineas).not.toContain("BEGIN:DAYLIGHT");
    expect(lineas).toContain("DTSTART;TZID=Asia/Tokyo:20260510T170000");
  });

  it("emite DAYLIGHT y STANDARD de America/New_York", () => {
    const calendario = generarCalendarioIcs([{ ...eventoBase, zona: "America/New_York" }]);
    const lineas = lineasIcs(calendario);

    expect(lineas).toContain("BEGIN:VTIMEZONE");
    expect(lineas).toContain("TZID:America/New_York");
    expect(lineas).toContain("BEGIN:DAYLIGHT");
    expect(lineas).toContain("TZOFFSETFROM:-0500");
    expect(lineas).toContain("TZOFFSETTO:-0400");
    expect(lineas).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
    expect(lineas).toContain("BEGIN:STANDARD");
    expect(lineas).toContain("TZOFFSETFROM:-0400");
    expect(lineas).toContain("TZOFFSETTO:-0500");
    expect(lineas).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
    expect(lineas).toContain("END:VTIMEZONE");

    // 2026-05-10T08:00Z son las 04:00 en Nueva York (EDT, -04:00).
    expect(lineas).toContain("DTSTART;TZID=America/New_York:20260510T040000");
    expect(lineas).toContain("DTEND;TZID=America/New_York:20260510T050000");
  });

  it("mantiene la hora local de una serie semanal que cruza los cambios de hora de Nueva York", () => {
    // Lunes a las 10:00 locales: 15:00Z con EST, 14:00Z con EDT en verano.
    const inicio = new Date("2026-03-02T15:00:00.000Z");
    const recurrencia = "FREQ=WEEKLY;UNTIL=20261116T150000Z";
    const calendario = generarCalendarioIcs([
      { ...eventoBase, inicio, recurrencia, zona: "America/New_York" },
    ]);
    const lineas = lineasIcs(calendario);

    expect(lineas).toContain("DTSTART;TZID=America/New_York:20260302T100000");
    expect(lineas).toContain(`RRULE:${recurrencia}`);

    const ocurrencias = expandirOcurrencias(
      { inicio, recurrencia, zona: "America/New_York" },
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-11-20T00:00:00.000Z"),
    );

    // Cruza el cambio de marzo (adelanto) y el de noviembre (atraso).
    expect(ocurrencias.length).toBeGreaterThan(30);
    for (const ocurrencia of ocurrencias) {
      expect(aHoraPared(ocurrencia, "America/New_York").getUTCHours()).toBe(10);
    }
    expect(ocurrencias[0]!.toISOString()).toBe("2026-03-02T15:00:00.000Z");
    expect(
      ocurrencias.some((ocurrencia) => ocurrencia.toISOString() === "2026-07-06T14:00:00.000Z"),
    ).toBe(true);
    expect(ocurrencias[ocurrencias.length - 1]!.toISOString()).toBe("2026-11-16T15:00:00.000Z");
  });

  it("emite DAYLIGHT y STANDARD de Australia/Sydney (hemisferio sur)", () => {
    const calendario = generarCalendarioIcs([{ ...eventoBase, zona: "Australia/Sydney" }]);
    const lineas = lineasIcs(calendario);

    expect(lineas).toContain("TZID:Australia/Sydney");
    expect(lineas).toContain("BEGIN:DAYLIGHT");
    expect(lineas).toContain("TZOFFSETFROM:+1000");
    expect(lineas).toContain("TZOFFSETTO:+1100");
    expect(lineas).toContain("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU");
    expect(lineas).toContain("BEGIN:STANDARD");
    expect(lineas).toContain("TZOFFSETFROM:+1100");
    expect(lineas).toContain("TZOFFSETTO:+1000");
    expect(lineas).toContain("RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU");

    // 2026-05-10T08:00Z son las 18:00 en Sídney (AEST, +10:00).
    expect(lineas).toContain("DTSTART;TZID=Australia/Sydney:20260510T180000");
  });

  it("cae al fallback en UTC para una zona desconocida sin lanzar", () => {
    const calendario = generarCalendarioIcs([{ ...eventoBase, zona: "Marte/Olympus" }]);
    const lineas = lineasIcs(calendario);

    expect(lineas).toContain("DTSTART:20260510T080000Z");
    expect(lineas.some((linea) => linea.startsWith("BEGIN:VTIMEZONE"))).toBe(false);
    expect(lineas.some((linea) => linea.startsWith("DTSTART;TZID="))).toBe(false);
  });

  it("incluye un único VTIMEZONE por zona", () => {
    const calendario = generarCalendarioIcs([
      { ...eventoBase, zona: "Europe/Madrid" },
      { ...eventoBase, uid: "22222222-2222-2222-2222-222222222222", zona: "Europe/Madrid" },
    ]);
    const lineas = lineasIcs(calendario);
    expect(lineas.filter((linea) => linea === "TZID:Europe/Madrid")).toHaveLength(1);
  });

  it("mantiene UTC con zona UTC", () => {
    const calendario = generarCalendarioIcs([{ ...eventoBase, zona: "UTC" }]);
    const lineas = lineasIcs(calendario);
    expect(lineas).toContain("DTSTART:20260510T080000Z");
    expect(lineas.some((linea) => linea.startsWith("BEGIN:VTIMEZONE"))).toBe(false);
  });
});

describe("generarCalendarioIcs con excepciones de una serie", () => {
  const inicio = new Date("2026-05-10T08:00:00.000Z");
  const eventoBase = {
    uid: "33333333-3333-3333-3333-333333333333",
    titulo: "Semanal",
    inicio,
    recurrencia: "FREQ=WEEKLY;COUNT=4",
  };

  it("emite un EXDATE con TZID por cada ocurrencia omitida", () => {
    const calendario = generarCalendarioIcs([
      {
        ...eventoBase,
        zona: "Europe/Madrid",
        excepciones: [
          { fechaOriginal: new Date("2026-05-17T08:00:00.000Z"), omitida: true },
          { fechaOriginal: new Date("2026-05-31T08:00:00.000Z"), omitida: true },
        ],
      },
    ]);
    const lineas = lineasIcs(calendario);

    expect(lineas).toContain("EXDATE;TZID=Europe/Madrid:20260517T100000");
    expect(lineas).toContain("EXDATE;TZID=Europe/Madrid:20260531T100000");
    // Las omitidas no añaden VEVENT: solo queda el de la serie.
    expect(lineas.filter((linea) => linea === "BEGIN:VEVENT")).toHaveLength(1);
  });

  it("emite EXDATE y un VEVENT con RECURRENCE-ID para una movida y renombrada", () => {
    const calendario = generarCalendarioIcs([
      {
        ...eventoBase,
        zona: "America/New_York",
        excepciones: [
          {
            fechaOriginal: new Date("2026-05-17T08:00:00.000Z"),
            fechaNueva: new Date("2026-05-18T12:00:00.000Z"),
            titulo: "Semanal movida",
          },
        ],
      },
    ]);
    const lineas = lineasIcs(calendario);

    // 08:00Z de la original son las 04:00 en Nueva York (EDT).
    expect(lineas).toContain("EXDATE;TZID=America/New_York:20260517T040000");
    expect(lineas).toContain("RECURRENCE-ID;TZID=America/New_York:20260517T040000");
    // 2026-05-18T12:00Z son las 08:00 en Nueva York (EDT).
    expect(lineas).toContain("DTSTART;TZID=America/New_York:20260518T080000");
    expect(lineas).toContain("DTEND;TZID=America/New_York:20260518T090000");
    expect(lineas.filter((linea) => linea === "BEGIN:VEVENT")).toHaveLength(2);

    const indice = lineas.indexOf("RECURRENCE-ID;TZID=America/New_York:20260517T040000");
    expect(indice).toBeGreaterThan(-1);
    expect(lineas.slice(indice)).toContain("SUMMARY:Semanal movida");
    // Los dos VEVENT (serie y excepción) comparten el mismo UID.
    expect(
      lineas.filter((linea) => linea === `UID:${eventoBase.uid}@todo-projects`),
    ).toHaveLength(2);
  });

  it("emite RECURRENCE-ID solo con el título nuevo sin cambiar la fecha", () => {
    const calendario = generarCalendarioIcs([
      {
        ...eventoBase,
        zona: "Europe/Madrid",
        excepciones: [
          { fechaOriginal: new Date("2026-05-17T08:00:00.000Z"), titulo: "Solo el título" },
        ],
      },
    ]);
    const lineas = lineasIcs(calendario);

    expect(lineas).toContain("EXDATE;TZID=Europe/Madrid:20260517T100000");
    expect(lineas).toContain("RECURRENCE-ID;TZID=Europe/Madrid:20260517T100000");
    expect(lineas).toContain("DTSTART;TZID=Europe/Madrid:20260517T100000");
    expect(lineas).toContain("SUMMARY:Solo el título");
  });

  it("usa UTC si la serie no emite TZID", () => {
    const calendario = generarCalendarioIcs([
      {
        ...eventoBase,
        zona: "Marte/Olympus",
        excepciones: [
          {
            fechaOriginal: new Date("2026-05-17T08:00:00.000Z"),
            fechaNueva: new Date("2026-05-18T12:00:00.000Z"),
          },
        ],
      },
    ]);
    const lineas = lineasIcs(calendario);

    expect(lineas).toContain("EXDATE:20260517T080000Z");
    expect(lineas).toContain("RECURRENCE-ID:20260517T080000Z");
    expect(lineas).toContain("DTSTART:20260518T120000Z");
  });
});
