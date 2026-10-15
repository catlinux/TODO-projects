import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  peticion,
  type ActividadApi,
  type PermisoTokenApi,
  type TokenApi,
  type TokenCreadoApi,
} from "../api";
import { aIsoUtc, formatearFechaHoraEs } from "../recurrencia-web";

const PERMISOS: PermisoTokenApi[] = ["lectura", "escritura", "calendario"];

export default function Ajustes() {
  const { t } = useTranslation();
  const cliente = useQueryClient();

  const [nombre, setNombre] = useState("");
  const [permiso, setPermiso] = useState<PermisoTokenApi>("lectura");
  const [expiraEnLocal, setExpiraEnLocal] = useState("");
  const [creado, setCreado] = useState<TokenCreadoApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorActividad, setErrorActividad] = useState<string | null>(null);

  const tokens = useQuery({
    queryKey: ["tokens"],
    queryFn: () => peticion<TokenApi[]>("/tokens"),
  });

  const actividad = useQuery({
    queryKey: ["actividad"],
    queryFn: () => peticion<ActividadApi[]>("/actividad"),
  });

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

  const urlSuscripcion =
    creado && creado.permiso === "calendario"
      ? `${window.location.origin}/api/agenda.ics?token=${creado.token}`
      : null;

  return (
    <main className="contenedor">
      <h1>{t("settings.title")}</h1>

      <section>
        <h2>{t("settings.tokens")}</h2>
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
          <button type="submit" disabled={crear.isPending}>
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
          <table>
            <thead>
              <tr>
                <th>{t("settings.name")}</th>
                <th>{t("settings.permission")}</th>
                <th>{t("settings.prefix")}</th>
                <th>{t("settings.lastUse")}</th>
                <th>{t("settings.expires")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.data.map((token) => (
                <tr key={token.id} className={token.revocadoEn ? "token-revocado" : undefined}>
                  <td>{token.nombre}</td>
                  <td>{t(`settings.permissions.${token.permiso}`)}</td>
                  <td>{token.prefijo}</td>
                  <td>{formatearFechaHoraEs(token.ultimoUso) || "—"}</td>
                  <td>{formatearFechaHoraEs(token.expiraEn) || "—"}</td>
                  <td>
                    {!token.revocadoEn && (
                      <button type="button" onClick={() => revocar.mutate(token.id)}>
                        {t("settings.revoke")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>{t("settings.activity")}</h2>
        {actividad.isLoading && <p>{t("app.loading")}</p>}
        {actividad.isError && <p className="error">{t("auth.error")}</p>}
        {actividad.data && actividad.data.length === 0 && <p>{t("settings.activityEmpty")}</p>}
        {errorActividad && <p className="error">{errorActividad}</p>}
        {actividad.data && actividad.data.length > 0 && (
          <ul className="actividad">
            {actividad.data.map((registro) => (
              <li key={registro.id} className={registro.deshechoEn ? "token-revocado" : undefined}>
                <span>
                  {t(`settings.actions.${registro.accion}`)}: {registro.titulo ?? "—"}
                </span>{" "}
                <span>{registro.tokenNombre ?? "—"}</span>{" "}
                <span>{formatearFechaHoraEs(registro.createdAt)}</span>{" "}
                <button
                  type="button"
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
    </main>
  );
}
