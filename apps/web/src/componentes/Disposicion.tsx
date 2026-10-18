import { useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { peticion, type ProyectoApi } from "../api";
import { useAtajos } from "../atajos";
import { AyudaAtajos } from "./AyudaAtajos";
import { BarraNavegacion } from "./BarraNavegacion";
import { Paleta } from "./Paleta";

export function Disposicion({ children }: { children: ReactNode }) {
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const [paletaAbierta, setPaletaAbierta] = useState(false);
  const [ayudaAbierta, setAyudaAbierta] = useState(false);

  // Proyecto abierto, si la ruta es /proyectos/:id (con o sin tarjeta encima).
  const coincidencia = /^\/proyectos\/([^/]+)/.exec(pathname);
  const proyectoAbiertoId = coincidencia?.[1] ?? null;

  // Misma clave que el menú: sirve para el respaldo de «Nueva tarea».
  const { data: proyectos } = useQuery({
    queryKey: ["proyectos"],
    queryFn: () => peticion<ProyectoApi[]>("/proyectos"),
  });

  function irANuevaTarea(conRespaldo: boolean) {
    const destino = proyectoAbiertoId ?? (conRespaldo ? proyectos?.[0]?.id : undefined);
    if (destino) {
      navegar(`/proyectos/${destino}?nueva=1`);
    } else if (conRespaldo) {
      navegar("/proyectos");
    }
  }

  useAtajos({
    onBuscar: () => setPaletaAbierta(true),
    onNuevaTarea: () => irANuevaTarea(false),
    onHoy: () => navegar("/hoy"),
    onBandeja: () => navegar("/bandeja"),
    onAgenda: () => navegar("/agenda"),
    onAyuda: () => setAyudaAbierta(true),
  });

  return (
    <>
      <div className="disposicion">
        <BarraNavegacion onAbrirBuscar={() => setPaletaAbierta(true)} />
        <div
          className={`disposicion__contenido${proyectoAbiertoId ? " disposicion__contenido--lienzo" : ""}`}
        >
          {children}
        </div>
      </div>
      <Paleta
        abierto={paletaAbierta}
        onCerrar={() => setPaletaAbierta(false)}
        onNuevaTarea={() => irANuevaTarea(true)}
      />
      <AyudaAtajos abierto={ayudaAbierta} onCerrar={() => setAyudaAbierta(false)} />
    </>
  );
}
