import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useState } from "react";

import { peticion, type ProyectoApi, type TareaApi, type EstadoTarea } from "../api";

export default function ProyectoDetalle() {
  const { t } = useTranslation();
  const { id } = useParams();
  const proyectoId = id ?? "";
  const cliente = useQueryClient();

  const proyecto = useQuery({
    queryKey: ["proyecto", proyectoId],
    queryFn: () => peticion<ProyectoApi>(`/proyectos/${proyectoId}`),
    enabled: Boolean(proyectoId),
  });

  const tareas = useQuery({
    queryKey: ["tareas", proyectoId],
    queryFn: () => peticion<TareaApi[]>(`/proyectos/${proyectoId}/tareas`),
    enabled: Boolean(proyectoId),
  });

  const [titulo, setTitulo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const crearTarea = useMutation({
    mutationFn: async () =>
      peticion(`/proyectos/${proyectoId}/tareas`, {
        method: "POST",
        body: JSON.stringify({ titulo }),
      }),
    onSuccess: async () => {
      setTitulo("");
      await cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  const cambiarEstado = useMutation({
    mutationFn: async ({ tareaId, estado }: { tareaId: string; estado: EstadoTarea }) =>
      peticion(`/tareas/${tareaId}`, {
        method: "PATCH",
        body: JSON.stringify({ estado }),
      }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
    },
  });

  const borrarTarea = useMutation({
    mutationFn: async (tareaId: string) => peticion(`/tareas/${tareaId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
    },
  });

  if (proyecto.isLoading || tareas.isLoading) return <p>{t("app.loading")}</p>;
  if (proyecto.isError || tareas.isError) return <p className="error">{t("auth.error")}</p>;

  return (
    <main className="contenedor">
      <p>
        <Link to="/proyectos">{t("nav.projects")}</Link>
      </p>
      <h1>{proyecto.data?.nombre ?? t("projects.title")}</h1>
      <h2>{t("tasks.listTitle")}</h2>

      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          void crearTarea.mutate();
        }}
      >
        <label>
          {t("tasks.taskTitle")}
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={crearTarea.isPending}>
          {t("tasks.create")}
        </button>
      </form>

      {!tareas.data || tareas.data.length === 0 ? (
        <p>{t("tasks.empty")}</p>
      ) : (
        <ul>
          {tareas.data.map((tarea) => (
            <li key={tarea.id}>
              <span>{tarea.titulo}</span>
              <select
                value={tarea.estado}
                onChange={(e) =>
                  cambiarEstado.mutate({ tareaId: tarea.id, estado: e.target.value as EstadoTarea })
                }
                aria-label={t("tasks.status")}
              >
                <option value="pendiente">{t("tasks.states.pendiente")}</option>
                <option value="en_curso">{t("tasks.states.en_curso")}</option>
                <option value="hecha">{t("tasks.states.hecha")}</option>
              </select>
              <button type="button" onClick={() => void borrarTarea.mutate(tarea.id)}>
                {t("tasks.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
