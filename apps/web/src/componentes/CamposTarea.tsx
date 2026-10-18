import { useTranslation } from "react-i18next";

import { DIAS_SEMANA, type DatosRecurrencia, type FrecuenciaRecurrencia } from "../recurrencia-web";

export interface ValoresFormularioTarea {
  titulo: string;
  descripcion: string;
  venceEnLocal: string;
  recurrencia: DatosRecurrencia;
  recordatorioMin: number | null;
}

interface Propiedades {
  valores: ValoresFormularioTarea;
  onCambio: (valores: ValoresFormularioTarea) => void;
  /** Campos que no se pintan: la tarjeta abierta usa título y descripción propios. */
  ocultar?: ReadonlyArray<"titulo" | "descripcion">;
}

const FRECUENCIAS: FrecuenciaRecurrencia[] = ["ninguna", "diaria", "semanal", "mensual", "anual"];

export const OPCIONES_RECORDATORIO: Array<{ valor: number; clave: string }> = [
  { valor: 0, clave: "0" },
  { valor: 5, clave: "5" },
  { valor: 15, clave: "15" },
  { valor: 30, clave: "30" },
  { valor: 60, clave: "60" },
  { valor: 1440, clave: "1440" },
  { valor: 10080, clave: "10080" },
];

export function CamposTarea({ valores, onCambio, ocultar }: Propiedades) {
  const { t } = useTranslation();
  const { recurrencia } = valores;

  function cambiarRecurrencia(cambios: Partial<DatosRecurrencia>) {
    onCambio({ ...valores, recurrencia: { ...recurrencia, ...cambios } });
  }

  function alternarDia(dia: string, activo: boolean) {
    const dias = activo
      ? [...recurrencia.dias, dia]
      : recurrencia.dias.filter((actual) => actual !== dia);
    cambiarRecurrencia({ dias });
  }

  return (
    <>
      {!ocultar?.includes("titulo") && (
        <label>
          {t("tasks.taskTitle")}
          <input
            value={valores.titulo}
            onChange={(evento) => onCambio({ ...valores, titulo: evento.target.value })}
            required
          />
        </label>
      )}
      {!ocultar?.includes("descripcion") && (
        <label>
          {t("tasks.description")}
          <input
            value={valores.descripcion}
            onChange={(evento) => onCambio({ ...valores, descripcion: evento.target.value })}
          />
        </label>
      )}
      <label>
        {t("tasks.dueDate")}
        <input
          type="datetime-local"
          value={valores.venceEnLocal}
          onChange={(evento) => onCambio({ ...valores, venceEnLocal: evento.target.value })}
        />
      </label>

      <label>
        {t("tasks.reminder")}
        <select
          value={valores.recordatorioMin === null ? "none" : String(valores.recordatorioMin)}
          disabled={!valores.venceEnLocal}
          onChange={(evento) =>
            onCambio({
              ...valores,
              recordatorioMin: evento.target.value === "none" ? null : Number(evento.target.value),
            })
          }
        >
          <option value="none">{t("tasks.reminderOptions.none")}</option>
          {OPCIONES_RECORDATORIO.map((opcion) => (
            <option key={opcion.clave} value={opcion.clave}>
              {t(`tasks.reminderOptions.${opcion.clave}`)}
            </option>
          ))}
        </select>
      </label>

      <fieldset disabled={!valores.venceEnLocal} className="recurrencia">
        <legend>{t("tasks.recurrence")}</legend>
        <label>
          {t("tasks.frequency")}
          <select
            value={recurrencia.frecuencia}
            onChange={(evento) =>
              cambiarRecurrencia({ frecuencia: evento.target.value as FrecuenciaRecurrencia })
            }
          >
            {FRECUENCIAS.map((frecuencia) => (
              <option key={frecuencia} value={frecuencia}>
                {t(`tasks.frequencyOptions.${frecuencia}`)}
              </option>
            ))}
          </select>
        </label>

        {recurrencia.frecuencia !== "ninguna" && (
          <>
            <label>
              {t("tasks.every")}
              <input
                type="number"
                min={1}
                max={99}
                value={recurrencia.intervalo}
                onChange={(evento) =>
                  cambiarRecurrencia({ intervalo: Number(evento.target.value) || 1 })
                }
              />
            </label>

            {recurrencia.frecuencia === "semanal" && (
              <fieldset className="dias-semana">
                <legend>{t("tasks.weekdays")}</legend>
                {DIAS_SEMANA.map((dia) => (
                  <label key={dia} className="dia-semana">
                    <input
                      type="checkbox"
                      checked={recurrencia.dias.includes(dia)}
                      onChange={(evento) => alternarDia(dia, evento.target.checked)}
                    />
                    {t(`tasks.weekdaysShort.${dia}`)}
                  </label>
                ))}
              </fieldset>
            )}

            <label>
              {t("tasks.ends")}
              <select
                value={recurrencia.fin.tipo}
                onChange={(evento) => {
                  const tipo = evento.target.value as "nunca" | "veces";
                  cambiarRecurrencia({
                    fin: tipo === "veces" ? { tipo, veces: recurrencia.fin.veces ?? 10 } : { tipo },
                  });
                }}
              >
                <option value="nunca">{t("tasks.endsNever")}</option>
                <option value="veces">{t("tasks.endsAfter")}</option>
              </select>
            </label>

            {recurrencia.fin.tipo === "veces" && (
              <label>
                {t("tasks.times")}
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={recurrencia.fin.veces ?? 10}
                  onChange={(evento) =>
                    cambiarRecurrencia({
                      fin: { tipo: "veces", veces: Number(evento.target.value) || 1 },
                    })
                  }
                />
              </label>
            )}
          </>
        )}
      </fieldset>
    </>
  );
}
