import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import esLocale from "@fullcalendar/core/locales/es";
import type {
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventInput,
} from "@fullcalendar/core";

import { peticion, type OcurrenciaAgenda, type ProyectoApi } from "../api";
import { avisosProximos } from "../avisos-proximos";
import { colorProyecto } from "../colores";
import { formatearFechaHoraEs } from "../recurrencia-web";

type Vista = "lista" | "calendario";

interface Rango {
  desde: string;
  hasta: string;
}

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;
const DIAS_AVISOS = 7;
const DIAS_LISTA = 30;
// Texto oscuro sobre los fondos suaves de proyecto (contraste muy superior a 4.5:1).
const TEXTO_EVENTO = "#1b1f27";

function urlAgenda(rango: Rango): string {
  return `/agenda?desde=${encodeURIComponent(rango.desde)}&hasta=${encodeURIComponent(rango.hasta)}`;
}

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

/** Etiqueta larga del día a partir de su clave local `YYYY-MM-DD`. */
function etiquetaDiaClave(clave: string): string {
  const [anio, mes, dia] = clave.split("-").map(Number);
  return new Date(anio ?? 0, (mes ?? 1) - 1, dia ?? 1).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function rangoProximosDias(dias: number): Rango {
  const desde = new Date();
  return {
    desde: desde.toISOString(),
    hasta: new Date(desde.getTime() + dias * MILISEGUNDOS_POR_DIA).toISOString(),
  };
}

function cubre(rango: Rango | null, objetivo: Rango): boolean {
  if (!rango) {
    return false;
  }
  return (
    new Date(rango.desde).getTime() <= new Date(objetivo.desde).getTime() &&
    new Date(rango.hasta).getTime() >= new Date(objetivo.hasta).getTime()
  );
}

/** Aclara un color mezclándolo con blanco, para usarlo de fondo suave. */
function fondoSuave(color: string, proporcion = 0.82): string {
  const limpio = color.replace("#", "");
  const canales = [0, 2, 4].map((inicio) => parseInt(limpio.slice(inicio, inicio + 2), 16));
  return `rgb(${canales
    .map((canal) => Math.round(canal + (255 - canal) * proporcion))
    .join(", ")})`;
}

export default function Agenda() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cliente = useQueryClient();
  const [vista, setVista] = useState<Vista>("calendario");

  const marcarHecha = useMutation({
    mutationFn: async ({
      tareaId,
      fecha,
      hecha,
    }: {
      tareaId: string;
      fecha: string;
      hecha: boolean;
    }) => {
      await peticion(`/tareas/${tareaId}/ocurrencias`, {
        method: "POST",
        body: JSON.stringify({ fecha, hecha }),
      });
    },
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["agenda"] });
    },
  });

  const { data: proyectos } = useQuery({
    queryKey: ["proyectos"],
    queryFn: () => peticion<ProyectoApi[]>("/proyectos"),
  });

  // El color de proyecto va por el orden de GET /proyectos, igual que el menú.
  const colorDeProyecto = useMemo(() => {
    const indices = new Map((proyectos ?? []).map((proyecto, indice) => [proyecto.id, indice]));
    return (proyectoId: string) => colorProyecto(indices.get(proyectoId) ?? 0);
  }, [proyectos]);

  const [rangoLista] = useState(() => rangoProximosDias(DIAS_LISTA));
  const lista = useQuery({
    queryKey: ["agenda", rangoLista.desde, rangoLista.hasta],
    queryFn: () => peticion<OcurrenciaAgenda[]>(urlAgenda(rangoLista)),
    enabled: vista === "lista",
  });

  const [rangoCalendario, setRangoCalendario] = useState<Rango | null>(null);
  const calendario = useQuery({
    queryKey: ["agenda", rangoCalendario?.desde, rangoCalendario?.hasta],
    queryFn: () => peticion<OcurrenciaAgenda[]>(urlAgenda(rangoCalendario as Rango)),
    enabled: vista === "calendario" && rangoCalendario !== null,
  });

  // Día resaltado en el calendario y mostrado en el panel de abajo.
  const [diaSeleccionado, setDiaSeleccionado] = useState(() =>
    claveDia(new Date().toISOString()),
  );

  const ocurrenciasDia = useMemo(
    () => (calendario.data ?? []).filter((ocurrencia) => claveDia(ocurrencia.fecha) === diaSeleccionado),
    [calendario.data, diaSeleccionado],
  );

  const [rangoAvisos] = useState(() => rangoProximosDias(DIAS_AVISOS));
  const ahora = useMemo(() => new Date(rangoAvisos.desde), [rangoAvisos]);

  // La lista cubre los próximos 30 días; el mes del calendario no siempre cubre
  // los 7 días de avisos, así que en ese caso se consulta aparte ese rango.
  const calendarioCubreAvisos = cubre(rangoCalendario, rangoAvisos);
  const avisosAparte = useQuery({
    queryKey: ["agenda", rangoAvisos.desde, rangoAvisos.hasta],
    queryFn: () => peticion<OcurrenciaAgenda[]>(urlAgenda(rangoAvisos)),
    enabled: vista === "calendario" && rangoCalendario !== null && !calendarioCubreAvisos,
  });

  const ocurrenciasAvisos =
    vista === "lista" ? lista.data : calendarioCubreAvisos ? calendario.data : avisosAparte.data;

  const proximos = useMemo(
    () => avisosProximos(ocurrenciasAvisos ?? [], ahora),
    [ocurrenciasAvisos, ahora],
  );

  const cargandoAvisos =
    vista === "lista"
      ? lista.isLoading
      : rangoCalendario === null
        ? true
        : calendarioCubreAvisos
          ? calendario.isLoading
          : avisosAparte.isLoading;

  const etiquetaAntelacion = (minutos: number): string =>
    t(`tasks.reminderOptions.${minutos}`, { defaultValue: t("tasks.reminderUnknown", { minutos }) });

  const eventos: EventInput[] = useMemo(
    () =>
      (calendario.data ?? []).map((ocurrencia) => {
        const color = colorDeProyecto(ocurrencia.proyectoId);
        return {
          id: `${ocurrencia.tareaId}-${ocurrencia.fecha}`,
          title: ocurrencia.titulo,
          start: ocurrencia.fecha,
          backgroundColor: fondoSuave(color),
          borderColor: color,
          textColor: TEXTO_EVENTO,
          classNames: ocurrencia.hecha ? ["hecha"] : [],
          extendedProps: { proyectoId: ocurrencia.proyectoId },
        };
      }),
    [calendario.data, colorDeProyecto],
  );

  // Evento del mes: punto de color, hora y título (máximo 2 por día y «+N más»).
  const contenidoEvento = (arg: EventContentArg) => (
    <span className="agenda-evento">
      <span
        className="agenda-evento__punto"
        style={{ background: arg.event.borderColor || arg.event.backgroundColor }}
        aria-hidden="true"
      />
      {arg.timeText && <span className="agenda-evento__hora">{arg.timeText}</span>}
      <span className="agenda-evento__titulo">{arg.event.title}</span>
    </span>
  );

  return (
    <main className="pagina">
      <header className="pagina__cabecera">
        <h1 className="pagina__titulo">{t("agenda.title")}</h1>
        <div className="pagina__acciones">
          <div className="control-segmentado">
            <button
              type="button"
              aria-pressed={vista === "calendario"}
              onClick={() => setVista("calendario")}
            >
              {t("agenda.calendar")}
            </button>
            <button type="button" aria-pressed={vista === "lista"} onClick={() => setVista("lista")}>
              {t("agenda.list")}
            </button>
          </div>
          <a className="boton" href="/api/agenda.ics">
            {t("agenda.download")}
          </a>
        </div>
      </header>

      <div className="agenda">
        {vista === "lista" ? (
          <section className="agenda__principal" aria-label={t("agenda.list")}>
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
                        <li
                          key={`${ocurrencia.tareaId}-${ocurrencia.fecha}`}
                          className={ocurrencia.hecha ? "agenda-hecha" : undefined}
                        >
                          <label>
                            <input
                              type="checkbox"
                              checked={ocurrencia.hecha}
                              onChange={(evento) =>
                                marcarHecha.mutate({
                                  tareaId: ocurrencia.tareaId,
                                  fecha: ocurrencia.fecha,
                                  hecha: evento.target.checked,
                                })
                              }
                            />
                            {t("agenda.done")}
                          </label>{" "}
                          <span className="agenda-hora cifra">
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
          <section className="agenda__principal" aria-label={t("agenda.calendar")}>
            <FullCalendar
              plugins={[dayGridPlugin]}
              initialView="dayGridMonth"
              locale={esLocale}
              headerToolbar={{ left: "prev today next", center: "title", right: "" }}
              buttonText={{
                prev: t("agenda.prev"),
                today: t("agenda.today"),
                next: t("agenda.next"),
              }}
              height="auto"
              displayEventTime
              eventDisplay="block"
              eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
              dayMaxEvents={2}
              moreLinkText={t("agenda.more")}
              eventContent={contenidoEvento}
              events={eventos}
              navLinks
              navLinkDayClick={(fecha) => setDiaSeleccionado(claveDia(fecha.toISOString()))}
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

            <section
              className="panel-tarjeta agenda-dia"
              aria-labelledby="agenda-dia-titulo"
            >
              <h2 id="agenda-dia-titulo">{etiquetaDiaClave(diaSeleccionado)}</h2>
              {calendario.isLoading && <p>{t("app.loading")}</p>}
              {!calendario.isLoading && ocurrenciasDia.length === 0 && (
                <p className="agenda-dia__vacio">{t("agenda.dayEmpty")}</p>
              )}
              {ocurrenciasDia.length > 0 && (
                <ul className="agenda-dia__lista">
                  {ocurrenciasDia.map((ocurrencia) => (
                    <li
                      key={`${ocurrencia.tareaId}-${ocurrencia.fecha}`}
                      className={`agenda-dia__fila${
                        ocurrencia.hecha ? " agenda-dia__fila--hecha" : ""
                      }`}
                    >
                      <label className="agenda-dia__casilla">
                        <input
                          type="checkbox"
                          checked={ocurrencia.hecha}
                          onChange={(evento) =>
                            marcarHecha.mutate({
                              tareaId: ocurrencia.tareaId,
                              fecha: ocurrencia.fecha,
                              hecha: evento.target.checked,
                            })
                          }
                        />
                        <span className="visualmente-oculto">
                          {ocurrencia.hecha ? t("hoy.markPending") : t("hoy.markDone")}
                        </span>
                      </label>
                      <span className="agenda-dia__hora cifra">{horaCorta(ocurrencia.fecha)}</span>
                      <Link className="agenda-dia__titulo" to={`/proyectos/${ocurrencia.proyectoId}`}>
                        {ocurrencia.titulo}
                      </Link>
                      <span className="hoy-fila__chip">
                        <span
                          className="hoy-fila__color"
                          style={{ background: colorDeProyecto(ocurrencia.proyectoId) }}
                          aria-hidden="true"
                        />
                        {ocurrencia.proyectoNombre}
                      </span>
                      {typeof ocurrencia.recordatorioMin === "number" && (
                        <span className="agenda-dia__aviso">
                          {t("agenda.alert", { valor: etiquetaAntelacion(ocurrencia.recordatorioMin) })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </section>
        )}

        <aside
          className="panel-tarjeta agenda__avisos"
          aria-labelledby="agenda-avisos-titulo"
        >
          <h2 id="agenda-avisos-titulo">{t("agenda.upcoming")}</h2>
          {cargandoAvisos && <p>{t("app.loading")}</p>}
          {!cargandoAvisos && proximos.length === 0 && (
            <p className="agenda__avisos-vacio">{t("agenda.noUpcoming")}</p>
          )}
          {proximos.length > 0 && (
            <ul className="agenda__avisos-lista">
              {proximos.map((aviso) => (
                <li key={`${aviso.tareaId}-${aviso.horaAviso}`} className="aviso">
                  <span className="aviso__hora cifra">{aviso.horaAvisoTexto}</span>
                  <Link className="aviso__titulo" to={`/proyectos/${aviso.proyectoId}`}>
                    {aviso.titulo}
                  </Link>
                  <span className="aviso__proyecto">
                    <span
                      className="aviso__color"
                      style={{ background: colorDeProyecto(aviso.proyectoId) }}
                      aria-hidden="true"
                    />
                    {aviso.proyectoNombre}
                  </span>
                  <span className="aviso__antelacion">
                    {etiquetaAntelacion(aviso.recordatorioMin)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  );
}
