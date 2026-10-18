import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  peticion,
  type OcurrenciaAgenda,
  type ProyectoApi,
  type UsuarioApi,
} from "../api";
import { avisosProximos } from "../avisos-proximos";
import { colorProyecto } from "../colores";
import {
  agruparHoy,
  fechaCabecera,
  progresoPorProyecto,
  rangoHoy,
  resumenHoy,
} from "../hoy";

function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function IconoCampana({ etiqueta }: { etiqueta: string }) {
  return (
    <svg
      className="hoy-fila__campana"
      role="img"
      aria-label={etiqueta}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

interface FilaProps {
  ocurrencia: OcurrenciaAgenda;
  color: string;
  alMarcar(ocurrencia: OcurrenciaAgenda, hecha: boolean): void;
}

function Fila({ ocurrencia, color, alMarcar }: FilaProps) {
  const { t } = useTranslation();

  return (
    <li className={`hoy-fila${ocurrencia.hecha ? " hoy-fila--hecha" : ""}`}>
      <label className="hoy-fila__casilla">
        <input
          type="checkbox"
          checked={ocurrencia.hecha}
          onChange={(evento) => alMarcar(ocurrencia, evento.target.checked)}
        />
        <span className="visualmente-oculto">
          {ocurrencia.hecha ? t("hoy.markPending") : t("hoy.markDone")}
        </span>
      </label>

      <span className="hoy-fila__hora cifra">{horaCorta(ocurrencia.fecha)}</span>

      <span className="hoy-fila__titulo">{ocurrencia.titulo}</span>

      <Link className="hoy-fila__chip" to={`/proyectos/${ocurrencia.proyectoId}`}>
        <span className="hoy-fila__color" style={{ background: color }} aria-hidden="true" />
        {ocurrencia.proyectoNombre}
      </Link>

      {typeof ocurrencia.recordatorioMin === "number" && (
        <IconoCampana etiqueta={t("tasks.hasReminder")} />
      )}
    </li>
  );
}

export default function Hoy() {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const [ahora] = useState(() => new Date());
  const rango = useMemo(() => rangoHoy(ahora), [ahora]);

  const marcarHecha = useMutation({
    mutationFn: async ({
      ocurrencia,
      hecha,
    }: {
      ocurrencia: OcurrenciaAgenda;
      hecha: boolean;
    }) => {
      // Las recurrentes se marcan por ocurrencia; las demás se mueven entre la
      // última columna (hecha) y la primera (pendiente).
      if (ocurrencia.esRecurrente) {
        await peticion(`/tareas/${ocurrencia.tareaId}/ocurrencias`, {
          method: "POST",
          body: JSON.stringify({ fecha: ocurrencia.fecha, hecha }),
        });
        return;
      }

      await peticion(`/tareas/${ocurrencia.tareaId}`, {
        method: "PATCH",
        body: JSON.stringify({
          columnaId: hecha ? ocurrencia.ultimaColumnaId : ocurrencia.primeraColumnaId,
        }),
      });
    },
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["agenda"] });
      await cliente.invalidateQueries({ queryKey: ["tareas"] });
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

  // Misma consulta que la ruta protegida: el saludo se sirve de la caché.
  const { data: usuario } = useQuery({
    queryKey: ["yo"],
    queryFn: () => peticion<UsuarioApi>("/auth/yo"),
    retry: false,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["agenda", rango.desde, rango.hasta],
    queryFn: () =>
      peticion<OcurrenciaAgenda[]>(
        `/agenda?desde=${encodeURIComponent(rango.desde)}&hasta=${encodeURIComponent(rango.hasta)}`,
      ),
  });

  const secciones = useMemo(() => agruparHoy(data ?? [], ahora), [data, ahora]);
  const resumen = useMemo(() => resumenHoy(secciones), [secciones]);
  const progreso = useMemo(() => progresoPorProyecto(secciones), [secciones]);
  const avisos = useMemo(() => avisosProximos(data ?? [], ahora), [data, ahora]);
  const proximoAviso = avisos[0];

  const alMarcar = (ocurrencia: OcurrenciaAgenda, hecha: boolean) =>
    marcarHecha.mutate({ ocurrencia, hecha });

  const grupos = [
    { clave: "atrasadas", titulo: t("hoy.overdue"), ocurrencias: secciones.atrasadas },
    { clave: "hoy", titulo: t("hoy.today"), ocurrencias: secciones.hoy },
    { clave: "proximos", titulo: t("hoy.upcoming"), ocurrencias: secciones.proximos },
  ];

  const vacio = grupos.every((grupo) => grupo.ocurrencias.length === 0);
  const nombre = usuario?.nombre?.trim();

  return (
    <main className="pagina">
      <header className="pagina__cabecera">
        <div>
          <h1 className="pagina__titulo">
            {nombre ? t("hoy.greeting", { nombre }) : t("hoy.greetingNoName")}
          </h1>
          <p className="pagina__subtitulo cifra">{fechaCabecera(ahora)}</p>
        </div>
      </header>

      <div className="hoy-cifras">
        <div className="panel-tarjeta hoy-cifra">
          <span className="hoy-cifra__valor cifra">{resumen.paraHoy}</span>
          <span className="hoy-cifra__etiqueta">{t("hoy.forToday")}</span>
        </div>
        <div className="panel-tarjeta hoy-cifra">
          <span className="hoy-cifra__valor cifra">{resumen.atrasadas}</span>
          <span className="hoy-cifra__etiqueta">{t("hoy.overdue")}</span>
        </div>
        <div className="panel-tarjeta hoy-cifra">
          <span className="hoy-cifra__valor hoy-cifra__valor--aviso cifra">
            {proximoAviso ? proximoAviso.horaAvisoTexto : t("hoy.noAlert")}
          </span>
          <span className="hoy-cifra__etiqueta">{t("hoy.nextAlert")}</span>
        </div>
      </div>

      <div className="hoy">
        <div className="hoy__principal">
          {isLoading && <p>{t("app.loading")}</p>}
          {isError && <p className="error">{t("auth.error")}</p>}
          {!isLoading && !isError && vacio && (
            <p className="panel-tarjeta hoy-vacio">{t("hoy.empty")}</p>
          )}

          {!isLoading &&
            !isError &&
            grupos.map((grupo) =>
              grupo.ocurrencias.length === 0 ? null : (
                <section className="hoy-seccion" key={grupo.clave}>
                  <div className="hoy-seccion__cabecera">
                    <h2 className="hoy-seccion__titulo" id={`hoy-${grupo.clave}`}>
                      {grupo.titulo}
                    </h2>
                    <span className="hoy-seccion__contador cifra">{grupo.ocurrencias.length}</span>
                  </div>
                  <ul className="hoy-lista" aria-labelledby={`hoy-${grupo.clave}`}>
                    {grupo.ocurrencias.map((ocurrencia) => (
                      <Fila
                        key={`${ocurrencia.tareaId}-${ocurrencia.fecha}`}
                        ocurrencia={ocurrencia}
                        color={colorDeProyecto(ocurrencia.proyectoId)}
                        alMarcar={alMarcar}
                      />
                    ))}
                  </ul>
                </section>
              ),
            )}
        </div>

        <aside className="hoy__lateral" aria-label={t("hoy.sidePanel")}>
          <section className="panel-tarjeta hoy-progreso" aria-labelledby="hoy-progreso-titulo">
            <h2 id="hoy-progreso-titulo">{t("hoy.progress")}</h2>
            {progreso.length === 0 ? (
              <p className="hoy-lateral__vacio">{t("hoy.noProgress")}</p>
            ) : (
              <ul className="hoy-progreso__lista">
                {progreso.map((item) => {
                  const porcentaje =
                    item.total === 0 ? 0 : Math.round((item.hechas / item.total) * 100);
                  const etiqueta = t("hoy.progressProject", {
                    nombre: item.proyectoNombre,
                    hechas: item.hechas,
                    total: item.total,
                  });
                  return (
                    <li key={item.proyectoId} className="hoy-progreso__item">
                      <div className="hoy-progreso__cabecera">
                        <Link className="hoy-fila__chip" to={`/proyectos/${item.proyectoId}`}>
                          <span
                            className="hoy-fila__color"
                            style={{ background: colorDeProyecto(item.proyectoId) }}
                            aria-hidden="true"
                          />
                          {item.proyectoNombre}
                        </Link>
                        <span className="hoy-progreso__valor cifra">
                          {item.hechas}/{item.total}
                        </span>
                      </div>
                      <div
                        className="hoy-progreso__barra"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={item.total}
                        aria-valuenow={item.hechas}
                        aria-label={etiqueta}
                      >
                        <span
                          className="hoy-progreso__relleno"
                          style={{
                            width: `${porcentaje}%`,
                            background: colorDeProyecto(item.proyectoId),
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel-tarjeta hoy-avisos" aria-labelledby="hoy-avisos-titulo">
            <h2 id="hoy-avisos-titulo">{t("agenda.upcoming")}</h2>
            {avisos.length === 0 ? (
              <p className="hoy-lateral__vacio">{t("agenda.noUpcoming")}</p>
            ) : (
              <ul className="hoy-avisos__lista">
                {avisos.map((aviso) => (
                  <li key={`${aviso.tareaId}-${aviso.horaAviso}`} className="hoy-aviso">
                    <span
                      className="hoy-aviso__punto"
                      style={{ background: colorDeProyecto(aviso.proyectoId) }}
                      aria-hidden="true"
                    />
                    <span className="hoy-aviso__hora cifra">{aviso.horaAvisoTexto}</span>
                    <Link className="hoy-aviso__titulo" to={`/proyectos/${aviso.proyectoId}`}>
                      {aviso.titulo}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
