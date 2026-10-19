import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import type { Database } from "./db/index.js";
import * as schema from "./db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const MAX_BYTES = 4000;
const BOUNDARY = "----todopruebabiblioteca";

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FIRMA_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function bytesPng(extra = 0): Buffer {
  return Buffer.concat([FIRMA_PNG, Buffer.alloc(extra, 0x20)]);
}

function cuerpoMultipart(contenido: Buffer, nombre: string): { payload: Buffer; contentType: string } {
  const payload = Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="archivo"; filename="${nombre}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      "utf8",
    ),
    contenido,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  return { payload, contentType: `multipart/form-data; boundary=${BOUNDARY}` };
}

function obtenerCookieSesion(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

const FONDO_BOSQUE = { tipo: "ambiente", ambiente: "bosque" };

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

describe("API de la biblioteca de imágenes", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: FastifyInstance;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "todo-biblioteca-"));
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
    const email = `biblioteca-${sufijo}@example.com`;
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

  async function subirImagen(
    cookie: string,
    nombre: string,
    contenido: Buffer = bytesPng(16),
  ) {
    const { payload, contentType } = cuerpoMultipart(contenido, nombre);
    return app.inject({
      method: "POST",
      url: "/biblioteca",
      headers: { "content-type": contentType, ...auth(cookie) },
      payload,
    });
  }

  async function imagenSubida(
    cookie: string,
    nombre: string,
    contenido: Buffer = bytesPng(16),
  ): Promise<{ id: string; nombre: string; mime: string; tamano: number }> {
    const respuesta = await subirImagen(cookie, nombre, contenido);
    expect(respuesta.statusCode).toBe(201);
    return respuesta.json() as { id: string; nombre: string; mime: string; tamano: number };
  }

  async function crearProyecto(cookie: string, nombre: string) {
    const respuesta = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: auth(cookie),
      payload: { nombre },
    });
    expect(respuesta.statusCode).toBe(201);
    return respuesta.json() as { id: string; fondo: Record<string, unknown> };
  }

  async function obtenerProyecto(cookie: string, id: string) {
    const respuesta = await app.inject({
      method: "GET",
      url: `/proyectos/${id}`,
      headers: auth(cookie),
    });
    expect(respuesta.statusCode).toBe(200);
    return respuesta.json() as { fondo: Record<string, unknown> };
  }

  async function listarBiblioteca(cookie: string) {
    const respuesta = await app.inject({
      method: "GET",
      url: "/biblioteca",
      headers: auth(cookie),
    });
    expect(respuesta.statusCode).toBe(200);
    return respuesta.json() as Array<{ id: string; nombre: string }>;
  }

  async function existeFichero(id: string): Promise<boolean> {
    try {
      await stat(join(dir, id));
      return true;
    } catch {
      return false;
    }
  }

  async function ficherosEnDisco(): Promise<string[]> {
    try {
      return (await readdir(dir)).sort();
    } catch {
      return [];
    }
  }

  it("exige sesión en las rutas de la biblioteca", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const rutas = [
      { method: "POST", url: "/biblioteca" },
      { method: "GET", url: "/biblioteca" },
      { method: "POST", url: "/biblioteca/aleatorias" },
      { method: "DELETE", url: `/biblioteca/${id}` },
    ] as const;

    for (const ruta of rutas) {
      const respuesta = await app.inject({ method: ruta.method, url: ruta.url });
      expect(respuesta.statusCode).toBe(401);
    }
  });

  it("sube imágenes, las sirve al propietario y las lista de más nueva a más antigua", async () => {
    const { cookie } = await registrar("listar");

    const primera = await imagenSubida(cookie, "primera.png", bytesPng(20));
    await esperar(5);
    const segunda = await imagenSubida(cookie, "segunda.jpg", FIRMA_JPEG);

    expect(primera).toMatchObject({
      nombre: "primera.png",
      mime: "image/png",
      tamano: bytesPng(20).length,
    });
    expect(segunda.mime).toBe("image/jpeg");
    expect(await existeFichero(primera.id)).toBe(true);

    const listado = await listarBiblioteca(cookie);
    expect(listado.map((imagen) => imagen.id)).toEqual([segunda.id, primera.id]);

    const descarga = await app.inject({
      method: "GET",
      url: `/archivos/${primera.id}`,
      headers: auth(cookie),
    });
    expect(descarga.statusCode).toBe(200);
    expect(descarga.rawPayload.equals(bytesPng(20))).toBe(true);
    expect(String(descarga.headers["content-type"])).toContain("image/png");
  });

  it("rechaza lo que no es una imagen permitida sin dejar restos", async () => {
    const { cookie } = await registrar("no-imagen");

    const antes = await ficherosEnDisco();
    const respuesta = await subirImagen(
      cookie,
      "falsa.png",
      Buffer.from("<html>no soy una imagen</html>", "utf8"),
    );
    expect(respuesta.statusCode).toBe(400);
    expect(await ficherosEnDisco()).toEqual(antes);
    expect(await listarBiblioteca(cookie)).toEqual([]);
  });

  it("aísla la biblioteca entre usuarios también al usarla como fondo", async () => {
    const alice = await registrar("alice");
    const bob = await registrar("bob");

    const imagenAlice = await imagenSubida(alice.cookie, "de-alice.png");

    expect(await listarBiblioteca(bob.cookie)).toEqual([]);

    const descargaAjena = await app.inject({
      method: "GET",
      url: `/archivos/${imagenAlice.id}`,
      headers: auth(bob.cookie),
    });
    expect(descargaAjena.statusCode).toBe(404);

    const borradoAjeno = await app.inject({
      method: "DELETE",
      url: `/biblioteca/${imagenAlice.id}`,
      headers: auth(bob.cookie),
    });
    expect(borradoAjeno.statusCode).toBe(404);

    const aleatoriasAjenas = await app.inject({
      method: "POST",
      url: "/biblioteca/aleatorias",
      headers: auth(bob.cookie),
    });
    expect(aleatoriasAjenas.statusCode).toBe(404);

    const proyectoBob = await crearProyecto(bob.cookie, "Proyecto de Bob");
    const patchAjeno = await app.inject({
      method: "PATCH",
      url: `/proyectos/${proyectoBob.id}`,
      headers: auth(bob.cookie),
      payload: { fondo: { tipo: "imagenes", ids: [imagenAlice.id], intervaloSeg: 30 } },
    });
    expect(patchAjeno.statusCode).toBe(400);

    // Alice sí puede usar la suya, mezclada con un fondo propio del proyecto.
    const proyectoAlice = await crearProyecto(alice.cookie, "Proyecto de Alice");
    const { payload, contentType } = cuerpoMultipart(bytesPng(8), "propio.png");
    const subidaFondo = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoAlice.id}/fondos`,
      headers: { "content-type": contentType, ...auth(alice.cookie) },
      payload,
    });
    expect(subidaFondo.statusCode).toBe(201);
    const fondoPropioId = (subidaFondo.json() as { id: string }).id;

    const mezcla = await app.inject({
      method: "PATCH",
      url: `/proyectos/${proyectoAlice.id}`,
      headers: auth(alice.cookie),
      payload: {
        fondo: {
          tipo: "imagenes",
          ids: [imagenAlice.id, fondoPropioId],
          intervaloSeg: 30,
        },
      },
    });
    expect(mezcla.statusCode).toBe(200);
    expect((mezcla.json() as { fondo: { ids: string[] } }).fondo.ids).toEqual([
      imagenAlice.id,
      fondoPropioId,
    ]);
  });

  it("al borrar una imagen la quita de los fondos y degrada a ambiente si queda vacío", async () => {
    const { cookie } = await registrar("borrar");

    const una = await imagenSubida(cookie, "una.png");
    const otra = await imagenSubida(cookie, "otra.png");
    const proyecto = await crearProyecto(cookie, "Proyecto con fondo de biblioteca");

    // El proyecto nuevo ya arranca con las dos imágenes de la biblioteca.
    expect((proyecto.fondo as { tipo: string }).tipo).toBe("imagenes");

    const conDos = await app.inject({
      method: "PATCH",
      url: `/proyectos/${proyecto.id}`,
      headers: auth(cookie),
      payload: { fondo: { tipo: "imagenes", ids: [una.id, otra.id], intervaloSeg: 60 } },
    });
    expect(conDos.statusCode).toBe(200);

    const borrarUna = await app.inject({
      method: "DELETE",
      url: `/biblioteca/${una.id}`,
      headers: auth(cookie),
    });
    expect(borrarUna.statusCode).toBe(204);
    expect(await existeFichero(una.id)).toBe(false);

    const conUna = await obtenerProyecto(cookie, proyecto.id);
    expect((conUna.fondo as { ids: string[] }).ids).toEqual([otra.id]);

    const borrarOtra = await app.inject({
      method: "DELETE",
      url: `/biblioteca/${otra.id}`,
      headers: auth(cookie),
    });
    expect(borrarOtra.statusCode).toBe(204);
    expect(await existeFichero(otra.id)).toBe(false);

    const sinImagenes = await obtenerProyecto(cookie, proyecto.id);
    expect(sinImagenes.fondo).toEqual(FONDO_BOSQUE);

    expect(await listarBiblioteca(cookie)).toEqual([]);

    const borrarOtraVez = await app.inject({
      method: "DELETE",
      url: `/biblioteca/${otra.id}`,
      headers: auth(cookie),
    });
    expect(borrarOtraVez.statusCode).toBe(404);
  });

  it("un proyecto nuevo sin biblioteca arranca con el ambiente de bosque", async () => {
    const { cookie } = await registrar("nuevo-vacio");
    const proyecto = await crearProyecto(cookie, "Proyecto sin biblioteca");
    expect(proyecto.fondo).toEqual(FONDO_BOSQUE);
  });

  it("un proyecto nuevo usa hasta 7 imágenes al azar de la biblioteca", async () => {
    const { cookie } = await registrar("nuevo-lleno");

    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const imagen = await imagenSubida(cookie, `imagen-${i}.png`, bytesPng(4 + i));
      ids.push(imagen.id);
    }

    const proyecto = await crearProyecto(cookie, "Proyecto con biblioteca");
    const fondo = proyecto.fondo as { tipo: string; ids: string[]; intervaloSeg: number };
    expect(fondo.tipo).toBe("imagenes");
    expect(fondo.intervaloSeg).toBe(60);
    expect(fondo.ids).toHaveLength(7);
    expect(new Set(fondo.ids).size).toBe(7);
    for (const id of fondo.ids) {
      expect(ids).toContain(id);
    }
  });

  it("con menos de 7 imágenes usa todas las que hay", async () => {
    const { cookie } = await registrar("nuevo-tres");

    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const imagen = await imagenSubida(cookie, `imagen-${i}.png`, bytesPng(4 + i));
      ids.push(imagen.id);
    }

    const proyecto = await crearProyecto(cookie, "Proyecto con tres");
    const fondo = proyecto.fondo as { tipo: string; ids: string[]; intervaloSeg: number };
    expect(fondo.tipo).toBe("imagenes");
    expect(fondo.intervaloSeg).toBe(60);
    expect([...fondo.ids].sort()).toEqual([...ids].sort());
  });

  it("POST /biblioteca/aleatorias devuelve hasta 7 ids o 404 si está vacía", async () => {
    const vacia = await registrar("aleatorias-vacia");
    const sinNada = await app.inject({
      method: "POST",
      url: "/biblioteca/aleatorias",
      headers: auth(vacia.cookie),
    });
    expect(sinNada.statusCode).toBe(404);
    expect((sinNada.json() as { mensaje: string }).mensaje).toContain("no tiene imágenes");

    const { cookie } = await registrar("aleatorias");
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const imagen = await imagenSubida(cookie, `imagen-${i}.png`, bytesPng(4 + i));
      ids.push(imagen.id);
    }

    const respuesta = await app.inject({
      method: "POST",
      url: "/biblioteca/aleatorias",
      headers: auth(cookie),
    });
    expect(respuesta.statusCode).toBe(200);
    const { ids: elegidas } = respuesta.json() as { ids: string[] };
    expect(elegidas).toHaveLength(7);
    expect(new Set(elegidas).size).toBe(7);
    for (const id of elegidas) {
      expect(ids).toContain(id);
    }
  });

  it("al borrar el proyecto se conservan las imágenes de la biblioteca", async () => {
    const { cookie } = await registrar("borrar-proyecto");

    const una = await imagenSubida(cookie, "una.png");
    const otra = await imagenSubida(cookie, "otra.png");
    const proyecto = await crearProyecto(cookie, "Proyecto que se borra");

    const borrado = await app.inject({
      method: "DELETE",
      url: `/proyectos/${proyecto.id}`,
      headers: auth(cookie),
    });
    expect(borrado.statusCode).toBe(204);

    const listado = await listarBiblioteca(cookie);
    expect(listado.map((imagen) => imagen.id).sort()).toEqual([una.id, otra.id].sort());

    for (const id of [una.id, otra.id]) {
      expect(await existeFichero(id)).toBe(true);
      const descarga = await app.inject({
        method: "GET",
        url: `/archivos/${id}`,
        headers: auth(cookie),
      });
      expect(descarga.statusCode).toBe(200);
    }
  });

  it("borrar la imagen por la ruta genérica también la quita de los fondos", async () => {
    const { cookie } = await registrar("borrar-generico");

    const imagen = await imagenSubida(cookie, "generica.png");
    const proyecto = await crearProyecto(cookie, "Proyecto con genérica");
    expect((proyecto.fondo as { ids: string[] }).ids).toEqual([imagen.id]);

    const borrado = await app.inject({
      method: "DELETE",
      url: `/archivos/${imagen.id}`,
      headers: auth(cookie),
    });
    expect(borrado.statusCode).toBe(204);

    const sinImagenes = await obtenerProyecto(cookie, proyecto.id);
    expect(sinImagenes.fondo).toEqual(FONDO_BOSQUE);
    expect(await listarBiblioteca(cookie)).toEqual([]);
  });

  it("respeta el límite configurable y no lo supera con dos subidas simultáneas", async () => {
    const dirLimite = await mkdtemp(join(tmpdir(), "todo-biblioteca-limite-"));
    const clientLimite = new PGlite();
    const dbLimite = drizzle(clientLimite, { schema });
    await migrate(dbLimite, { migrationsFolder });
    const appLimite = await buildApp(dbLimite as unknown as Database, {
      limiteAuth: { max: 100000, ventanaMs: 60 * 60 * 1000, maxPorCorreo: 100000 },
      archivos: { dir: dirLimite, maxBytes: MAX_BYTES },
      biblioteca: { maxImagenes: 1 },
    });
    await appLimite.ready();

    try {
      const email = "biblioteca-limite@example.com";
      const registro = await appLimite.inject({
        method: "POST",
        url: "/auth/registro",
        payload: { email, nombre: "Usuario límite", contrasena: "contrasena-muy-larga" },
      });
      const cookie = obtenerCookieSesion(registro);
      const cookies = { cookie: `sesion=${cookie}` };

      const subir = (nombre: string) => {
        const { payload, contentType } = cuerpoMultipart(bytesPng(8), nombre);
        return appLimite.inject({
          method: "POST",
          url: "/biblioteca",
          headers: { "content-type": contentType, ...cookies },
          payload,
        });
      };

      const respuestas = await Promise.all([subir("a.png"), subir("b.png")]);
      expect(respuestas.map((respuesta) => respuesta.statusCode).sort()).toEqual([201, 400]);

      const rechazada = respuestas.find((respuesta) => respuesta.statusCode === 400);
      expect((rechazada!.json() as { mensaje: string }).mensaje).toBe(
        "La biblioteca admite como máximo 1 imágenes",
      );

      const listado = await appLimite.inject({
        method: "GET",
        url: "/biblioteca",
        headers: cookies,
      });
      expect((listado.json() as unknown[]).length).toBe(1);
      expect(await readdir(dirLimite)).toHaveLength(1);
    } finally {
      await appLimite.close();
      await clientLimite.close();
      await rm(dirLimite, { recursive: true, force: true });
    }
  });
});
