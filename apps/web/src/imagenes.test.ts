import { afterEach, describe, expect, it, vi } from "vitest";

import { reducirImagen } from "./imagenes";

function imagen(nombre: string, tipo: string): File {
  return new File(["x"], nombre, { type: tipo });
}

function simularBitmap(ancho: number, alto: number) {
  const close = vi.fn();
  const mapa = { width: ancho, height: alto, close };
  vi.stubGlobal("createImageBitmap", vi.fn(async () => mapa));
  return { mapa, close };
}

function simularLienzo(salida: string = "image/webp") {
  const dibujar = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: dibujar,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(`data:${salida};base64,abc`);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback) => {
    callback(new Blob(["reducida"], { type: salida }));
  });
  return { dibujar };
}

describe("reducirImagen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reduce las imágenes grandes conservando la proporción y pasa a webp", async () => {
    const { mapa, close } = simularBitmap(4000, 2000);
    const { dibujar } = simularLienzo();
    const original = imagen("foto.png", "image/png");

    const resultado = await reducirImagen(original, { ladoMax: 2560, calidad: 0.85 });

    expect(resultado).not.toBe(original);
    expect(resultado.name).toBe("foto.webp");
    expect(resultado.type).toBe("image/webp");
    expect(dibujar).toHaveBeenCalledWith(mapa, 0, 0, 2560, 1280);
    expect(close).toHaveBeenCalled();
  });

  it("usa jpeg si el navegador no soporta webp", async () => {
    simularBitmap(3000, 3000);
    simularLienzo("image/png");

    const resultado = await reducirImagen(imagen("foto.png", "image/png"));

    expect(resultado.name).toBe("foto.jpg");
    expect(resultado.type).toBe("image/jpeg");
  });

  it("deja intactos los gif", async () => {
    const crear = vi.fn();
    vi.stubGlobal("createImageBitmap", crear);
    const original = imagen("anim.gif", "image/gif");

    expect(await reducirImagen(original)).toBe(original);
    expect(crear).not.toHaveBeenCalled();
  });

  it("deja intactas las imágenes que ya caben", async () => {
    simularBitmap(1200, 800);
    const contexto = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    const original = imagen("pequena.jpg", "image/jpeg");

    expect(await reducirImagen(original)).toBe(original);
    expect(contexto).not.toHaveBeenCalled();
  });

  it("recodifica las fotos que caben en píxeles pero pesan demasiado", async () => {
    const { dibujar } = (simularBitmap(1600, 900), simularLienzo());
    const original = new File([new Uint8Array(2_000_000)], "foto.jpg", { type: "image/jpeg" });

    const resultado = await reducirImagen(original);

    expect(resultado).not.toBe(original);
    expect(resultado.name).toBe("foto.webp");
    expect(dibujar).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 900);
  });

  it("no sustituye una imagen pesada si la recodificada no pesa menos", async () => {
    simularBitmap(1600, 900);
    simularLienzo();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback) => {
      callback(new Blob([new Uint8Array(3_000_000)], { type: "image/webp" }));
    });
    const original = new File([new Uint8Array(2_000_000)], "foto.jpg", { type: "image/jpeg" });

    expect(await reducirImagen(original)).toBe(original);
  });

  it("reduce a 1920 px por defecto", async () => {
    const { mapa } = simularBitmap(6000, 4000);
    const { dibujar } = simularLienzo();

    await reducirImagen(imagen("camara.jpg", "image/jpeg"));

    expect(dibujar).toHaveBeenCalledWith(mapa, 0, 0, 1920, 1280);
  });

  it("cae al original si no se puede procesar", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("sin soporte");
      }),
    );
    const original = imagen("foto.png", "image/png");

    expect(await reducirImagen(original)).toBe(original);
  });

  it("cae al original si el lienzo no está disponible", async () => {
    simularBitmap(4000, 2000);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const original = imagen("foto.png", "image/png");

    expect(await reducirImagen(original)).toBe(original);
  });
});
