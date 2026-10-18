import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import {
  peticion,
  type OcurrenciaAgenda,
  type ProyectoApi,
  type RespuestaBandejaApi,
  type UsuarioApi,
} from "../api";
import { useCerrarSesion } from "../cerrarSesion";
import { colorProyecto } from "../colores";
import { agruparHoy, pendientesHoy, rangoHoy } from "../hoy";
import { inicial } from "../inicial";
import { useTema, type Tema } from "../tema";
import { AvisosNavegador } from "./AvisosNavegador";

const OPCIONES_TEMA: readonly Tema[] = ["claro", "oscuro", "sistema"];

function Icono({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="icono"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * Blanco o negro según la luminancia del color de fondo: dos colores de la
 * paleta no llegan a 4.5:1 con el blanco y necesitan la inicial en negro.
 */
function textoSobreColor(fondo: string): string {
  const hex = fondo.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return "#ffffff";
  }

  function luminancia(par: number): number {
    const canal = par / 255;
    return canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4;
  }

  const r = luminancia(parseInt(hex.slice(0, 2), 16));
  const g = luminancia(parseInt(hex.slice(2, 4), 16));
  const b = luminancia(parseInt(hex.slice(4, 6), 16));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  return l > 0.179 ? "#000000" : "#ffffff";
}

export interface PropiedadesBarraNavegacion {
  /** Abre la paleta de búsqueda (Ctrl/⌘+K). */
  onAbrirBuscar?: () => void;
}

/** En macOS el atajo se muestra como ⌘K; en el resto, Ctrl K. */
function etiquetaAtajoBusqueda(): string {
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";
}

export function BarraNavegacion({ onAbrirBuscar }: PropiedadesBarraNavegacion = {}) {
  const { t } = useTranslation();
  const [ahora] = useState(() => new Date());
  const rango = useMemo(() => rangoHoy(ahora), [ahora]);
  const { tema, cambiarTema } = useTema();

  const { data: proyectos } = useQuery({
    queryKey: ["proyectos"],
    queryFn: () => peticion<ProyectoApi[]>("/proyectos"),
  });

  // Misma consulta que la ruta protegida: el perfil se sirve de la caché.
  const { data: usuario } = useQuery({
    queryKey: ["yo"],
    queryFn: () => peticion<UsuarioApi>("/auth/yo"),
    retry: false,
  });

  // Misma consulta y clave que la página «Hoy», así no se pide dos veces.
  const { data: ocurrencias } = useQuery({
    queryKey: ["agenda", rango.desde, rango.hasta],
    queryFn: () =>
      peticion<OcurrenciaAgenda[]>(
        `/agenda?desde=${encodeURIComponent(rango.desde)}&hasta=${encodeURIComponent(rango.hasta)}`,
      ),
  });

  const pendientes = pendientesHoy(agruparHoy(ocurrencias ?? [], ahora));

  // Misma consulta y clave que la página «Bandeja»: el contador sale de la caché.
  const { data: bandeja } = useQuery({
    queryKey: ["bandeja"],
    queryFn: () => peticion<RespuestaBandejaApi>("/bandeja"),
  });

  const pendientesBandeja = bandeja?.tareas.length ?? 0;

  const cerrarSesion = useCerrarSesion();

  return (
    <>
      <nav className="menu-lateral" aria-label={t("nav.sidebar")}>
        <div className="menu-lateral__logo">
          <span className="menu-lateral__marca" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <span className="menu-lateral__nombre">{t("app.title")}</span>
        </div>

        {/* «Buscar ⌘K»: abre la paleta (paso D2). */}
        <button type="button" className="menu-lateral__buscar" onClick={onAbrirBuscar}>
          <Icono>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </Icono>
          <span className="menu-lateral__buscar-texto">{t("nav.search")}</span>
          <kbd className="menu-lateral__atajo">{etiquetaAtajoBusqueda()}</kbd>
        </button>

        <NavLink to="/bandeja" className="menu-lateral__enlace">
          <Icono>
            <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
            <path d="M3 13h5l1.5 2.5h5L16 13h5" />
          </Icono>
          {t("nav.inbox")}
          {pendientesBandeja > 0 && (
            <>
              <span className="visualmente-oculto">
                {t("inbox.pendingCount", { n: pendientesBandeja })}
              </span>
              <span className="menu-lateral__contador" aria-hidden="true">
                {pendientesBandeja}
              </span>
            </>
          )}
        </NavLink>

        <NavLink to="/hoy" className="menu-lateral__enlace">
          <Icono>
            <circle cx="12" cy="12" r="9" />
            <path d="m8.5 12.5 2.5 2.4 4.5-5.2" />
          </Icono>
          {t("nav.hoy")}
          {pendientes > 0 && (
            <>
              <span className="visualmente-oculto">{t("hoy.pendingCount", { n: pendientes })}</span>
              <span className="menu-lateral__contador" aria-hidden="true">
                {pendientes}
              </span>
            </>
          )}
        </NavLink>

        <NavLink to="/agenda" className="menu-lateral__enlace">
          <Icono>
            <rect x="3" y="4" width="18" height="17" rx="3" />
            <path d="M8 2v4M16 2v4M3 10h18" />
          </Icono>
          {t("nav.agenda")}
        </NavLink>

        <h2 className="menu-lateral__titulo">{t("projects.title")}</h2>
        <ul className="menu-lateral__proyectos">
          {(proyectos ?? []).map((proyecto, indice) => {
            const color = proyecto.color ?? colorProyecto(indice);
            return (
              <li key={proyecto.id}>
                <NavLink to={`/proyectos/${proyecto.id}`} className="menu-lateral__proyecto">
                  <span
                    className="menu-lateral__color"
                    style={{ backgroundColor: color, color: textoSobreColor(color) }}
                    aria-hidden="true"
                  >
                    {inicial(proyecto.nombre)}
                  </span>
                  <span className="menu-lateral__proyecto-nombre" title={proyecto.nombre}>
                    {proyecto.nombre}
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ul>
        <NavLink to="/proyectos" end className="menu-lateral__nuevo">
          <Icono>
            <path d="M12 5v14M5 12h14" />
          </Icono>
          {t("nav.newProject")}
        </NavLink>

        <div className="menu-lateral__pie">
          <div className="menu-lateral__perfil">
            <span className="menu-lateral__avatar" aria-hidden="true">
              {inicial(usuario?.nombre ?? "")}
            </span>
            <span className="menu-lateral__perfil-nombre" title={usuario?.nombre ?? ""}>
              {usuario?.nombre ?? ""}
            </span>
          </div>

          <NavLink to="/ajustes" className="menu-lateral__enlace">
            <Icono>
              <path d="M4 7h8M18 7h2M4 17h2M10 17h10" />
              <circle cx="15" cy="7" r="2" />
              <circle cx="7" cy="17" r="2" />
            </Icono>
            {t("nav.settings")}
          </NavLink>

          <label className="menu-lateral__tema">
            {t("nav.theme")}
            <select value={tema} onChange={(evento) => cambiarTema(evento.target.value as Tema)}>
              {OPCIONES_TEMA.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {t(`nav.themeOptions.${opcion}`)}
                </option>
              ))}
            </select>
          </label>

          <AvisosNavegador />

          <button
            type="button"
            className="menu-lateral__salir"
            onClick={() => cerrarSesion.mutate()}
            disabled={cerrarSesion.isPending}
          >
            <Icono>
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <path d="M10 17l5-5-5-5M15 12H3" />
            </Icono>
            {t("nav.logout")}
          </button>
        </div>
      </nav>

      <nav className="barra-inferior" aria-label={t("nav.bottom")}>
        <NavLink to="/hoy" className="barra-inferior__enlace">
          <Icono>
            <circle cx="12" cy="12" r="9" />
            <path d="m8.5 12.5 2.5 2.4 4.5-5.2" />
          </Icono>
          {t("nav.hoy")}
        </NavLink>
        <NavLink to="/agenda" className="barra-inferior__enlace">
          <Icono>
            <rect x="3" y="4" width="18" height="17" rx="3" />
            <path d="M8 2v4M16 2v4M3 10h18" />
          </Icono>
          {t("nav.agenda")}
        </NavLink>
        <NavLink to="/proyectos" className="barra-inferior__enlace">
          <Icono>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </Icono>
          {t("nav.projects")}
        </NavLink>
        <NavLink to="/ajustes" className="barra-inferior__enlace">
          <Icono>
            <path d="M4 7h8M18 7h2M4 17h2M10 17h10" />
            <circle cx="15" cy="7" r="2" />
            <circle cx="7" cy="17" r="2" />
          </Icono>
          {t("nav.settings")}
        </NavLink>
      </nav>
    </>
  );
}
