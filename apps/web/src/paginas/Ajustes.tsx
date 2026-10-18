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
import { AjustesAsistente } from "../componentes/AjustesAsistente";
import { AvisosNavegador } from "../componentes/AvisosNavegador";
import { VersionApp } from "../componentes/VersionApp";
import { ESTILOS, useEstilo, type Estilo } from "../estilo";
import { aIsoUtc, formatearFechaHoraEs } from "../recurrencia-web";
import { registrarHuella, soportaHuella } from "../huella";
import { useTema, type Tema } from "../tema";

const PERMISOS: PermisoTokenApi[] = ["lectura", "escritura", "calendario"];

const MODOS: readonly Tema[] = ["claro", "oscuro", "sistema"];

// Colores fijos de las miniaturas: representan cada tema y no dependen del activo.
const MAQUETAS_ESTILO: Record<Estilo, { menu: string; panel: string; barra: string }> = {
  sobrio: { menu: "#17191e", panel: "#f7f8fa", barra: "#d3d7de" },
  sereno: { menu: "#f3f2f0", panel: "#fdfdfc", barra: "#dcd9d4" },
};

interface HuellaDispositivoApi {
  id: string;
  nombre: string;
  createdAt: string;
  ultimoUso: string | null;
}

export default function Ajustes() {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const { estilo, cambiarEstilo } = useEstilo();
  const { tema, cambiarTema } = useTema();

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
    <main className="pagina pagina--estrecha">
      <header className="pagina__cabecera">
        <h1 className="pagina__titulo">{t("settings.title")}</h1>
      </header>

      <section className="panel-tarjeta" aria-labelledby="ajustes-apariencia">
        <div className="panel-tarjeta__cabecera">
          <h2 className="panel-tarjeta__titulo" id="ajustes-apariencia">
            {t("settings.appearance")}
          </h2>
          <p className="panel-tarjeta__descripcion">{t("settings.appearanceDescription")}</p>
        </div>

        <h3 className="apariencia__grupo" id="apariencia-estilo">
          {t("settings.style")}
        </h3>
        <div className="apariencia__rejilla" role="radiogroup" aria-label={t("settings.style")}>
          {ESTILOS.map((opcion) => {
            const seleccionado = estilo === opcion;
            const maqueta = MAQUETAS_ESTILO[opcion];
            return (
              <button
                key={opcion}
                type="button"
                role="radio"
                aria-checked={seleccionado}
                aria-labelledby={`apariencia-estilo-${opcion}`}
                aria-describedby={`apariencia-estilo-${opcion}-desc`}
                className={`apariencia__tarjeta${seleccionado ? " apariencia__tarjeta--activa" : ""}`}
                onClick={() => cambiarEstilo(opcion)}
              >
                <span className="apariencia__maqueta" aria-hidden="true">
                  <span
                    className="apariencia__maqueta-menu"
                    style={{ backgroundColor: maqueta.menu }}
                  />
                  <span
                    className="apariencia__maqueta-panel"
                    style={{ backgroundColor: maqueta.panel }}
                  >
                    <span
                      className="apariencia__maqueta-barra"
                      style={{ backgroundColor: maqueta.barra }}
                    />
                    <span
                      className="apariencia__maqueta-barra"
                      style={{ backgroundColor: maqueta.barra }}
                    />
                  </span>
                </span>
                <span className="apariencia__texto">
                  <span className="apariencia__nombre" id={`apariencia-estilo-${opcion}`}>
                    {t(`settings.styles.${opcion}.nombre`)}
                  </span>
                  <span className="apariencia__detalle" id={`apariencia-estilo-${opcion}-desc`}>
                    {t(`settings.styles.${opcion}.descripcion`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <h3 className="apariencia__grupo" id="apariencia-modo">
          {t("settings.mode")}
        </h3>
        <div className="apariencia__modos" role="radiogroup" aria-label={t("settings.mode")}>
          {MODOS.map((opcion) => (
            <button
              key={opcion}
              type="button"
              role="radio"
              aria-checked={tema === opcion}
              className={`apariencia__modo${tema === opcion ? " apariencia__modo--activo" : ""}`}
              onClick={() => cambiarTema(opcion)}
            >
              {t(`nav.themeOptions.${opcion}`)}
            </button>
          ))}
        </div>
      </section>

      <AjustesAsistente />

      <section className="panel-tarjeta" aria-labelledby="ajustes-acceso">
        <div className="panel-tarjeta__cabecera">
          <h2 className="panel-tarjeta__titulo" id="ajustes-acceso">
            {t("settings.access")}
          </h2>
          <p className="panel-tarjeta__descripcion">{t("settings.accessDescription")}</p>
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
                    <span className="cifra">
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

      <section className="panel-tarjeta" aria-labelledby="ajustes-tokens">
        <div className="panel-tarjeta__cabecera">
          <h2 className="panel-tarjeta__titulo" id="ajustes-tokens">
            {t("settings.tokens")}
          </h2>
          <p className="panel-tarjeta__descripcion">{t("settings.tokensDescription")}</p>
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
                    <td className="cifra celda-secundaria">{token.prefijo}</td>
                    <td className="cifra celda-secundaria">
                      {formatearFechaHoraEs(token.ultimoUso) || "—"}
                    </td>
                    <td className="cifra celda-secundaria">
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

      <section className="panel-tarjeta" aria-labelledby="ajustes-actividad">
        <div className="panel-tarjeta__cabecera">
          <h2 className="panel-tarjeta__titulo" id="ajustes-actividad">
            {t("settings.activity")}
          </h2>
          <p className="panel-tarjeta__descripcion">{t("settings.activityDescription")}</p>
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
                    <span className="cifra">{formatearFechaHoraEs(registro.createdAt)}</span>
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

      <section className="panel-tarjeta" aria-labelledby="ajustes-avisos">
        <div className="panel-tarjeta__cabecera">
          <h2 className="panel-tarjeta__titulo" id="ajustes-avisos">
            {t("settings.browserNotifications")}
          </h2>
        </div>
        <AvisosNavegador />
      </section>

      <VersionApp />

      <section className="panel-tarjeta" aria-labelledby="ajustes-sesion">
        <div className="panel-tarjeta__cabecera">
          <h2 className="panel-tarjeta__titulo" id="ajustes-sesion">
            {t("settings.session")}
          </h2>
          <p className="panel-tarjeta__descripcion">{t("settings.sessionDescription")}</p>
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
