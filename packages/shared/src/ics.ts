import {
  aHoraPared,
  desfaseEnMinutos,
  esReglaRecurrenciaValida,
  esZonaValida,
} from "./recurrencia.js";

export interface EventoIcs {
  uid: string;
  titulo: string;
  descripcion?: string | null;
  inicio: Date;
  recurrencia?: string | null;
  proyecto?: string;
  zona?: string | null;
}

export interface OpcionesIcs {
  ahora?: Date;
}

const LIMITE_OCTETOS = 75;
const UNA_HORA_EN_MILISEGUNDOS = 60 * 60 * 1000;

const ZONAS_SIN_REGLAS_UE = new Set(["Europe/Moscow", "Europe/Istanbul", "Europe/Minsk"]);

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

function formatearDesfase(minutos: number): string {
  const signo = minutos < 0 ? "-" : "+";
  const absoluto = Math.abs(minutos);
  const horas = String(Math.floor(absoluto / 60)).padStart(2, "0");
  const resto = String(absoluto % 60).padStart(2, "0");
  return `${signo}${horas}${resto}`;
}

function esZonaSinHorarioDeVerano(zona: string): boolean {
  const invierno = desfaseEnMinutos(new Date("2026-01-15T12:00:00.000Z"), zona);
  const verano = desfaseEnMinutos(new Date("2026-07-15T12:00:00.000Z"), zona);
  return invierno === verano;
}

function esZonaConReglasUnionEuropea(zona: string): boolean {
  return zona.startsWith("Europe/") && !ZONAS_SIN_REGLAS_UE.has(zona);
}

/**
 * Solo se emite TZID para zonas sin horario de verano o con las reglas de la
 * UE. Otras zonas con DST caen al fallback en UTC (limitación documentada en
 * TODO.md).
 */
function zonaUsaTzid(zona: string | null | undefined): zona is string {
  return Boolean(
    zona &&
    zona !== "UTC" &&
    esZonaValida(zona) &&
    (esZonaSinHorarioDeVerano(zona) || esZonaConReglasUnionEuropea(zona)),
  );
}

function eventoUsaTzid(evento: EventoIcs): boolean {
  return Boolean(
    evento.recurrencia && esReglaRecurrenciaValida(evento.recurrencia) && zonaUsaTzid(evento.zona),
  );
}

function generarVtimezone(zona: string): string[] {
  const invierno = desfaseEnMinutos(new Date("2026-01-15T12:00:00.000Z"), zona);
  const verano = desfaseEnMinutos(new Date("2026-07-15T12:00:00.000Z"), zona);
  const lineas = ["BEGIN:VTIMEZONE", `TZID:${zona}`];

  if (invierno === verano) {
    const desfase = formatearDesfase(invierno);
    lineas.push(
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      `TZOFFSETFROM:${desfase}`,
      `TZOFFSETTO:${desfase}`,
      "END:STANDARD",
    );
  } else {
    lineas.push(
      "BEGIN:DAYLIGHT",
      "DTSTART:19700329T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
      `TZOFFSETFROM:${formatearDesfase(invierno)}`,
      `TZOFFSETTO:${formatearDesfase(verano)}`,
      "END:DAYLIGHT",
    );
    lineas.push(
      "BEGIN:STANDARD",
      "DTSTART:19701025T030000",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
      `TZOFFSETFROM:${formatearDesfase(verano)}`,
      `TZOFFSETTO:${formatearDesfase(invierno)}`,
      "END:STANDARD",
    );
  }

  lineas.push("END:VTIMEZONE");
  return lineas;
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
    lineas.push("BEGIN:VEVENT");
    lineas.push(`UID:${evento.uid}@todo-projects`);
    lineas.push(`DTSTAMP:${sello}`);

    if (eventoUsaTzid(evento) && evento.zona) {
      const paredInicio = aHoraPared(evento.inicio, evento.zona);
      const paredFin = new Date(paredInicio.getTime() + UNA_HORA_EN_MILISEGUNDOS);
      lineas.push(`DTSTART;TZID=${evento.zona}:${formatearCamposUtc(paredInicio)}`);
      lineas.push(`DTEND;TZID=${evento.zona}:${formatearCamposUtc(paredFin)}`);
    } else {
      lineas.push(`DTSTART:${formatearFechaUtc(evento.inicio)}`);
      lineas.push(
        `DTEND:${formatearFechaUtc(new Date(evento.inicio.getTime() + UNA_HORA_EN_MILISEGUNDOS))}`,
      );
    }

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
