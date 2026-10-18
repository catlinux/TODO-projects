import { useEffect, useMemo, useRef, useState } from "react";

import type { FondoProyectoApi } from "../api";
import { urlArchivo } from "../portada";

/** Trazos de las curvas de nivel de la maqueta aprobada (Tablero3). */
const TRAZOS_CURVAS = [
  "M-50 620C120 560 210 640 360 600S620 470 780 520 1040 640 1260 560",
  "M-50 660C130 600 220 690 370 650S630 520 790 570 1050 690 1260 610",
  "M-50 700C140 640 230 740 380 700S640 570 800 620 1060 740 1260 660",
  "M-50 740C150 680 240 790 390 750S650 620 810 670 1070 790 1260 710",
  "M-50 140C100 200 260 90 420 150S700 260 860 190 1080 80 1260 150",
  "M-50 100C110 160 270 50 430 110S710 220 870 150 1090 40 1260 110",
  "M-50 60C120 120 280 10 440 70S720 180 880 110 1100 0 1260 70",
  "M560 400c0-60 70-96 140-90s120 52 110 104-70 84-140 78-110-32-110-92z",
  "M520 402c0-86 96-136 190-128s162 74 148 148-96 120-190 112-148-46-148-132z",
  "M480 404c0-112 122-176 240-166s204 96 186 192-122 156-240 146-186-60-186-172z",
];

/** Duración del fundido cruzado entre imágenes (ms). */
const DURACION_FUNDIDO_MS = 1200;

const CONSULTA_MOVIMIENTO_REDUCIDO = "(prefers-reduced-motion: reduce)";

/** Luminancia relativa del color (0 negro – 1 blanco), según la WCAG. */
function luminancia(hex: string): number {
  const limpio = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(limpio)) {
    return 1;
  }

  function canal(valor: number): number {
    const normalizado = valor / 255;
    return normalizado <= 0.03928
      ? normalizado / 12.92
      : ((normalizado + 0.055) / 1.055) ** 2.4;
  }

  const r = canal(parseInt(limpio.slice(0, 2), 16));
  const g = canal(parseInt(limpio.slice(2, 4), 16));
  const b = canal(parseInt(limpio.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function prefiereMovimientoReducido(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(CONSULTA_MOVIMIENTO_REDUCIDO).matches
  );
}

/** Sigue la preferencia del sistema sin animaciones. */
function useMovimientoReducido(): boolean {
  const [reducido, setReducido] = useState(prefiereMovimientoReducido);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const consulta = window.matchMedia(CONSULTA_MOVIMIENTO_REDUCIDO);
    const alCambiar = () => setReducido(consulta.matches);
    alCambiar();
    if (typeof consulta.addEventListener === "function") {
      consulta.addEventListener("change", alCambiar);
      return () => consulta.removeEventListener("change", alCambiar);
    }
    consulta.addListener?.(alCambiar);
    return () => consulta.removeListener?.(alCambiar);
  }, []);

  return reducido;
}

/**
 * Fondo «topográfico» del proyecto: degradado del ambiente (o color liso) con
 * las curvas de nivel. Con imágenes, una sola queda fija y varias rotan con un
 * fundido cruzado. El velo oscuro mantiene legible la cabecera.
 */
export function FondoProyecto({ fondo }: { fondo?: FondoProyectoApi | null }) {
  const colorLiso = fondo?.tipo === "color" ? fondo.color : null;
  const ambiente = fondo?.tipo === "ambiente" ? fondo.ambiente : "bosque";
  const intervaloSeg = fondo?.tipo === "imagenes" ? fondo.intervaloSeg : 30;

  // Solo los ids con forma de uuid construyen la URL del archivo.
  const imagenes = useMemo(() => {
    if (fondo?.tipo !== "imagenes") return [];
    return fondo.ids
      .map((id) => urlArchivo(id))
      .filter((url): url is string => url !== null);
  }, [fondo]);
  const claveImagenes = imagenes.join("|");

  const [indice, setIndice] = useState(0);
  const [anterior, setAnterior] = useState<number | null>(null);
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const indiceActual = useRef(0);
  const refTemporizadorFundido = useRef<number | null>(null);
  const reducido = useMovimientoReducido();

  // Con otro juego de imágenes se vuelve a empezar por la primera.
  useEffect(() => {
    indiceActual.current = 0;
    setIndice(0);
    setAnterior(null);
    if (refTemporizadorFundido.current !== null) {
      window.clearTimeout(refTemporizadorFundido.current);
      refTemporizadorFundido.current = null;
    }
  }, [claveImagenes]);

  useEffect(() => {
    const alCambiarVisibilidad = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    return () => document.removeEventListener("visibilitychange", alCambiarVisibilidad);
  }, []);

  useEffect(
    () => () => {
      if (refTemporizadorFundido.current !== null) {
        window.clearTimeout(refTemporizadorFundido.current);
      }
    },
    [],
  );

  // Con la pestaña oculta no hay temporizador: se reanuda al volver.
  useEffect(() => {
    if (imagenes.length < 2 || !visible) return;

    const intervalo = window.setInterval(() => {
      const actual = indiceActual.current;
      const siguiente = (actual + 1) % imagenes.length;
      indiceActual.current = siguiente;
      setIndice(siguiente);

      if (reducido) return;

      setAnterior(actual);
      if (refTemporizadorFundido.current !== null) {
        window.clearTimeout(refTemporizadorFundido.current);
      }
      refTemporizadorFundido.current = window.setTimeout(() => {
        setAnterior(null);
        refTemporizadorFundido.current = null;
      }, DURACION_FUNDIDO_MS);
    }, Math.max(1, intervaloSeg) * 1000);

    return () => window.clearInterval(intervalo);
  }, [imagenes.length, intervaloSeg, visible, reducido]);

  // Precarga la siguiente imagen mientras se ve la actual.
  useEffect(() => {
    if (imagenes.length < 2) return;
    const siguiente = imagenes[(indice + 1) % imagenes.length];
    if (!siguiente) return;
    const precarga = new Image();
    precarga.src = siguiente;
  }, [imagenes, indice]);

  const conImagenes = imagenes.length > 0;
  const clase = conImagenes
    ? "fondo-proyecto--imagenes"
    : colorLiso
      ? "fondo-proyecto--liso"
      : `fondo-proyecto--${ambiente}`;
  const conVelo = conImagenes || (colorLiso !== null && luminancia(colorLiso) > 0.179);
  const indiceVisible = conImagenes ? indice % imagenes.length : 0;
  const indiceAnterior =
    conImagenes && anterior !== null && imagenes.length > 0
      ? anterior % imagenes.length
      : null;
  const imagenVisible = imagenes[indiceVisible];
  const imagenAnterior = indiceAnterior !== null ? imagenes[indiceAnterior] : undefined;

  return (
    <div
      className={`fondo-proyecto ${clase}`}
      style={colorLiso ? { backgroundColor: colorLiso } : undefined}
    >
      {conImagenes && (
        <>
          {imagenVisible && (
            <div
              className="fondo-proyecto__capa"
              aria-hidden="true"
              style={{ backgroundImage: `url(${imagenVisible})` }}
            />
          )}
          {!reducido && imagenAnterior && (
            <div
              key={`anterior-${indice}`}
              className="fondo-proyecto__capa fondo-proyecto__capa--anterior"
              aria-hidden="true"
              style={{ backgroundImage: `url(${imagenAnterior})` }}
            />
          )}
        </>
      )}
      <svg
        className="fondo-proyecto__curvas"
        aria-hidden="true"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        stroke="#fff"
        strokeWidth={1.2}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.16 }}
      >
        {TRAZOS_CURVAS.map((trazo) => (
          <path key={trazo} d={trazo} />
        ))}
      </svg>
      {conVelo && <div className="fondo-proyecto__velo" />}
    </div>
  );
}
