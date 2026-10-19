import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  peticion,
  type ConfigAsistenteApi,
  type PresetAsistenteApi,
  type RazonamientoAsistenteApi,
} from "../api";

/** Mismos presets y defectos que `PRESETS_ASISTENTE_DEFECTOS` de @todo/shared. */
const PRESETS: readonly PresetAsistenteApi[] = [
  "deepseek",
  "openai",
  "opencode-go",
  "personalizado",
];

interface DefectosPreset {
  baseUrl: string;
  modelo: string;
  razonamiento: RazonamientoAsistenteApi | null;
}

const PRESET_DEFECTOS: Record<PresetAsistenteApi, DefectosPreset | null> = {
  deepseek: { baseUrl: "https://api.deepseek.com", modelo: "deepseek-flash", razonamiento: null },
  openai: { baseUrl: "https://api.openai.com/v1", modelo: "gpt-6-luna", razonamiento: "none" },
  "opencode-go": {
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    modelo: "deepseek-v4.1-flash",
    razonamiento: null,
  },
  personalizado: null,
};

const RAZONAMIENTOS: readonly RazonamientoAsistenteApi[] = ["none", "low", "medium", "high"];

const SIN_CONFIGURAR: ConfigAsistenteApi = {
  disponible: true,
  configurado: false,
  preset: null,
  baseUrl: null,
  modelo: null,
  razonamiento: null,
  claveTermina: null,
};

/** Tarjeta de Ajustes para configurar el proveedor de IA del asistente. */
export function AjustesAsistente() {
  const { t } = useTranslation();
  const cliente = useQueryClient();

  const config = useQuery({
    queryKey: ["asistente-config"],
    queryFn: () => peticion<ConfigAsistenteApi>("/asistente/config"),
  });

  const [preset, setPreset] = useState<PresetAsistenteApi>("deepseek");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelo, setModelo] = useState("");
  const [razonamiento, setRazonamiento] = useState("");
  const [clave, setClave] = useState("");
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  // Solo al llegar la configuración guardada: luego mandan los campos del usuario.
  const iniciado = useRef(false);
  useEffect(() => {
    const datos = config.data;
    if (!datos || !datos.configurado || iniciado.current) return;
    iniciado.current = true;
    setPreset(datos.preset ?? "personalizado");
    setBaseUrl(datos.baseUrl ?? "");
    setModelo(datos.modelo ?? "");
    setRazonamiento(datos.razonamiento ?? "");
  }, [config.data]);

  function mensajeError(err: unknown): string {
    return err instanceof Error ? err.message : t("auth.error");
  }

  /** Cuerpo común de guardar y probar: solo se envía la clave si se ha escrito. */
  function cuerpoConfig(): Record<string, unknown> {
    const cuerpo: Record<string, unknown> = { preset };
    if (baseUrl.trim()) cuerpo.baseUrl = baseUrl.trim();
    if (modelo.trim()) cuerpo.modelo = modelo.trim();
    cuerpo.razonamiento = razonamiento === "" ? null : razonamiento;
    if (clave.trim()) cuerpo.clave = clave.trim();
    return cuerpo;
  }

  function elegirPreset(nuevo: PresetAsistenteApi) {
    setPreset(nuevo);
    const defectos = PRESET_DEFECTOS[nuevo];
    setBaseUrl(defectos?.baseUrl ?? "");
    setModelo(defectos?.modelo ?? "");
    setRazonamiento(defectos?.razonamiento ?? "");
  }

  const guardar = useMutation({
    mutationFn: () =>
      peticion<ConfigAsistenteApi>("/asistente/config", {
        method: "PUT",
        body: JSON.stringify(cuerpoConfig()),
      }),
    onSuccess: (respuesta) => {
      setClave("");
      setAviso({ tipo: "ok", texto: t("asistente.config.saved") });
      iniciado.current = true;
      cliente.setQueryData(["asistente-config"], respuesta);
    },
    onError: (err) => setAviso({ tipo: "error", texto: mensajeError(err) }),
  });

  const probar = useMutation({
    mutationFn: () =>
      peticion<{ ok: boolean; mensaje?: string }>("/asistente/probar", {
        method: "POST",
        body: JSON.stringify(cuerpoConfig()),
      }),
    onSuccess: (respuesta) =>
      setAviso(
        respuesta.ok
          ? { tipo: "ok", texto: t("asistente.config.testOk") }
          : { tipo: "error", texto: respuesta.mensaje ?? t("asistente.config.testError") },
      ),
    onError: (err) => setAviso({ tipo: "error", texto: mensajeError(err) }),
  });

  const quitar = useMutation({
    mutationFn: () => peticion<void>("/asistente/config", { method: "DELETE" }),
    onSuccess: () => {
      iniciado.current = false;
      setPreset("deepseek");
      setBaseUrl(PRESET_DEFECTOS.deepseek?.baseUrl ?? "");
      setModelo(PRESET_DEFECTOS.deepseek?.modelo ?? "");
      setRazonamiento("");
      setClave("");
      setAviso({ tipo: "ok", texto: t("asistente.config.removed") });
      cliente.setQueryData(["asistente-config"], SIN_CONFIGURAR);
    },
    onError: (err) => setAviso({ tipo: "error", texto: mensajeError(err) }),
  });

  const colaClave = config.data?.claveTermina ?? null;

  return (
    <section className="panel-tarjeta" aria-labelledby="ajustes-asistente">
      <div className="panel-tarjeta__cabecera">
        <h2 className="panel-tarjeta__titulo" id="ajustes-asistente">
          {t("asistente.title")}
        </h2>
        <p className="panel-tarjeta__descripcion">{t("asistente.settingsDescription")}</p>
      </div>

      {config.isLoading && <p>{t("app.loading")}</p>}
      {config.isError && <p className="error">{t("auth.error")}</p>}

      {config.data && !config.data.disponible && <p>{t("asistente.noDisponible")}</p>}

      {config.data && config.data.disponible && (
        <>
          <p className="asistente-ajustes__privacidad">{t("asistente.privacy")}</p>
          <form
            className="formulario"
            onSubmit={(evento) => {
              evento.preventDefault();
              guardar.mutate();
            }}
          >
            <label>
              {t("asistente.config.proveedor")}
              <select
                value={preset}
                onChange={(evento) => elegirPreset(evento.target.value as PresetAsistenteApi)}
              >
                {PRESETS.map((valor) => (
                  <option key={valor} value={valor}>
                    {t(`asistente.presets.${valor}`)}
                  </option>
                ))}
              </select>
            </label>
            {preset === "opencode-go" && (
              <p className="asistente-ajustes__ayuda">{t("asistente.config.ayudaOpenCodeGo")}</p>
            )}
            <label>
              {t("asistente.config.baseUrl")}
              <input
                type="url"
                value={baseUrl}
                placeholder="https://api.ejemplo.com/v1"
                onChange={(evento) => setBaseUrl(evento.target.value)}
                required
              />
            </label>
            <label>
              {t("asistente.config.modelo")}
              <input
                value={modelo}
                onChange={(evento) => setModelo(evento.target.value)}
                required
              />
            </label>
            <label>
              {t("asistente.config.razonamiento")}
              <select
                value={razonamiento}
                onChange={(evento) => setRazonamiento(evento.target.value)}
              >
                <option value="">{t("asistente.config.razonamientoAuto")}</option>
                {RAZONAMIENTOS.map((valor) => (
                  <option key={valor} value={valor}>
                    {t(`asistente.razonamientos.${valor}`)}
                  </option>
                ))}
              </select>
            </label>

            {colaClave && (
              <p className="asistente-ajustes__clave">
                {t("asistente.config.claveGuardada", { cola: colaClave })}
              </p>
            )}
            <label>
              {config.data.configurado
                ? t("asistente.config.claveReemplazar")
                : t("asistente.config.clave")}
              <input
                type="password"
                value={clave}
                autoComplete="off"
                onChange={(evento) => setClave(evento.target.value)}
                placeholder={config.data.configurado ? t("asistente.config.claveDejar") : ""}
              />
            </label>

            <div className="acciones">
              <button type="submit" className="boton-principal" disabled={guardar.isPending}>
                {t("asistente.config.save")}
              </button>
              <button type="button" disabled={probar.isPending} onClick={() => probar.mutate()}>
                {t("asistente.config.test")}
              </button>
              {config.data.configurado && (
                <button
                  type="button"
                  className="boton-peligro"
                  disabled={quitar.isPending}
                  onClick={() => {
                    if (!confirm(t("asistente.config.removeConfirm"))) return;
                    quitar.mutate();
                  }}
                >
                  {t("asistente.config.remove")}
                </button>
              )}
            </div>
          </form>

          {aviso && (
            <p
              className={aviso.tipo === "error" ? "error" : "asistente-ajustes__ok"}
              role="status"
            >
              {aviso.texto}
            </p>
          )}
        </>
      )}
    </section>
  );
}
