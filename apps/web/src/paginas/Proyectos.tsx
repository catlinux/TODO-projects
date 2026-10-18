import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useState } from "react";

import { peticion, type ProyectoApi } from "../api";
import { colorProyecto } from "../colores";

export default function Proyectos() {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["proyectos"],
    queryFn: () => peticion<ProyectoApi[]>("/proyectos"),
  });

  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string | null>(null);

  const crear = useMutation({
    mutationFn: async () => {
      await peticion("/proyectos", {
        method: "POST",
        body: JSON.stringify({ nombre, descripcion: descripcion || undefined }),
      });
    },
    onSuccess: async () => {
      setNombre("");
      setDescripcion("");
      await cliente.invalidateQueries({ queryKey: ["proyectos"] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t("auth.error"));
    },
  });

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    void crear.mutate();
  }

  if (isLoading) return <p>{t("app.loading")}</p>;
  if (isError) return <p className="error">{t("auth.error")}</p>;

  return (
    <main className="contenedor contenedor--ancho">
      <h1>{t("projects.title")}</h1>

      <form className="formulario" onSubmit={enviar}>
        <label>
          {t("projects.name")}
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </label>
        <label>
          {t("projects.description")}
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="boton-principal" disabled={crear.isPending}>
          {t("projects.create")}
        </button>
      </form>

      {!data || data.length === 0 ? (
        <p>{t("projects.empty")}</p>
      ) : (
        <ul className="rejilla-proyectos">
          {data.map((proyecto, indice) => (
            <li key={proyecto.id} className="tarjeta-proyecto">
              <span
                className="tarjeta-proyecto__color"
                style={{ background: colorProyecto(indice) }}
                aria-hidden="true"
              />
              <div className="tarjeta-proyecto__cuerpo">
                <Link className="tarjeta-proyecto__enlace" to={`/proyectos/${proyecto.id}`}>
                  {proyecto.nombre}
                </Link>
                {proyecto.descripcion ? (
                  <p className="tarjeta-proyecto__descripcion">{proyecto.descripcion}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
