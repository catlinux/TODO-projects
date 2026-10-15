import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { peticion, type UsuarioApi } from "./api";
import { BarraNavegacion } from "./componentes/BarraNavegacion";
import Login from "./paginas/Login";
import Registro from "./paginas/Registro";
import Proyectos from "./paginas/Proyectos";
import ProyectoDetalle from "./paginas/ProyectoDetalle";
import Agenda from "./paginas/Agenda";
import Ajustes from "./paginas/Ajustes";

function useSesion() {
  return useQuery({
    queryKey: ["yo"],
    queryFn: () => peticion<UsuarioApi>("/auth/yo"),
    retry: false,
  });
}

function RutaProtegida({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { isLoading, isError } = useSesion();
  if (isLoading) return <p>{t("app.loading")}</p>;
  if (isError) return <Navigate to="/login" replace />;
  return (
    <>
      <BarraNavegacion />
      {children}
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/registro" element={<Registro />} />
      <Route path="/" element={<Navigate to="/proyectos" replace />} />
      <Route
        path="/proyectos"
        element={
          <RutaProtegida>
            <Proyectos />
          </RutaProtegida>
        }
      />
      <Route
        path="/proyectos/:id"
        element={
          <RutaProtegida>
            <ProyectoDetalle />
          </RutaProtegida>
        }
      />
      <Route
        path="/agenda"
        element={
          <RutaProtegida>
            <Agenda />
          </RutaProtegida>
        }
      />
      <Route
        path="/ajustes"
        element={
          <RutaProtegida>
            <Ajustes />
          </RutaProtegida>
        }
      />
    </Routes>
  );
}
