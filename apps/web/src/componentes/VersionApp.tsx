import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { peticion } from "../api";

interface Salud {
  version?: string;
}

/** Compara la versión de la web cargada con la que sirve el servidor. */
export function VersionApp() {
  const { t } = useTranslation();
  const servidor = useQuery({
    queryKey: ["version-servidor"],
    queryFn: () => peticion<Salud>("/salud"),
    staleTime: 0,
    retry: false,
  });

  const versionServidor = servidor.data?.version;
  const desactualizada = versionServidor !== undefined && versionServidor !== __VERSION_WEB__;

  return (
    <section className="panel-tarjeta" aria-labelledby="ajustes-version">
      <div className="panel-tarjeta__cabecera">
        <h2 className="panel-tarjeta__titulo" id="ajustes-version">
          {t("settings.version")}
        </h2>
        <p className="panel-tarjeta__descripcion">{t("settings.versionDescription")}</p>
      </div>
      <dl>
        <dt>{t("settings.versionWeb")}</dt>
        <dd className="cifra">{__VERSION_WEB__}</dd>
        <dt>{t("settings.versionServer")}</dt>
        <dd className="cifra">{versionServidor ?? t("settings.versionUnknown")}</dd>
      </dl>
      {versionServidor !== undefined && (
        <p role="status">
          {desactualizada ? t("settings.versionOutdated") : t("settings.versionUpToDate")}
        </p>
      )}
      {desactualizada && (
        <button type="button" className="boton-principal" onClick={() => window.location.reload()}>
          {t("settings.versionReload")}
        </button>
      )}
    </section>
  );
}
