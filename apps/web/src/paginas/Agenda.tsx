import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import esLocale from "@fullcalendar/core/locales/es";
import type { DatesSetArg, EventClickArg, EventInput } from "@fullcalendar/core";

import { peticion } from "../api";
import { formatearFechaHoraEs } from "../recurrencia-web";

export interface OcurrenciaAgenda {
  tareaId: string;
  titulo: string;
  proyectoId: string;
  proyectoNombre: string;
  columnaId: string;
  columnaNombre: string;
  fecha: string;
  esRecurrente: boolean;
}

type Vista = "lista" | "calendario";

function claveDia(iso: string): string {
  const fecha = new Date(iso);
  const dosDigitos = (valor: number) => String(valor).padStart(2, "0");
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}`;
}

function etiquetaDia(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function rangoProximos30Dias(): { desde: string; hasta: string } {
  const desde = new Date();
  const hasta = new Date(desde.getTime() + 30 * 24 * 60 * 60 * 1000);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

export default function Agenda() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [vista, setVista] = useState<Vista>("lista");

  const [rangoLista] = useState(rangoProximos30Dias);
  const lista = useQuery({
    queryKey: ["agenda", rangoLista.desde, rangoLista.hasta],
    queryFn: () =>
      peticion<OcurrenciaAgenda[]>(
        `/agenda?desde=${encodeURIComponent(rangoLista.desde)}&hasta=${encodeURIComponent(rangoLista.hasta)}`,
      ),
    enabled: vista === "lista",
  });

  const [rangoCalendario, setRangoCalendario] = useState<{ desde: string; hasta: string } | null>(
    null,
  );
  const calendario = useQuery({
    queryKey: ["agenda", rangoCalendario?.desde, rangoCalendario?.hasta],
    queryFn: () =>
      peticion<OcurrenciaAgenda[]>(
        `/agenda?desde=${encodeURIComponent(rangoCalendario!.desde)}&hasta=${encodeURIComponent(rangoCalendario!.hasta)}`,
      ),
    enabled: vista === "calendario" && rangoCalendario !== null,
  });

  const eventos: EventInput[] =
    calendario.data?.map((ocurrencia) => ({
      id: `${ocurrencia.tareaId}-${ocurrencia.fecha}`,
      title: ocurrencia.titulo,
      start: ocurrencia.fecha,
      extendedProps: { proyectoId: ocurrencia.proyectoId },
    })) ?? [];

  return (
    <main className="contenedor">
      <h1>{t("agenda.title")}</h1>

      <div className="acciones">
        <button type="button" aria-pressed={vista === "lista"} onClick={() => setVista("lista")}>
          {t("agenda.list")}
        </button>
        <button
          type="button"
          aria-pressed={vista === "calendario"}
          onClick={() => setVista("calendario")}
        >
          {t("agenda.calendar")}
        </button>
        <a href="/api/agenda.ics">{t("agenda.download")}</a>
      </div>

      {vista === "lista" ? (
        <section aria-label={t("agenda.list")}>
          {lista.isLoading && <p>{t("app.loading")}</p>}
          {lista.isError && <p className="error">{t("auth.error")}</p>}
          {lista.data && lista.data.length === 0 && <p>{t("agenda.empty")}</p>}
          {lista.data && lista.data.length > 0 && (
            <div className="agenda-lista">
              {Object.entries(
                lista.data.reduce<Record<string, OcurrenciaAgenda[]>>((acumulado, ocurrencia) => {
                  const clave = claveDia(ocurrencia.fecha);
                  acumulado[clave] = [...(acumulado[clave] ?? []), ocurrencia];
                  return acumulado;
                }, {}),
              ).map(([clave, ocurrencias]) => (
                <section key={clave}>
                  <h2>{etiquetaDia(ocurrencias[0]!.fecha)}</h2>
                  <ul>
                    {ocurrencias.map((ocurrencia) => (
                      <li key={`${ocurrencia.tareaId}-${ocurrencia.fecha}`}>
                        <span className="agenda-hora">
                          {formatearFechaHoraEs(ocurrencia.fecha)}
                        </span>{" "}
                        <Link to={`/proyectos/${ocurrencia.proyectoId}`}>
                          {ocurrencia.titulo} · {ocurrencia.proyectoNombre}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section aria-label={t("agenda.calendar")}>
          <FullCalendar
            plugins={[dayGridPlugin]}
            initialView="dayGridMonth"
            locale={esLocale}
            events={eventos}
            datesSet={(info: DatesSetArg) =>
              setRangoCalendario({ desde: info.startStr, hasta: info.endStr })
            }
            eventClick={(info: EventClickArg) => {
              info.jsEvent.preventDefault();
              const proyectoId = info.event.extendedProps.proyectoId;
              if (typeof proyectoId === "string") {
                navigate(`/proyectos/${proyectoId}`);
              }
            }}
          />
        </section>
      )}
    </main>
  );
}
