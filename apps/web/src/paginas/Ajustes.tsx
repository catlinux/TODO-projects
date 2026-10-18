import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ErrorHttp,
  peticion,
  type ActividadApi,
  type PermisoTokenApi,
  type TokenApi,
  type TokenCreadoApi,
} from "../api";
import { useCerrarSesion } from "../cerrarSesion";
import { AvisosNavegador } from "../componentes/AvisosNavegador";
import { aIsoUtc, formatearFechaHoraEs } from "../recurrencia-web";
import { registrarHuella, soportaHuella } from "../huella";

const PERMISOS: PermisoTokenApi[] = ["lectura", "escritura", "calendario"];

interface HuellaDispositivoApi {
  id: string;
  nombre: string;
  createdAt: string;
  ultimoUso: string | null;
}

export default function Ajustes() {
  const { t } = useTranslation();
  const cliente = useQueryClient();

  const [nombre, setNombre] = useState("");
  const [permiso, setPermiso] = useState<PermisoTokenApi>("lectura");
  const [expiraEnLocal, setExpiraEnLocal] = useState("");
  const [creado, setCreado] = useState<TokenCreadoApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorActividad, setErrorActividad] = useState<string | null>(null);
  const [soporta, setSoporta] = useState(false);
  const [errorHuella, setErrorHuella] = useState<string | null>(null);
  const [reauthHuella, setReauthHuella] = useState(false);
  const [avisoSesiones, setAvisoSesiones] = useState<string | null>(null);
  const [errorSesiones, setErrorSesiones] = useState<string | null>(null);

  const tokens = useQuery({
    queryKey: ["tokens"],
    queryFn: () => peticion<TokenApi[]>("/tokens"),
  });

  const actividad = useQuery({
    queryKey: ["actividad"],
    queryFn: () => peticion<ActividadApi[]>("/actividad"),
  });

  const huellas = useQuery({
    queryKey: ["huellas"],
    queryFn: () => peticion<HuellaDispositivoApi[]>("/auth/huella"),
  });

  useEffect(() => {
    void soportaHuella().then(setSoporta);
  }, []);

  const crear = useMutation({
    mutationFn: async () => {
      const expiraEn = aIsoUtc(expiraEnLocal);
      return peticion<TokenCreadoApi>("/tokens", {
        method: "POST",
        body: JSON.stringify({
          nombre,
          permiso,
          ...(expiraEn ? { expiraEn } : {}),
        }),
      });
    },
    onSuccess: async (respuesta) => {
      setCreado(respuesta);
      setNombre("");
      setExpiraEnLocal("");
      setError(null);
      await cliente.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  const revocar = useMutation({
    mutationFn: async (id: string) => peticion(`/tokens/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  const deshacer = useMutation({
    mutationFn: async (id: string) => peticion(`/actividad/${id}/deshacer`, { method: "POST" }),
    onSuccess: async () => {
      setErrorActividad(null);
      await cliente.invalidateQueries({ queryKey: ["actividad"] });
    },
    onError: (err: unknown) => {
      setErrorActividad(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  const borrarHuella = useMutation({
    mutationFn: async (id: string) => peticion(`/auth/huella/${id}`, { method: "DELETE" }),
    onMutate: () => setErrorHuella(null),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["huellas"] });
    },
    onError: (err) => setErrorHuella(err instanceof Error ? err.message : t("auth.error")),
  });

  const activarHuella = useMutation({
    mutationFn: async () => registrarHuella(),
    onMutate: () => {
      setErrorHuella(null);
      setReauthHuella(false);
    },
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["huellas"] });
    },
    onError: (err) => {
      if (err instanceof ErrorHttp && err.codigo === "reautenticar") {
        setReauthHuella(true);
        return;
      }
      setErrorHuella(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  const cerrarSesion = useCerrarSesion();

  const cerrarSesiones = useMutation({
    mutationFn: async () =>
      peticion<{ cerradas: number }>("/auth/cerrar-sesiones", { method: "POST" }),
    onMutate: () => {
      setAvisoSesiones(null);
      setErrorSesiones(null);
    },
    onSuccess: (respuesta) => {
      setAvisoSesiones(
        respuesta.cerradas > 0
          ? t("settings.sessionsClosed", { n: respuesta.cerradas })
          : t("settings.noOtherSessions"),
      );
    },
    onError: (err) => {
      setErrorSesiones(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  const urlSuscripcion =
    creado && creado.permiso === "calendario"
      ? `${window.location.origin}/api/agenda.ics?token=${creado.token}`
      : null;

  return (
    <main className="contenedor contenedor--ajustes">
      <h1>{t("settings.title")}</h1>

      <section className="tarjeta-ajustes" aria-labelledby="ajustes-acceso">
        <div className="tarjeta-ajustes__cabecera">
          <h2 id="ajustes-acceso">{t("settings.access")}</h2>
          <p className="tarjeta-ajustes__descripcion">{t("settings.accessDescription")}</p>
        </div>

        <p>{t("settings.accessPinNote")}</p>
        {soporta && (
          <button
            type="button"
            className="boton-principal"
            disabled={activarHuella.isPending}
            onClick={() => activarHuella.mutate()}
          >
            {t("settings.activateFingerprint")}
          </button>
        )}
        {reauthHuella && (
          <p className="error">
            {t("settings.reauthRequired")}{" "}
            <button
              type="button"
              disabled={cerrarSesion.isPending}
              onClick={() => cerrarSesion.mutate()}
            >
              {t("settings.logoutAndReenter")}
            </button>
          </p>
        )}
        {huellas.isLoading && <p>{t("app.loading")}</p>}
        {huellas.isError && <p className="error">{t("auth.error")}</p>}
        {errorHuella && <p className="error">{errorHuella}</p>}
        {huellas.data && huellas.data.length === 0 && <p>{t("settings.accessEmpty")}</p>}
        {huellas.data && huellas.data.length > 0 && (
          <ul className="lista-ajustes">
            {huellas.data.map((dispositivo) => (
              <li key={dispositivo.id} className="fila-ajustes">
                <div className="fila-ajustes__principal">
                  <span className="fila-ajustes__nombre">{dispositivo.nombre}</span>
                  <span className="fila-ajustes__detalle">
                    <span className="mono">
                      {formatearFechaHoraEs(dispositivo.createdAt) || dispositivo.createdAt}
                    </span>{" "}
                    ·{" "}
                    <span>
                      {dispositivo.ultimoUso
                        ? formatearFechaHoraEs(dispositivo.ultimoUso)
                        : t("settings.never")}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  className="boton-fila"
                  disabled={borrarHuella.isPending}
                  onClick={() => {
                    if (!confirm(t("settings.deleteConfirm"))) return;
                    borrarHuella.mutate(dispositivo.id);
                  }}
                >
                  {t("settings.delete")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          disabled={cerrarSesiones.isPending}
          onClick={() => {
            if (!confirm(t("settings.closeOtherSessionsConfirm"))) return;
            cerrarSesiones.mutate();
          }}
        >
          {t("settings.closeOtherSessions")}
        </button>
        {avisoSesiones && <p>{avisoSesiones}</p>}
        {errorSesiones && <p className="error">{errorSesiones}</p>}
      </section>

      <section className="tarjeta-ajustes" aria-labelledby="ajustes-tokens">
        <div className="tarjeta-ajustes__cabecera">
          <h2 id="ajustes-tokens">{t("settings.tokens")}</h2>
          <p className="tarjeta-ajustes__descripcion">{t("settings.tokensDescription")}</p>
        </div>

        <form
          className="formulario"
          onSubmit={(evento) => {
            evento.preventDefault();
            void crear.mutate();
          }}
        >
          <label>
            {t("settings.name")}
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </label>
          <label>
            {t("settings.permission")}
            <select value={permiso} onChange={(e) => setPermiso(e.target.value as PermisoTokenApi)}>
              {PERMISOS.map((valor) => (
                <option key={valor} value={valor}>
                  {t(`settings.permissions.${valor}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("settings.expires")}
            <input
              type="datetime-local"
              value={expiraEnLocal}
              onChange={(e) => setExpiraEnLocal(e.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="boton-principal" disabled={crear.isPending}>
            {t("settings.create")}
          </button>
        </form>

        {creado && (
          <div className="token-creado">
            <p className="error">{t("settings.copyWarning")}</p>
            <code>{creado.token}</code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(creado.token);
              }}
            >
              {t("settings.copy")}
            </button>
            {urlSuscripcion && (
              <p>
                {t("settings.subscription")} <code>{urlSuscripcion}</code>
              </p>
            )}
          </div>
        )}

        {tokens.isLoading && <p>{t("app.loading")}</p>}
        {tokens.isError && <p className="error">{t("auth.error")}</p>}
        {tokens.data && tokens.data.length === 0 && <p>{t("settings.empty")}</p>}
        {tokens.data && tokens.data.length > 0 && (
          <div className="tabla-desplazable">
            <table className="tabla-tokens">
              <thead>
                <tr>
                  <th>{t("settings.name")}</th>
                  <th>{t("settings.permission")}</th>
                  <th>{t("settings.prefix")}</th>
                  <th>{t("settings.lastUse")}</th>
                  <th>{t("settings.expires")}</th>
                  <th>
                    <span className="visualmente-oculto">{t("settings.actionsColumn")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tokens.data.map((token) => (
                  <tr key={token.id} className={token.revocadoEn ? "token-revocado" : undefined}>
                    <td>
                      <strong>{token.nombre}</strong>
                    </td>
                    <td>{t(`settings.permissions.${token.permiso}`)}</td>
                    <td className="mono celda-secundaria">{token.prefijo}</td>
                    <td className="mono celda-secundaria">
                      {formatearFechaHoraEs(token.ultimoUso) || "—"}
                    </td>
                    <td className="mono celda-secundaria">
                      {formatearFechaHoraEs(token.expiraEn) || "—"}
                    </td>
                    <td className="celda-accion">
                      {!token.revocadoEn && (
                        <button
                          type="button"
                          className="boton-fila"
                          onClick={() => revocar.mutate(token.id)}
                        >
                          {t("settings.revoke")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tarjeta-ajustes" aria-labelledby="ajustes-actividad">
        <div className="tarjeta-ajustes__cabecera">
          <h2 id="ajustes-actividad">{t("settings.activity")}</h2>
          <p className="tarjeta-ajustes__descripcion">{t("settings.activityDescription")}</p>
        </div>

        {actividad.isLoading && <p>{t("app.loading")}</p>}
        {actividad.isError && <p className="error">{t("auth.error")}</p>}
        {actividad.data && actividad.data.length === 0 && <p>{t("settings.activityEmpty")}</p>}
        {errorActividad && <p className="error">{errorActividad}</p>}
        {actividad.data && actividad.data.length > 0 && (
          <ul className="lista-ajustes">
            {actividad.data.map((registro) => (
              <li
                key={registro.id}
                className={`fila-ajustes${registro.deshechoEn ? " token-revocado" : ""}`}
              >
                <div className="fila-ajustes__principal">
                  <span className="fila-ajustes__nombre">
                    {t(`settings.actions.${registro.accion}`)}: {registro.titulo ?? "—"}
                  </span>
                  <span className="fila-ajustes__detalle">
                    <span>{registro.tokenNombre ?? "—"}</span> ·{" "}
                    <span className="mono">{formatearFechaHoraEs(registro.createdAt)}</span>
                  </span>
                </div>
                <button
                  type="button"
                  className="boton-fila"
                  disabled={registro.deshechoEn !== null}
                  onClick={() => deshacer.mutate(registro.id)}
                >
                  {registro.deshechoEn ? t("settings.undone") : t("settings.undo")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tarjeta-ajustes" aria-labelledby="ajustes-avisos">
        <div className="tarjeta-ajustes__cabecera">
          <h2 id="ajustes-avisos">{t("settings.browserNotifications")}</h2>
        </div>
        <AvisosNavegador />
      </section>

      <section className="tarjeta-ajustes" aria-labelledby="ajustes-sesion">
        <div className="tarjeta-ajustes__cabecera">
          <h2 id="ajustes-sesion">{t("settings.session")}</h2>
          <p className="tarjeta-ajustes__descripcion">{t("settings.sessionDescription")}</p>
        </div>
        <button
          type="button"
          className="boton-principal"
          disabled={cerrarSesion.isPending}
          onClick={() => cerrarSesion.mutate()}
        >
          {t("nav.logout")}
        </button>
      </section>
    </main>
  );
}
