import { esReglaRecurrenciaValida } from "./recurrencia.js";

export interface EventoIcs {
  uid: string;
  titulo: string;
  descripcion?: string | null;
  inicio: Date;
  recurrencia?: string | null;
  proyecto?: string;
}

export interface OpcionesIcs {
  ahora?: Date;
}

const LIMITE_OCTETOS = 75;
const UNA_HORA_EN_MILISEGUNDOS = 60 * 60 * 1000;

function bytesUtf8(caracter: string): number {
  const punto = caracter.codePointAt(0);
  if (punto === undefined) {
    return 0;
  }
  if (punto <= 0x7f) {
    return 1;
  }
  if (punto <= 0x7ff) {
    return 2;
  }
  if (punto <= 0xffff) {
    return 3;
  }
  return 4;
}

/**
 * Pliega una línea de texto a 75 octetos UTF-8. Las continuaciones empiezan
 * por un espacio y nunca se parte un carácter multibyte.
 */
export function plegarLineaIcs(linea: string): string {
  const fisicas: string[] = [];
  let actual = "";
  let octetos = 0;

  for (const caracter of linea) {
    const ancho = bytesUtf8(caracter);
    if (octetos + ancho > LIMITE_OCTETOS) {
      fisicas.push(actual);
      actual = ` ${caracter}`;
      octetos = 1 + ancho;
    } else {
      actual += caracter;
      octetos += ancho;
    }
  }

  fisicas.push(actual);
  return fisicas.join("\r\n");
}

/** Escapa un valor TEXT de RFC 5545. */
export function escaparTextoIcs(valor: string): string {
  return valor
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function formatearFechaUtc(fecha: Date): string {
  const anio = String(fecha.getUTCFullYear()).padStart(4, "0");
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getUTCDate()).padStart(2, "0");
  const hora = String(fecha.getUTCHours()).padStart(2, "0");
  const minuto = String(fecha.getUTCMinutes()).padStart(2, "0");
  const segundo = String(fecha.getUTCSeconds()).padStart(2, "0");
  return `${anio}${mes}${dia}T${hora}${minuto}${segundo}Z`;
}

export function generarCalendarioIcs(
  eventos: readonly EventoIcs[],
  opciones: OpcionesIcs = {},
): string {
  const sello = formatearFechaUtc(opciones.ahora ?? new Date());
  const lineas: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TODO-projects//ES//",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:TODO-projects",
  ];

  for (const evento of eventos) {
    lineas.push("BEGIN:VEVENT");
    lineas.push(`UID:${evento.uid}@todo-projects`);
    lineas.push(`DTSTAMP:${sello}`);
    lineas.push(`DTSTART:${formatearFechaUtc(evento.inicio)}`);
    lineas.push(
      `DTEND:${formatearFechaUtc(new Date(evento.inicio.getTime() + UNA_HORA_EN_MILISEGUNDOS))}`,
    );
    lineas.push(`SUMMARY:${escaparTextoIcs(evento.titulo)}`);

    if (evento.descripcion) {
      lineas.push(`DESCRIPTION:${escaparTextoIcs(evento.descripcion)}`);
    }
    if (evento.proyecto) {
      lineas.push(`CATEGORIES:${escaparTextoIcs(evento.proyecto)}`);
    }
    if (evento.recurrencia && esReglaRecurrenciaValida(evento.recurrencia)) {
      lineas.push(`RRULE:${evento.recurrencia}`);
    }

    lineas.push("END:VEVENT");
  }

  lineas.push("END:VCALENDAR");

  return `${lineas.map(plegarLineaIcs).join("\r\n")}\r\n`;
}
