import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorHttp, peticion } from "../api";
import { activarPush, desactivarPush, estadoPush, soportaPush, type EstadoPush } from "../push";

type Estado = EstadoPush | "servidor-sin-configurar" | "comprobando";

export function AvisosNavegador() {
  const { t } = useTranslation();
  const [estado, setEstado] = useState<Estado>("comprobando");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let activo = true;

    async function comprobar(): Promise<void> {
      if (!soportaPush()) {
        if (activo) setEstado("no-soportado");
        return;
      }

      try {
        await peticion("/push/clave");
      } catch (err) {
        if (err instanceof ErrorHttp && err.status === 404) {
          if (activo) setEstado("servidor-sin-configurar");
          return;
        }
      }

      const siguiente = await estadoPush();
      if (activo) setEstado(siguiente);
    }

    void comprobar();
    return () => {
      activo = false;
    };
  }, []);

  async function activar(): Promise<void> {
    setOcupado(true);
    setError(null);
    try {
      setEstado(await activarPush());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("push.error"));
      setEstado(await estadoPush());
    } finally {
      setOcupado(false);
    }
  }

  async function desactivar(): Promise<void> {
    setOcupado(true);
    setError(null);
    try {
      await desactivarPush();
      setEstado(await estadoPush());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("push.error"));
    } finally {
      setOcupado(false);
    }
  }

  const mensaje =
    estado === "no-soportado"
      ? t("push.noSoportado")
      : estado === "bloqueado"
        ? t("push.bloqueado")
        : estado === "servidor-sin-configurar"
          ? t("push.sinConfigurar")
          : estado === "activo"
            ? t("push.activo")
            : estado === "inactivo"
              ? t("push.inactivo")
              : t("app.loading");

  return (
    <div className="avisos-navegador">
      <span>{mensaje}</span>
      {estado === "inactivo" && (
        <button type="button" onClick={() => void activar()} disabled={ocupado}>
          {t("push.activar")}
        </button>
      )}
      {estado === "activo" && (
        <button type="button" onClick={() => void desactivar()} disabled={ocupado}>
          {t("push.desactivar")}
        </button>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
