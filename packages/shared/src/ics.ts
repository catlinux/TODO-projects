import { tzlib_get_ical_block, tzlib_get_timezones } from "timezones-ical-library";

import { aHoraPared, esReglaRecurrenciaValida, esZonaValida } from "./recurrencia.js";

export interface ExcepcionIcs {
  /** Fecha original de la ocurrencia en la serie (clave de la excepción). */
  fechaOriginal: Date;
  fechaNueva?: Date | null;
  omitida?: boolean;
  titulo?: string | null;
}

export interface EventoIcs {
  uid: string;
  titulo: string;
  descripcion?: string | null;
  inicio: Date;
  recurrencia?: string | null;
  proyecto?: string;
  zona?: string | null;
  excepciones?: readonly ExcepcionIcs[];
}

export interface OpcionesIcs {
  ahora?: Date;
}

const LIMITE_OCTETOS = 75;
const UNA_HORA_EN_MILISEGUNDOS = 60 * 60 * 1000;

/**
 * Zonas para las que la librería puede generar el bloque VTIMEZONE. Las que no
 * estén aquí (cadena inválida o zona desconocida) caen al fallback en UTC.
 */
const ZONAS_CON_VTIMEZONE = new Set<string>(tzlib_get_timezones() as string[]);

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
  return `${formatearCamposUtc(fecha)}Z`;
}

function formatearCamposUtc(fecha: Date): string {
  const anio = String(fecha.getUTCFullYear()).padStart(4, "0");
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getUTCDate()).padStart(2, "0");
  const hora = String(fecha.getUTCHours()).padStart(2, "0");
  const minuto = String(fecha.getUTCMinutes()).padStart(2, "0");
  const segundo = String(fecha.getUTCSeconds()).padStart(2, "0");
  return `${anio}${mes}${dia}T${hora}${minuto}${segundo}`;
}

/**
 * Una zona usa TZID si es una zona IANA válida distinta de UTC y la librería
 * puede generar su bloque VTIMEZONE. Las desconocidas (cadena inválida) caen
 * al fallback en UTC.
 */
function zonaUsaTzid(zona: string | null | undefined): zona is string {
  return Boolean(zona && zona !== "UTC" && esZonaValida(zona) && ZONAS_CON_VTIMEZONE.has(zona));
}

function eventoUsaTzid(evento: EventoIcs): boolean {
  return Boolean(
    evento.recurrencia && esReglaRecurrenciaValida(evento.recurrencia) && zonaUsaTzid(evento.zona),
  );
}

/** Líneas (sin CRLF) del bloque VTIMEZONE que la librería genera para la zona. */
function generarVtimezone(zona: string): string[] {
  const bloque = tzlib_get_ical_block(zona);
  const texto = Array.isArray(bloque) ? (bloque[0] ?? "") : bloque;
  return texto.split(/\r?\n/).filter((linea) => linea.length > 0);
}

/**
 * Línea de una propiedad de fecha. Con `zona` usa hora de pared y TZID (igual
 * que DTSTART); sin ella, la fecha en UTC con sufijo Z.
 */
function lineaFechaIcs(nombre: string, fecha: Date, zona: string | null): string {
  if (zona) {
    return `${nombre};TZID=${zona}:${formatearCamposUtc(aHoraPared(fecha, zona))}`;
  }
  return `${nombre}:${formatearFechaUtc(fecha)}`;
}

export function generarCalendarioIcs(
  eventos: readonly EventoIcs[],
  opciones: OpcionesIcs = {},
): string {
  const sello = formatearFechaUtc(opciones.ahora ?? new Date());
  const zonas = new Set<string>();
  for (const evento of eventos) {
    if (eventoUsaTzid(evento) && evento.zona) {
      zonas.add(evento.zona);
    }
  }

  const lineas: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TODO-projects//ES//",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:TODO-projects",
  ];

  for (const zona of [...zonas].sort()) {
    lineas.push(...generarVtimezone(zona));
  }

  for (const evento of eventos) {
    const zona = evento.zona && eventoUsaTzid(evento) ? evento.zona : null;

    lineas.push("BEGIN:VEVENT");
    lineas.push(`UID:${evento.uid}@todo-projects`);
    lineas.push(`DTSTAMP:${sello}`);
    lineas.push(lineaFechaIcs("DTSTART", evento.inicio, zona));
    lineas.push(
      lineaFechaIcs("DTEND", new Date(evento.inicio.getTime() + UNA_HORA_EN_MILISEGUNDOS), zona),
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

    const excepciones = evento.excepciones ?? [];

    // Una omitida desaparece con un EXDATE de su fecha original.
    for (const excepcion of excepciones) {
      if (excepcion.omitida) {
        lineas.push(lineaFechaIcs("EXDATE", excepcion.fechaOriginal, zona));
      }
    }

    // Las movidas o editadas necesitan un EXDATE de la original y un VEVENT
    // propio con RECURRENCE-ID que sustituya a esa ocurrencia.
    for (const excepcion of excepciones) {
      if (excepcion.omitida || (!excepcion.fechaNueva && !excepcion.titulo)) {
        continue;
      }

      const inicioNuevo = excepcion.fechaNueva ?? excepcion.fechaOriginal;
      lineas.push(lineaFechaIcs("EXDATE", excepcion.fechaOriginal, zona));
      lineas.push("BEGIN:VEVENT");
      lineas.push(`UID:${evento.uid}@todo-projects`);
      lineas.push(`DTSTAMP:${sello}`);
      lineas.push(lineaFechaIcs("RECURRENCE-ID", excepcion.fechaOriginal, zona));
      lineas.push(lineaFechaIcs("DTSTART", inicioNuevo, zona));
      lineas.push(
        lineaFechaIcs("DTEND", new Date(inicioNuevo.getTime() + UNA_HORA_EN_MILISEGUNDOS), zona),
      );
      lineas.push(`SUMMARY:${escaparTextoIcs(excepcion.titulo ?? evento.titulo)}`);
      lineas.push("END:VEVENT");
    }

    lineas.push("END:VEVENT");
  }

  lineas.push("END:VCALENDAR");

  return `${lineas.map(plegarLineaIcs).join("\r\n")}\r\n`;
}
