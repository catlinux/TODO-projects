import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { peticion, type OcurrenciaAgenda, type ProyectoApi } from "../api";
import { colorProyecto } from "../colores";
import { chipFecha } from "../fechas";
import { agruparHoy, fechaCabecera, rangoHoy } from "../hoy";

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
  const chip = chipFecha(ocurrencia.fecha);

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

      <span className="hoy-fila__titulo">{ocurrencia.titulo}</span>

      <Link className="hoy-fila__proyecto" to={`/proyectos/${ocurrencia.proyectoId}`}>
        <span className="hoy-fila__color" style={{ background: color }} aria-hidden="true" />
        {ocurrencia.proyectoNombre}
      </Link>

      <span className="hoy-fila__meta">
        {chip && <span className={`chip-fecha chip-fecha--${chip.estado} mono`}>{chip.texto}</span>}
        {typeof ocurrencia.recordatorioMin === "number" && (
          <IconoCampana etiqueta={t("tasks.hasReminder")} />
        )}
      </span>
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

  const { data, isLoading, isError } = useQuery({
    queryKey: ["agenda", rango.desde, rango.hasta],
    queryFn: () =>
      peticion<OcurrenciaAgenda[]>(
        `/agenda?desde=${encodeURIComponent(rango.desde)}&hasta=${encodeURIComponent(rango.hasta)}`,
      ),
  });

  const secciones = useMemo(() => agruparHoy(data ?? [], ahora), [data, ahora]);

  const alMarcar = (ocurrencia: OcurrenciaAgenda, hecha: boolean) =>
    marcarHecha.mutate({ ocurrencia, hecha });

  const grupos = [
    { clave: "atrasadas", titulo: t("hoy.overdue"), ocurrencias: secciones.atrasadas },
    { clave: "hoy", titulo: t("hoy.today"), ocurrencias: secciones.hoy },
    { clave: "proximos", titulo: t("hoy.upcoming"), ocurrencias: secciones.proximos },
  ];

  const vacio = grupos.every((grupo) => grupo.ocurrencias.length === 0);

  return (
    <main className="contenedor contenedor--hoy">
      <header className="hoy-cabecera">
        <p className="hoy-cabecera__fecha mono">{fechaCabecera(ahora)}</p>
        <h1>{t("hoy.title")}</h1>
      </header>

      {isLoading && <p>{t("app.loading")}</p>}
      {isError && <p className="error">{t("auth.error")}</p>}
      {!isLoading && !isError && vacio && <p className="hoy-vacio">{t("hoy.empty")}</p>}

      {!isLoading &&
        !isError &&
        grupos.map((grupo) =>
          grupo.ocurrencias.length === 0 ? null : (
            <section className="hoy-seccion" key={grupo.clave} aria-labelledby={`hoy-${grupo.clave}`}>
              <h2 id={`hoy-${grupo.clave}`}>{grupo.titulo}</h2>
              <ul className="hoy-lista">
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
    </main>
  );
}
