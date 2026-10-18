import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { peticion, type UsuarioApi } from "./api";
import { Disposicion } from "./componentes/Disposicion";
import Login from "./paginas/Login";
import Registro from "./paginas/Registro";
import Hoy from "./paginas/Hoy";
import Bandeja from "./paginas/Bandeja";
import Proyectos from "./paginas/Proyectos";
import ProyectoDetalle from "./paginas/ProyectoDetalle";
import TarjetaDetalle from "./paginas/TarjetaDetalle";
import Agenda from "./paginas/Agenda";
import Ajustes from "./paginas/Ajustes";
import Asistente from "./paginas/Asistente";

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
  return <Disposicion>{children}</Disposicion>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/registro" element={<Registro />} />
      <Route path="/" element={<Navigate to="/hoy" replace />} />
      <Route
        path="/hoy"
        element={
          <RutaProtegida>
            <Hoy />
          </RutaProtegida>
        }
      />
      <Route
        path="/bandeja"
        element={
          <RutaProtegida>
            <Bandeja />
          </RutaProtegida>
        }
      />
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
      >
        <Route path="tareas/:tareaId" element={<TarjetaDetalle />} />
      </Route>
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
      <Route
        path="/asistente"
        element={
          <RutaProtegida>
            <Asistente />
          </RutaProtegida>
        }
      />
    </Routes>
  );
}
