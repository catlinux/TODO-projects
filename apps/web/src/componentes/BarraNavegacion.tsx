import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useNavigate } from "react-router-dom";

import { peticion, type OcurrenciaAgenda, type ProyectoApi } from "../api";
import { colorProyecto } from "../colores";
import { agruparHoy, pendientesHoy, rangoHoy } from "../hoy";
import { AvisosNavegador } from "./AvisosNavegador";

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

export function BarraNavegacion() {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const navigate = useNavigate();
  const [ahora] = useState(() => new Date());
  const rango = useMemo(() => rangoHoy(ahora), [ahora]);

  const { data: proyectos } = useQuery({
    queryKey: ["proyectos"],
    queryFn: () => peticion<ProyectoApi[]>("/proyectos"),
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

  const cerrarSesion = useMutation({
    mutationFn: async () => {
      await peticion("/auth/logout", { method: "POST" });
    },
    onSuccess: () => {
      cliente.clear();
      navigate("/login");
    },
  });

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

        <NavLink to="/hoy" className="menu-lateral__enlace">
          <Icono>
            <circle cx="12" cy="12" r="9" />
            <path d="m8.5 12.5 2.5 2.4 4.5-5.2" />
          </Icono>
          {t("nav.hoy")}
          {pendientes > 0 && (
            <>
              <span className="visualmente-oculto">
                {t("hoy.pendingCount", { n: pendientes })}
              </span>
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
          {(proyectos ?? []).map((proyecto, indice) => (
            <li key={proyecto.id}>
              <NavLink to={`/proyectos/${proyecto.id}`} className="menu-lateral__proyecto">
                <span
                  className="menu-lateral__color"
                  style={{ background: colorProyecto(indice) }}
                  aria-hidden="true"
                />
                <span className="menu-lateral__proyecto-nombre">{proyecto.nombre}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <NavLink to="/proyectos" end className="menu-lateral__nuevo">
          <Icono>
            <path d="M12 5v14M5 12h14" />
          </Icono>
          {t("nav.newProject")}
        </NavLink>

        <div className="menu-lateral__pie">
          <NavLink to="/ajustes" className="menu-lateral__enlace">
            <Icono>
              <path d="M4 7h8M18 7h2M4 17h2M10 17h10" />
              <circle cx="15" cy="7" r="2" />
              <circle cx="7" cy="17" r="2" />
            </Icono>
            {t("nav.settings")}
          </NavLink>
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
        <NavLink to="/proyectos" className="barra-inferior__enlace">
          <Icono>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </Icono>
          {t("nav.projects")}
        </NavLink>
        <NavLink to="/agenda" className="barra-inferior__enlace">
          <Icono>
            <rect x="3" y="4" width="18" height="17" rx="3" />
            <path d="M8 2v4M16 2v4M3 10h18" />
          </Icono>
          {t("nav.agenda")}
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
