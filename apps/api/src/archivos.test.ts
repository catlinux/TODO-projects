import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { type FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import type { Database } from "./db/index.js";
import * as schema from "./db/schema.js";
import { sanearNombreArchivo } from "./almacen-archivos.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const MAX_BYTES = 2000;
const BOUNDARY = "----todopruebaarchivos";

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FIRMA_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const FIRMA_GIF = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.from([0x01, 0x00])]);
const FIRMA_WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "latin1"),
]);

function bytesPng(extra = 0): Buffer {
  return Buffer.concat([FIRMA_PNG, Buffer.alloc(extra, 0x20)]);
}

interface ParteMultipart {
  nombre: string;
  fichero?: string;
  tipo?: string;
  contenido: Buffer | string;
}

function cuerpoMultipart(partes: ParteMultipart[]): { payload: Buffer; contentType: string } {
  const trozos: Buffer[] = [];
  for (const parte of partes) {
    if (parte.fichero !== undefined) {
      trozos.push(
        Buffer.from(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${parte.nombre}"; filename="${parte.fichero}"\r\nContent-Type: ${parte.tipo ?? "application/octet-stream"}\r\n\r\n`,
          "utf8",
        ),
      );
    } else {
      trozos.push(
        Buffer.from(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${parte.nombre}"\r\n\r\n`,
          "utf8",
        ),
      );
    }
    trozos.push(
      typeof parte.contenido === "string" ? Buffer.from(parte.contenido) : parte.contenido,
    );
    trozos.push(Buffer.from("\r\n"));
  }
  trozos.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(trozos),
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

function obtenerCookieSesion(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

describe("API de archivos", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: FastifyInstance;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "todo-archivos-"));
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    app = await buildApp(db as unknown as Database, {
      limiteAuth: { max: 100000, ventanaMs: 60 * 60 * 1000, maxPorCorreo: 100000 },
      archivos: { dir, maxBytes: MAX_BYTES },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
    await rm(dir, { recursive: true, force: true });
  });

  const auth = (cookie: string) => ({ cookie: `sesion=${cookie}` });

  async function registrar(sufijo: string): Promise<{ cookie: string; usuarioId: string }> {
    const email = `archivos-${sufijo}@example.com`;
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: { email, nombre: `Usuario ${sufijo}`, contrasena: "contrasena-muy-larga" },
    });
    const [usuario] = await db
      .select({ id: schema.usuarios.id })
      .from(schema.usuarios)
      .where(eq(schema.usuarios.email, email))
      .limit(1);
    return { cookie: obtenerCookieSesion(respuesta), usuarioId: usuario!.id };
  }

  async function crearProyecto(cookie: string, nombre: string): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: auth(cookie),
      payload: { nombre },
    });
    expect(respuesta.statusCode).toBe(201);
    return (respuesta.json() as { id: string }).id;
  }

  async function crearToken(cookie: string): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: "/tokens",
      headers: auth(cookie),
      payload: { nombre: "Conector", permiso: "escritura" },
    });
    expect(respuesta.statusCode).toBe(201);
    return (respuesta.json() as { token: string }).token;
  }

  async function crearTarea(cookie: string, proyectoId: string, titulo: string): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: auth(cookie),
      payload: { titulo },
    });
    expect(respuesta.statusCode).toBe(201);
    return (respuesta.json() as { id: string }).id;
  }

  async function subir(
    cookie: string,
    url: string,
    opciones: { nombre: string; tipo?: string; contenido: Buffer; campo?: string },
  ) {
    const parte: ParteMultipart = {
      nombre: opciones.campo ?? "archivo",
      fichero: opciones.nombre,
      contenido: opciones.contenido,
    };
    if (opciones.tipo !== undefined) parte.tipo = opciones.tipo;
    const { payload, contentType } = cuerpoMultipart([parte]);
    return app.inject({
      method: "POST",
      url,
      headers: { "content-type": contentType, ...auth(cookie) },
      payload,
    });
  }

  async function subirConToken(
    token: string,
    url: string,
    opciones: { nombre: string; contenido: Buffer },
  ) {
    const { payload, contentType } = cuerpoMultipart([
      {
        nombre: "archivo",
        fichero: opciones.nombre,
        tipo: "image/png",
        contenido: opciones.contenido,
      },
    ]);
    return app.inject({
      method: "POST",
      url,
      headers: { "content-type": contentType, authorization: `Bearer ${token}` },
      payload,
    });
  }

  async function ficherosEnDisco(): Promise<string[]> {
    try {
      return (await readdir(dir)).sort();
    } catch {
      return [];
    }
  }

  async function existeFichero(id: string): Promise<boolean> {
    try {
      await stat(join(dir, id));
      return true;
    } catch {
      return false;
    }
  }

  it("exige sesión en las rutas de archivos", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const rutas = [
      { method: "POST", url: `/tareas/${id}/archivos` },
      { method: "POST", url: `/proyectos/${id}/fondos` },
      { method: "GET", url: `/archivos/${id}` },
      { method: "DELETE", url: `/archivos/${id}` },
    ] as const;

    for (const ruta of rutas) {
      const respuesta = await app.inject({ method: ruta.method, url: ruta.url });
      expect(respuesta.statusCode).toBe(401);
    }
  });

  it("sube un PNG y lo sirve en línea con las cabeceras de seguridad", async () => {
    const { cookie } = await registrar("png");
    const proyectoId = await crearProyecto(cookie, "Proyecto png");
    const tareaId = await crearTarea(cookie, proyectoId, "Con adjunto");

    const png = bytesPng(64);
    const subida = await subir(cookie, `/tareas/${tareaId}/archivos`, {
      nombre: "captura.png",
      tipo: "image/png",
      contenido: png,
    });
    expect(subida.statusCode).toBe(201);
    const archivo = subida.json() as { id: string; nombre: string; mime: string; tamano: number };
    expect(archivo).toMatchObject({
      nombre: "captura.png",
      mime: "image/png",
      tamano: png.length,
    });

    // El fichero en disco se llama como el uuid y sin extensión.
    expect(await existeFichero(archivo.id)).toBe(true);
    expect((await stat(join(dir, archivo.id))).size).toBe(png.length);

    const descarga = await app.inject({
      method: "GET",
      url: `/archivos/${archivo.id}`,
      headers: auth(cookie),
    });
    expect(descarga.statusCode).toBe(200);
    expect(descarga.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(descarga.headers["content-security-policy"])).toContain("default-src 'none'");
    expect(String(descarga.headers["content-disposition"]).startsWith("inline")).toBe(true);
    expect(String(descarga.headers["content-type"])).toContain("image/png");
    expect(descarga.headers["cache-control"]).toBe("private, max-age=3600");
    expect(descarga.rawPayload.equals(png)).toBe(true);

    const listado = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}/archivos`,
      headers: auth(cookie),
    });
    const elementos = listado.json() as Array<Record<string, unknown>>;
    expect(elementos).toHaveLength(1);
    expect(elementos[0]).toMatchObject({
      id: archivo.id,
      nombre: "captura.png",
      mime: "image/png",
      tamano: png.length,
    });
    expect(typeof elementos[0]?.createdAt).toBe("string");

    // Recuento de adjuntos en el detalle y en el listado del tablero.
    const detalle = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}`,
      headers: auth(cookie),
    });
    expect((detalle.json() as { adjuntos: number }).adjuntos).toBe(1);

    const tablero = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: auth(cookie),
    });
    const tareaListado = (tablero.json() as Array<{ id: string; adjuntos: number }>).find(
      (tarea) => tarea.id === tareaId,
    );
    expect(tareaListado?.adjuntos).toBe(1);

    // Historial: adjunto añadido.
    const actividad = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}/actividad`,
      headers: auth(cookie),
    });
    const entrada = (
      actividad.json() as { elementos: Array<Record<string, unknown>> }
    ).elementos.find((elemento) => elemento.historialTipo === "adjunto");
    expect(entrada).toMatchObject({
      historialTipo: "adjunto",
      accion: "añadido",
      nombre: "captura.png",
      archivoId: archivo.id,
    });
  });

  it("sirve como descarga lo que no es una imagen aunque diga .png", async () => {
    const { cookie } = await registrar("falso");
    const proyectoId = await crearProyecto(cookie, "Proyecto falso");
    const tareaId = await crearTarea(cookie, proyectoId, "Falso png");

    const html = Buffer.from("<html><body>no soy una imagen</body></html>", "utf8");
    const subida = await subir(cookie, `/tareas/${tareaId}/archivos`, {
      nombre: "falso.png",
      tipo: "image/png",
      contenido: html,
    });
    expect(subida.statusCode).toBe(201);
    const archivo = subida.json() as { id: string; mime: string };
    expect(archivo.mime).toBe("application/octet-stream");

    const descarga = await app.inject({
      method: "GET",
      url: `/archivos/${archivo.id}`,
      headers: auth(cookie),
    });
    expect(descarga.statusCode).toBe(200);
    expect(String(descarga.headers["content-disposition"]).startsWith("attachment")).toBe(true);
    expect(String(descarga.headers["content-type"])).toContain("application/octet-stream");
    expect(descarga.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("rechaza fondos que no son imágenes y acepta las cuatro permitidas", async () => {
    const { cookie } = await registrar("fondos");
    const proyectoId = await crearProyecto(cookie, "Proyecto fondos");

    const rechazado = await subir(cookie, `/proyectos/${proyectoId}/fondos`, {
      nombre: "fondo.png",
      tipo: "image/png",
      contenido: Buffer.from("esto no es una imagen", "utf8"),
    });
    expect(rechazado.statusCode).toBe(400);

    const permitidas = [
      { nombre: "fondo.png", tipo: "image/png", contenido: bytesPng(8), mime: "image/png" },
      { nombre: "fondo.jpg", tipo: "image/jpeg", contenido: FIRMA_JPEG, mime: "image/jpeg" },
      { nombre: "fondo.gif", tipo: "image/gif", contenido: FIRMA_GIF, mime: "image/gif" },
      { nombre: "fondo.webp", tipo: "image/webp", contenido: FIRMA_WEBP, mime: "image/webp" },
    ];

    for (const fondo of permitidas) {
      const subida = await subir(cookie, `/proyectos/${proyectoId}/fondos`, {
        nombre: fondo.nombre,
        tipo: fondo.tipo,
        contenido: fondo.contenido,
      });
      expect(subida.statusCode).toBe(201);
      expect((subida.json() as { mime: string }).mime).toBe(fondo.mime);
    }

    const listado = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/fondos`,
      headers: auth(cookie),
    });
    const elementos = listado.json() as Array<Record<string, unknown>>;
    expect(elementos).toHaveLength(4);
    expect(elementos[0]).toHaveProperty("createdAt");
    expect(elementos[0]).toHaveProperty("tamano");
  });

  it("responde 413 si el fichero supera el límite y no deja restos en disco", async () => {
    const { cookie } = await registrar("limite");
    const proyectoId = await crearProyecto(cookie, "Proyecto límite");
    const tareaId = await crearTarea(cookie, proyectoId, "Demasiado grande");

    const antes = await ficherosEnDisco();
    const grande = Buffer.concat([FIRMA_PNG, Buffer.alloc(MAX_BYTES + 500, 0x41)]);
    const respuesta = await subir(cookie, `/tareas/${tareaId}/archivos`, {
      nombre: "grande.png",
      tipo: "image/png",
      contenido: grande,
    });

    expect(respuesta.statusCode).toBe(413);
    expect(await ficherosEnDisco()).toEqual(antes);
  });

  it("rechaza peticiones sin fichero o con otro campo", async () => {
    const { cookie } = await registrar("sinfichero");
    const proyectoId = await crearProyecto(cookie, "Proyecto sin fichero");
    const tareaId = await crearTarea(cookie, proyectoId, "Sin fichero");
    const url = `/tareas/${tareaId}/archivos`;

    const soloCampo = cuerpoMultipart([{ nombre: "otro", contenido: "hola" }]);
    const sinFichero = await app.inject({
      method: "POST",
      url,
      headers: { "content-type": soloCampo.contentType, ...auth(cookie) },
      payload: soloCampo.payload,
    });
    expect(sinFichero.statusCode).toBe(400);

    const otroCampo = await subir(cookie, url, {
      nombre: "x.png",
      tipo: "image/png",
      contenido: bytesPng(8),
      campo: "fichero",
    });
    expect(otroCampo.statusCode).toBe(400);

    const noMultipart = await app.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/json", ...auth(cookie) },
      payload: { hola: 1 },
    });
    expect(noMultipart.statusCode).toBe(400);
  });

  it("aísla los archivos, tareas y proyectos entre usuarios", async () => {
    const alice = await registrar("alice-archivos");
    const bob = await registrar("bob-archivos");
    const proyectoId = await crearProyecto(alice.cookie, "Proyecto de Alice");
    const tareaId = await crearTarea(alice.cookie, proyectoId, "Tarea de Alice");

    const subida = await subir(alice.cookie, `/tareas/${tareaId}/archivos`, {
      nombre: "privado.png",
      tipo: "image/png",
      contenido: bytesPng(8),
    });
    expect(subida.statusCode).toBe(201);
    const archivoId = (subida.json() as { id: string }).id;

    const getAjeno = await app.inject({
      method: "GET",
      url: `/archivos/${archivoId}`,
      headers: auth(bob.cookie),
    });
    expect(getAjeno.statusCode).toBe(404);

    const deleteAjeno = await app.inject({
      method: "DELETE",
      url: `/archivos/${archivoId}`,
      headers: auth(bob.cookie),
    });
    expect(deleteAjeno.statusCode).toBe(404);

    const subirATareaAjena = await subir(bob.cookie, `/tareas/${tareaId}/archivos`, {
      nombre: "intruso.png",
      tipo: "image/png",
      contenido: bytesPng(8),
    });
    expect(subirATareaAjena.statusCode).toBe(404);

    const listarTareaAjena = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}/archivos`,
      headers: auth(bob.cookie),
    });
    expect(listarTareaAjena.statusCode).toBe(404);

    const subirFondoAjeno = await subir(bob.cookie, `/proyectos/${proyectoId}/fondos`, {
      nombre: "fondo.png",
      tipo: "image/png",
      contenido: bytesPng(8),
    });
    expect(subirFondoAjeno.statusCode).toBe(404);

    const listarFondosAjenos = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/fondos`,
      headers: auth(bob.cookie),
    });
    expect(listarFondosAjenos.statusCode).toBe(404);
  });

  it("sanea el nombre original", () => {
    expect(sanearNombreArchivo("../../etc/passwd")).toBe("passwd");
    expect(sanearNombreArchivo("..\\..\\windows\\evil.png")).toBe("evil.png");
    expect(sanearNombreArchivo("linea\noculta.png")).toBe("lineaoculta.png");
    expect(sanearNombreArchivo("con\ttabulador.png")).toBe("contabulador.png");
    expect(sanearNombreArchivo("   ")).toBe("archivo");
    expect(sanearNombreArchivo("x".repeat(300))).toHaveLength(200);
  });

  it("guarda solo el nombre base y no inyecta cabeceras", async () => {
    const { cookie } = await registrar("saneado");
    const proyectoId = await crearProyecto(cookie, "Proyecto saneado");
    const tareaId = await crearTarea(cookie, proyectoId, "Nombre saneado");

    const subida = await subir(cookie, `/tareas/${tareaId}/archivos`, {
      nombre: "../../evil.png",
      tipo: "image/png",
      contenido: bytesPng(8),
    });
    expect(subida.statusCode).toBe(201);
    const archivo = subida.json() as { id: string; nombre: string };
    expect(archivo.nombre).toBe("evil.png");

    const descarga = await app.inject({
      method: "GET",
      url: `/archivos/${archivo.id}`,
      headers: auth(cookie),
    });
    const disposicion = String(descarga.headers["content-disposition"]);
    expect(disposicion).not.toContain("..");
    expect(disposicion).not.toMatch(/[\r\n]/);
    expect(disposicion).toContain("filename*=UTF-8''evil.png");
  });

  it("al borrar el adjunto borra el fichero y registra el historial", async () => {
    const { cookie } = await registrar("borrar-adjunto");
    const proyectoId = await crearProyecto(cookie, "Proyecto borrado adjunto");
    const tareaId = await crearTarea(cookie, proyectoId, "Con adjunto borrado");

    const subida = await subir(cookie, `/tareas/${tareaId}/archivos`, {
      nombre: "borrame.png",
      tipo: "image/png",
      contenido: bytesPng(8),
    });
    const archivoId = (subida.json() as { id: string }).id;
    expect(await existeFichero(archivoId)).toBe(true);

    const borrado = await app.inject({
      method: "DELETE",
      url: `/archivos/${archivoId}`,
      headers: auth(cookie),
    });
    expect(borrado.statusCode).toBe(204);
    expect(await existeFichero(archivoId)).toBe(false);

    const getBorrado = await app.inject({
      method: "GET",
      url: `/archivos/${archivoId}`,
      headers: auth(cookie),
    });
    expect(getBorrado.statusCode).toBe(404);

    const actividad = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}/actividad`,
      headers: auth(cookie),
    });
    const quitado = (
      actividad.json() as { elementos: Array<Record<string, unknown>> }
    ).elementos.find((elemento) => elemento.accion === "quitado");
    expect(quitado).toMatchObject({ historialTipo: "adjunto", archivoId: archivoId });
  });

  it("al borrar la tarea borra sus ficheros", async () => {
    const { cookie } = await registrar("borrar-tarea");
    const proyectoId = await crearProyecto(cookie, "Proyecto borrado tarea");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con adjuntos");

    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const subida = await subir(cookie, `/tareas/${tareaId}/archivos`, {
        nombre: `adjunto-${i}.png`,
        tipo: "image/png",
        contenido: bytesPng(8),
      });
      ids.push((subida.json() as { id: string }).id);
    }

    const borrado = await app.inject({
      method: "DELETE",
      url: `/tareas/${tareaId}`,
      headers: auth(cookie),
    });
    expect(borrado.statusCode).toBe(204);

    for (const id of ids) {
      expect(await existeFichero(id)).toBe(false);
    }
  });

  it("al borrar el proyecto borra adjuntos y fondos", async () => {
    const { cookie } = await registrar("borrar-proyecto");
    const proyectoId = await crearProyecto(cookie, "Proyecto con archivos");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con adjunto");

    const adjunto = await subir(cookie, `/tareas/${tareaId}/archivos`, {
      nombre: "adjunto.png",
      tipo: "image/png",
      contenido: bytesPng(8),
    });
    const fondo = await subir(cookie, `/proyectos/${proyectoId}/fondos`, {
      nombre: "fondo.png",
      tipo: "image/png",
      contenido: bytesPng(8),
    });
    const ids = [(adjunto.json() as { id: string }).id, (fondo.json() as { id: string }).id];

    const borrado = await app.inject({
      method: "DELETE",
      url: `/proyectos/${proyectoId}`,
      headers: auth(cookie),
    });
    expect(borrado.statusCode).toBe(204);

    for (const id of ids) {
      expect(await existeFichero(id)).toBe(false);
    }
  });

  it("acepta una portada de imagen adjunta a la tarea y limpia la referencia al borrarla", async () => {
    const { cookie } = await registrar("portada");
    const proyectoId = await crearProyecto(cookie, "Proyecto portada");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea portada");

    const imagen = await subir(cookie, `/tareas/${tareaId}/archivos`, {
      nombre: "portada.png",
      tipo: "image/png",
      contenido: bytesPng(8),
    });
    const imagenId = (imagen.json() as { id: string }).id;

    const noImagen = await subir(cookie, `/tareas/${tareaId}/archivos`, {
      nombre: "notas.txt",
      tipo: "text/plain",
      contenido: Buffer.from("solo texto"),
    });
    const noImagenId = (noImagen.json() as { id: string }).id;

    const fondo = await subir(cookie, `/proyectos/${proyectoId}/fondos`, {
      nombre: "fondo.png",
      tipo: "image/png",
      contenido: bytesPng(8),
    });
    const fondoId = (fondo.json() as { id: string }).id;

    const valida = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaId}`,
      headers: auth(cookie),
      payload: { portada: { tipo: "imagen", archivoId: imagenId } },
    });
    expect(valida.statusCode).toBe(200);
    expect((valida.json() as { portada: unknown }).portada).toEqual({
      tipo: "imagen",
      archivoId: imagenId,
    });

    for (const archivoId of [noImagenId, fondoId, "11111111-1111-4111-8111-111111111111"]) {
      const invalida = await app.inject({
        method: "PATCH",
        url: `/tareas/${tareaId}`,
        headers: auth(cookie),
        payload: { portada: { tipo: "imagen", archivoId } },
      });
      expect(invalida.statusCode).toBe(400);
    }

    const borrado = await app.inject({
      method: "DELETE",
      url: `/archivos/${imagenId}`,
      headers: auth(cookie),
    });
    expect(borrado.statusCode).toBe(204);

    const detalle = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}`,
      headers: auth(cookie),
    });
    expect((detalle.json() as { portada: unknown }).portada).toBeNull();
  });

  it("acepta un fondo con imágenes del proyecto y limpia la referencia al borrarlas", async () => {
    const { cookie } = await registrar("fondo-imagenes");
    const proyectoId = await crearProyecto(cookie, "Proyecto fondo imágenes");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con adjunto");

    const fondos: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const subida = await subir(cookie, `/proyectos/${proyectoId}/fondos`, {
        nombre: `fondo-${i}.png`,
        tipo: "image/png",
        contenido: bytesPng(8),
      });
      fondos.push((subida.json() as { id: string }).id);
    }

    const adjunto = await subir(cookie, `/tareas/${tareaId}/archivos`, {
      nombre: "adjunto.png",
      tipo: "image/png",
      contenido: bytesPng(8),
    });
    const adjuntoId = (adjunto.json() as { id: string }).id;

    const valido = await app.inject({
      method: "PATCH",
      url: `/proyectos/${proyectoId}`,
      headers: auth(cookie),
      payload: { fondo: { tipo: "imagenes", ids: fondos, intervaloSeg: 30 } },
    });
    expect(valido.statusCode).toBe(200);
    expect((valido.json() as { fondo: { ids: string[] } }).fondo.ids).toEqual(fondos);

    const invalidos = [
      [adjuntoId],
      ["11111111-1111-4111-8111-111111111111"],
      [fondos[0], adjuntoId],
    ];
    for (const ids of invalidos) {
      const respuesta = await app.inject({
        method: "PATCH",
        url: `/proyectos/${proyectoId}`,
        headers: auth(cookie),
        payload: { fondo: { tipo: "imagenes", ids, intervaloSeg: 30 } },
      });
      expect(respuesta.statusCode).toBe(400);
    }

    await app.inject({
      method: "DELETE",
      url: `/archivos/${fondos[0]}`,
      headers: auth(cookie),
    });
    const conUno = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}`,
      headers: auth(cookie),
    });
    expect((conUno.json() as { fondo: { ids: string[] } }).fondo.ids).toEqual([fondos[1]]);

    await app.inject({
      method: "DELETE",
      url: `/archivos/${fondos[1]}`,
      headers: auth(cookie),
    });
    const sinFondos = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}`,
      headers: auth(cookie),
    });
    expect((sinFondos.json() as { fondo: unknown }).fondo).toEqual({
      tipo: "ambiente",
      ambiente: "bosque",
    });
  });

  it("respeta los límites de cantidad de adjuntos y fondos", async () => {
    const { cookie } = await registrar("cantidad");

    const proyectoId = await crearProyecto(cookie, "Proyecto cantidades");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con muchos adjuntos");

    for (let i = 0; i < 20; i += 1) {
      const subida = await subir(cookie, `/tareas/${tareaId}/archivos`, {
        nombre: `adjunto-${i}.png`,
        tipo: "image/png",
        contenido: bytesPng(4),
      });
      expect(subida.statusCode).toBe(201);
    }

    const adjuntoDeMas = await subir(cookie, `/tareas/${tareaId}/archivos`, {
      nombre: "adjunto-21.png",
      tipo: "image/png",
      contenido: bytesPng(4),
    });
    expect(adjuntoDeMas.statusCode).toBe(400);

    const proyectoFondos = await crearProyecto(cookie, "Proyecto muchos fondos");
    for (let i = 0; i < 10; i += 1) {
      const subida = await subir(cookie, `/proyectos/${proyectoFondos}/fondos`, {
        nombre: `fondo-${i}.png`,
        tipo: "image/png",
        contenido: bytesPng(4),
      });
      expect(subida.statusCode).toBe(201);
    }

    const fondoDeMas = await subir(cookie, `/proyectos/${proyectoFondos}/fondos`, {
      nombre: "fondo-11.png",
      tipo: "image/png",
      contenido: bytesPng(4),
    });
    expect(fondoDeMas.statusCode).toBe(400);
  });

  it("no supera el límite de adjuntos con dos subidas simultáneas", async () => {
    const { cookie } = await registrar("carrera-adjuntos");
    const proyectoId = await crearProyecto(cookie, "Proyecto carrera");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con 19 adjuntos");

    for (let i = 0; i < 19; i += 1) {
      const subida = await subir(cookie, `/tareas/${tareaId}/archivos`, {
        nombre: `previo-${i}.png`,
        tipo: "image/png",
        contenido: bytesPng(4),
      });
      expect(subida.statusCode).toBe(201);
    }

    const antes = await ficherosEnDisco();
    const respuestas = await Promise.all([
      subir(cookie, `/tareas/${tareaId}/archivos`, {
        nombre: "carrera-a.png",
        tipo: "image/png",
        contenido: bytesPng(4),
      }),
      subir(cookie, `/tareas/${tareaId}/archivos`, {
        nombre: "carrera-b.png",
        tipo: "image/png",
        contenido: bytesPng(4),
      }),
    ]);

    expect(respuestas.map((respuesta) => respuesta.statusCode).sort()).toEqual([201, 400]);
    const rechazada = respuestas.find((respuesta) => respuesta.statusCode === 400);
    expect((rechazada!.json() as { mensaje: string }).mensaje).toBe(
      "La tarea admite como máximo 20 adjuntos",
    );

    const listado = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}/archivos`,
      headers: auth(cookie),
    });
    expect((listado.json() as unknown[]).length).toBe(20);
    // Solo queda el fichero aceptado: la subida rechazada no deja huérfano.
    expect(await ficherosEnDisco()).toHaveLength(antes.length + 1);
  });

  it("no supera el límite de fondos con dos subidas simultáneas", async () => {
    const { cookie } = await registrar("carrera-fondos");
    const proyectoId = await crearProyecto(cookie, "Proyecto carrera de fondos");

    for (let i = 0; i < 9; i += 1) {
      const subida = await subir(cookie, `/proyectos/${proyectoId}/fondos`, {
        nombre: `previo-${i}.png`,
        tipo: "image/png",
        contenido: bytesPng(4),
      });
      expect(subida.statusCode).toBe(201);
    }

    const antes = await ficherosEnDisco();
    const respuestas = await Promise.all([
      subir(cookie, `/proyectos/${proyectoId}/fondos`, {
        nombre: "carrera-a.png",
        tipo: "image/png",
        contenido: bytesPng(4),
      }),
      subir(cookie, `/proyectos/${proyectoId}/fondos`, {
        nombre: "carrera-b.png",
        tipo: "image/png",
        contenido: bytesPng(4),
      }),
    ]);

    expect(respuestas.map((respuesta) => respuesta.statusCode).sort()).toEqual([201, 400]);
    const rechazada = respuestas.find((respuesta) => respuesta.statusCode === 400);
    expect((rechazada!.json() as { mensaje: string }).mensaje).toBe(
      "El proyecto admite como máximo 10 fondos",
    );

    const listado = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/fondos`,
      headers: auth(cookie),
    });
    expect((listado.json() as unknown[]).length).toBe(10);
    expect(await ficherosEnDisco()).toHaveLength(antes.length + 1);
  });

  it("con token, subir y borrar un adjunto no ensucia la actividad y deja el historial", async () => {
    const { cookie } = await registrar("token-actividad");
    const proyectoId = await crearProyecto(cookie, "Proyecto con token");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con token");
    const token = await crearToken(cookie);

    const subida = await subirConToken(token, `/tareas/${tareaId}/archivos`, {
      nombre: "con-token.png",
      contenido: bytesPng(8),
    });
    expect(subida.statusCode).toBe(201);
    const archivoId = (subida.json() as { id: string }).id;

    const sinActividad = await app.inject({
      method: "GET",
      url: "/actividad",
      headers: auth(cookie),
    });
    expect(sinActividad.json()).toEqual([]);

    const borrado = await app.inject({
      method: "DELETE",
      url: `/archivos/${archivoId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(borrado.statusCode).toBe(204);

    const trasBorrar = await app.inject({
      method: "GET",
      url: "/actividad",
      headers: auth(cookie),
    });
    expect(trasBorrar.json()).toEqual([]);

    const historial = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}/actividad`,
      headers: auth(cookie),
    });
    const elementos = (historial.json() as { elementos: Array<Record<string, unknown>> }).elementos;
    const acciones = elementos
      .filter((elemento) => elemento.historialTipo === "adjunto")
      .map((elemento) => elemento.accion)
      .sort();
    expect(acciones).toEqual(["añadido", "quitado"]);
  });
});
