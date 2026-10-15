import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { peticion } from "../api";
import { AvisosNavegador } from "./AvisosNavegador";

export function BarraNavegacion() {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const navigate = useNavigate();

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
    <nav className="barra-navegacion">
      <Link to="/proyectos">{t("nav.projects")}</Link>
      <Link to="/agenda">{t("nav.agenda")}</Link>
      <Link to="/ajustes">{t("nav.settings")}</Link>
      <AvisosNavegador />
      <button type="button" onClick={() => cerrarSesion.mutate()} disabled={cerrarSesion.isPending}>
        {t("nav.logout")}
      </button>
    </nav>
  );
}
