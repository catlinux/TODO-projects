import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";

import { peticion, type ColumnaApi, type ProyectoApi, type TareaApi } from "../api";
import { CamposTarea, type ValoresFormularioTarea } from "../componentes/CamposTarea";
import { Tablero } from "../componentes/Tablero";
import { aIsoUtc, construirRegla, recurrenciaPorDefecto } from "../recurrencia-web";

function valoresIniciales(): ValoresFormularioTarea {
  return {
    titulo: "",
    descripcion: "",
    venceEnLocal: "",
    recurrencia: recurrenciaPorDefecto(),
  };
}

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

  const columnas = useQuery({
    queryKey: ["columnas", proyectoId],
    queryFn: () => peticion<ColumnaApi[]>(`/proyectos/${proyectoId}/columnas`),
    enabled: Boolean(proyectoId),
  });

  const tareas = useQuery({
    queryKey: ["tareas", proyectoId],
    queryFn: () => peticion<TareaApi[]>(`/proyectos/${proyectoId}/tareas`),
    enabled: Boolean(proyectoId),
  });

  const [valores, setValores] = useState<ValoresFormularioTarea>(valoresIniciales);
  const [columnaSeleccionada, setColumnaSeleccionada] = useState("");
  const [nombreColumna, setNombreColumna] = useState("");
  const [columnaEditando, setColumnaEditando] = useState<{ id: string; nombre: string } | null>(
    null,
  );
  const [errorColumna, setErrorColumna] = useState<string | null>(null);

  useEffect(() => {
    if (!columnaSeleccionada && columnas.data && columnas.data.length > 0 && columnas.data[0]) {
      setColumnaSeleccionada(columnas.data[0].id);
    }
  }, [columnas.data, columnaSeleccionada]);

  const crearTarea = useMutation({
    mutationFn: async () => {
      const venceEn = aIsoUtc(valores.venceEnLocal);
      return peticion(`/proyectos/${proyectoId}/tareas`, {
        method: "POST",
        body: JSON.stringify({
          titulo: valores.titulo,
          descripcion: valores.descripcion,
          columnaId: columnaSeleccionada || undefined,
          venceEn,
          recurrencia: venceEn ? construirRegla(valores.recurrencia) : null,
        }),
      });
    },
    onSuccess: async () => {
      setValores(valoresIniciales());
      await cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
    },
  });

  const crearColumna = useMutation({
    mutationFn: async () =>
      peticion(`/proyectos/${proyectoId}/columnas`, {
        method: "POST",
        body: JSON.stringify({ nombre: nombreColumna }),
      }),
    onSuccess: async () => {
      setNombreColumna("");
      setErrorColumna(null);
      await cliente.invalidateQueries({ queryKey: ["columnas", proyectoId] });
      await cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
    },
    onError: (err: unknown) => {
      setErrorColumna(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  const renombrarColumna = useMutation({
    mutationFn: async ({ columnaId, nombre }: { columnaId: string; nombre: string }) =>
      peticion(`/columnas/${columnaId}`, {
        method: "PATCH",
        body: JSON.stringify({ nombre }),
      }),
    onSuccess: async () => {
      setColumnaEditando(null);
      await cliente.invalidateQueries({ queryKey: ["columnas", proyectoId] });
    },
  });

  const reordenarColumna = useMutation({
    mutationFn: async ({ columnaId, posicion }: { columnaId: string; posicion: number }) =>
      peticion(`/columnas/${columnaId}`, {
        method: "PATCH",
        body: JSON.stringify({ posicion }),
      }),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ["columnas", proyectoId] });
    },
  });

  const borrarColumna = useMutation({
    mutationFn: async (columnaId: string) =>
      peticion(`/columnas/${columnaId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setErrorColumna(null);
      await cliente.invalidateQueries({ queryKey: ["columnas", proyectoId] });
      await cliente.invalidateQueries({ queryKey: ["tareas", proyectoId] });
    },
    onError: (err: unknown) => {
      setErrorColumna(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  if (proyecto.isLoading || columnas.isLoading || tareas.isLoading) {
    return <p>{t("app.loading")}</p>;
  }
  if (proyecto.isError || columnas.isError || tareas.isError) {
    return <p className="error">{t("auth.error")}</p>;
  }

  const listaColumnas = (columnas.data ?? []).slice().sort((a, b) => a.posicion - b.posicion);
  const listaTareas = tareas.data ?? [];

  return (
    <main className="contenedor">
      <p>
        <Link to="/proyectos">{t("nav.projects")}</Link>
      </p>
      <h1>{proyecto.data?.nombre ?? t("projects.title")}</h1>

      <section className="gestion-columnas">
        <h2>{t("columns.title")}</h2>
        <form
          className="formulario"
          onSubmit={(e) => {
            e.preventDefault();
            setErrorColumna(null);
            void crearColumna.mutate();
          }}
        >
          <label>
            {t("columns.name")}
            <input
              value={nombreColumna}
              onChange={(e) => setNombreColumna(e.target.value)}
              required
            />
          </label>
          {errorColumna && <p className="error">{errorColumna}</p>}
          <button type="submit" disabled={crearColumna.isPending}>
            {t("columns.create")}
          </button>
        </form>

        <ul className="lista-columnas">
          {listaColumnas.map((columna, index) => (
            <li key={columna.id}>
              {columnaEditando?.id === columna.id ? (
                <>
                  <input
                    aria-label={t("columns.name")}
                    value={columnaEditando.nombre}
                    onChange={(e) => setColumnaEditando({ id: columna.id, nombre: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      renombrarColumna.mutate({
                        columnaId: columna.id,
                        nombre: columnaEditando.nombre,
                      })
                    }
                  >
                    {t("columns.save")}
                  </button>
                </>
              ) : (
                <span>{columna.nombre}</span>
              )}
              <button
                type="button"
                disabled={index === 0}
                onClick={() =>
                  reordenarColumna.mutate({ columnaId: columna.id, posicion: columna.posicion - 1 })
                }
              >
                {t("columns.moveLeft")}
              </button>
              <button
                type="button"
                disabled={index === listaColumnas.length - 1}
                onClick={() =>
                  reordenarColumna.mutate({ columnaId: columna.id, posicion: columna.posicion + 1 })
                }
              >
                {t("columns.moveRight")}
              </button>
              <button
                type="button"
                onClick={() => setColumnaEditando({ id: columna.id, nombre: columna.nombre })}
              >
                {t("columns.rename")}
              </button>
              <button type="button" onClick={() => borrarColumna.mutate(columna.id)}>
                {t("columns.delete")}
              </button>
            </li>
          ))}
        </ul>
        {listaColumnas.length === 0 && <p>{t("columns.empty")}</p>}
      </section>

      <section className="tareas">
        <h2>{t("tasks.listTitle")}</h2>
        <form
          className="formulario"
          onSubmit={(e) => {
            e.preventDefault();
            void crearTarea.mutate();
          }}
        >
          <CamposTarea valores={valores} onCambio={setValores} />
          <label>
            {t("columns.title")}
            <select
              value={columnaSeleccionada}
              onChange={(e) => setColumnaSeleccionada(e.target.value)}
            >
              {listaColumnas.map((columna) => (
                <option key={columna.id} value={columna.id}>
                  {columna.nombre}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={crearTarea.isPending}>
            {t("tasks.create")}
          </button>
        </form>

        <Tablero proyectoId={proyectoId} columnas={listaColumnas} tareas={listaTareas} />
      </section>
    </main>
  );
}
