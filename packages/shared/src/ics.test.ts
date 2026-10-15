import { describe, expect, it } from "vitest";

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
