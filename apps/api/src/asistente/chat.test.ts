import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { type FastifyInstance } from "fastify";

import { buildApp, type OpcionesApp } from "../app.js";
import type { Database } from "../db/index.js";
import * as schema from "../db/schema.js";
import { tareas } from "../db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

const CLAVE_CIFRADO = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const CLAVE_PROVEEDOR = "sk-chat-1234";

const OPCIONES_CHAT: NonNullable<OpcionesApp["asistente"]> = {
  claveCifrado: CLAVE_CIFRADO,
  chat: {
    maxVueltas: 6,
    tiempoMaximoMs: 5000,
    maxTokens: 500,
    limite: { max: 1000, ventanaMs: 60_000 },
  },
};

interface GuionLlamada {
  nombre: string;
  argumentos: string | Record<string, unknown>;
}

interface Guion {
  estado?: number;
  contenido?: string | null;
  llamadas?: GuionLlamada[];
}

interface PeticionFalsa {
  autorizacion: string;
  cuerpo: Record<string, unknown>;
}

interface ProveedorFalso {
  baseUrl: string;
  peticiones: PeticionFalsa[];
  cerrar: () => Promise<void>;
}

/** Servidor Chat Completions falso: devuelve los guiones en orden y los registra. */
function crearProveedorFalso(guiones: Guion[]): Promise<ProveedorFalso> {
  const peticiones: PeticionFalsa[] = [];
  let contador = 0;
  const server: Server = createServer((peticion, respuesta) => {
    const trozos: Buffer[] = [];
    peticion.on("data", (trozo) => trozos.push(trozo as Buffer));
    peticion.on("end", () => {
      peticiones.push({
        autorizacion: String(peticion.headers.authorization ?? ""),
        cuerpo: JSON.parse(Buffer.concat(trozos).toString("utf8") || "{}") as Record<
          string,
          unknown
        >,
      });
      const guion = guiones[contador];
      const numero = contador;
      contador += 1;

      if (!guion) {
        respuesta.writeHead(500, { "content-type": "application/json" });
        respuesta.end(JSON.stringify({ error: { message: "Sin guion" } }));
        return;
      }
      if (guion.estado && guion.estado >= 400) {
        respuesta.writeHead(guion.estado, { "content-type": "application/json" });
        respuesta.end(JSON.stringify({ error: { message: "Fallo del proveedor" } }));
        return;
      }

      const mensaje: Record<string, unknown> = {
        role: "assistant",
        content: guion.contenido ?? null,
      };
      if (guion.llamadas) {
        mensaje.tool_calls = guion.llamadas.map((llamada, indice) => ({
          id: `llamada-${numero}-${indice}`,
          type: "function",
          function: {
            name: llamada.nombre,
            arguments:
              typeof llamada.argumentos === "string"
                ? llamada.argumentos
                : JSON.stringify(llamada.argumentos),
          },
        }));
      }
      respuesta.writeHead(200, { "content-type": "application/json" });
      respuesta.end(JSON.stringify({ choices: [{ message: mensaje }] }));
    });
  });

  return new Promise((resolver, rechazar) => {
    server.on("error", rechazar);
    server.listen(0, "127.0.0.1", () => {
      const direccion = server.address();
      const puerto = typeof direccion === "object" && direccion ? direccion.port : 0;
      resolver({
        baseUrl: `http://127.0.0.1:${puerto}`,
        peticiones,
        cerrar: () =>
          new Promise<void>((listo) => {
            server.closeAllConnections();
            server.close(() => listo());
          }),
      });
    });
  });
}

function mensajesDe(peticion: PeticionFalsa): Array<Record<string, unknown>> {
  const mensajes = peticion.cuerpo.messages;
  return Array.isArray(mensajes) ? (mensajes as Array<Record<string, unknown>>) : [];
}

function obtenerCookie(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0]! : bruto;
  const coincidencia = String(valor ?? "").match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

describe("chat del asistente con herramientas", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await client.close();
  });

  async function crearApp(opciones: OpcionesApp = {}): Promise<FastifyInstance> {
    const app = await buildApp(db as unknown as Database, {
      limiteAuth: { max: 100000, ventanaMs: 60 * 60 * 1000, maxPorCorreo: 100000 },
      ...opciones,
      asistente: opciones.asistente ?? OPCIONES_CHAT,
    });
    await app.ready();
    apps.push(app);
    return app;
  }

  async function registrar(app: FastifyInstance, sufijo: string): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: `chat-${sufijo}@example.com`,
        nombre: sufijo,
        contrasena: "contrasena-muy-larga",
      },
    });
    return obtenerCookie(respuesta);
  }

  async function configurar(app: FastifyInstance, cookie: string, baseUrl: string): Promise<void> {
    const respuesta = await app.inject({
      method: "PUT",
      url: "/asistente/config",
      headers: { cookie: `sesion=${cookie}` },
      payload: {
        preset: "personalizado",
        baseUrl,
        modelo: "modelo-falso",
        razonamiento: null,
        clave: CLAVE_PROVEEDOR,
      },
    });
    expect(respuesta.statusCode).toBe(200);
  }

  function chatear(
    app: FastifyInstance,
    cookie: string,
    mensajes: Array<{ rol: string; texto: string }>,
    zona?: string,
  ) {
    return app.inject({
      method: "POST",
      url: "/asistente/chat",
      headers: { cookie: `sesion=${cookie}` },
      payload: { mensajes, ...(zona ? { zona } : {}) },
    });
  }

  async function crearProyecto(
    app: FastifyInstance,
    cookie: string,
    nombre: string,
  ): Promise<{ id: string; nombre: string }> {
    const respuesta = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre },
    });
    expect(respuesta.statusCode).toBe(201);
    return respuesta.json() as { id: string; nombre: string };
  }

  async function columnas(app: FastifyInstance, cookie: string, proyectoId: string) {
    const respuesta = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/columnas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(respuesta.statusCode).toBe(200);
    return respuesta.json() as Array<{ id: string; nombre: string }>;
  }

  it("crea una tarea con fecha relativa usando las rutas existentes", async () => {
    const app = await crearApp();
    const cookie = await registrar(app, "crear-tarea");
    const proyecto = await crearProyecto(app, cookie, "Casa");
    const vence = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

    const proveedor = await crearProveedorFalso([
      {
        llamadas: [
          {
            nombre: "crear_tarea",
            argumentos: {
              proyectoId: proyecto.id,
              titulo: "Pagar la luz",
              venceEn: vence.toISOString(),
              checklist: ["Buscar la factura"],
            },
          },
        ],
      },
      { contenido: "He creado la tarea con su fecha." },
    ]);
    try {
      await configurar(app, cookie, proveedor.baseUrl);
      const chat = await chatear(app, cookie, [
        { rol: "user", texto: "Recuérdame pagar la luz pasado mañana" },
      ]);

      expect(chat.statusCode).toBe(200);
      const cuerpo = chat.json() as {
        mensaje: string;
        acciones: Array<{ herramienta: string; resumen: string; enlace?: string }>;
      };
      expect(cuerpo.mensaje).toBe("He creado la tarea con su fecha.");
      expect(cuerpo.acciones).toHaveLength(1);
      expect(cuerpo.acciones[0]).toMatchObject({ herramienta: "crear_tarea" });
      expect(cuerpo.acciones[0]!.resumen).toContain("Pagar la luz");
      expect(cuerpo.acciones[0]!.enlace).toMatch(/^\/proyectos\/.+\/tareas\/.+$/);
      expect(chat.body).not.toContain(CLAVE_PROVEEDOR);

      const [fila] = await db.select().from(tareas).where(eq(tareas.titulo, "Pagar la luz"));
      expect(fila).toBeDefined();
      expect(fila!.venceEn?.getTime()).toBe(vence.getTime());
      expect(fila!.proyectoId).toBe(proyecto.id);

      const primera = proveedor.peticiones[0]!;
      expect(primera.autorizacion).toBe(`Bearer ${CLAVE_PROVEEDOR}`);
      const sistema = mensajesDe(primera)[0]!;
      expect(String(sistema.content)).toContain("Casa");
      expect(String(sistema.content)).toContain("DATOS");
      expect(primera.cuerpo.tools).toBeDefined();
    } finally {
      await proveedor.cerrar();
    }
  });

  it("mueve una tarea de columna", async () => {
    const app = await crearApp();
    const cookie = await registrar(app, "mover");
    const proyecto = await crearProyecto(app, cookie, "Obra");
    const cols = await columnas(app, cookie, proyecto.id);

    const creada = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { titulo: "Comprar pintura", columnaId: cols[0]!.id },
    });
    const tarea = creada.json() as { id: string };
    const destino = cols[cols.length - 1]!;

    const proveedor = await crearProveedorFalso([
      {
        llamadas: [
          { nombre: "mover_tarea", argumentos: { tareaId: tarea.id, columnaId: destino.id } },
        ],
      },
      { contenido: "Movida de columna." },
    ]);
    try {
      await configurar(app, cookie, proveedor.baseUrl);
      const chat = await chatear(app, cookie, [
        { rol: "user", texto: "Pasa «Comprar pintura» a Hecha" },
      ]);
      expect(chat.statusCode).toBe(200);
      const cuerpo = chat.json() as {
        acciones: Array<{ herramienta: string; resumen: string }>;
      };
      expect(cuerpo.acciones[0]).toMatchObject({ herramienta: "mover_tarea" });
      expect(cuerpo.acciones[0]!.resumen).toContain(destino.nombre);

      const [fila] = await db.select().from(tareas).where(eq(tareas.id, tarea.id));
      expect(fila!.columnaId).toBe(destino.id);
    } finally {
      await proveedor.cerrar();
    }
  });

  it("aísla a los usuarios: un id ajeno falla en la ruta y no cambia nada", async () => {
    const app = await crearApp();
    const cookieA = await registrar(app, "alice-chat");
    const proyectoA = await crearProyecto(app, cookieA, "Secreto");
    const creada = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoA.id}/tareas`,
      headers: { cookie: `sesion=${cookieA}` },
      payload: { titulo: "No tocar" },
    });
    const tareaA = creada.json() as { id: string };

    const proveedor = await crearProveedorFalso([
      {
        llamadas: [
          {
            nombre: "actualizar_tarea",
            argumentos: { tareaId: tareaA.id, campos: { titulo: "Hackeada" } },
          },
        ],
      },
      { contenido: "No he podido cambiar esa tarea." },
    ]);
    try {
      const cookieB = await registrar(app, "bob-chat");
      await configurar(app, cookieB, proveedor.baseUrl);

      const chat = await chatear(app, cookieB, [
        { rol: "user", texto: "Cambia el título de esa tarea" },
      ]);
      expect(chat.statusCode).toBe(200);
      expect((chat.json() as { acciones: unknown[] }).acciones).toHaveLength(0);

      const [fila] = await db.select().from(tareas).where(eq(tareas.id, tareaA.id));
      expect(fila!.titulo).toBe("No tocar");

      const resultado = mensajesDe(proveedor.peticiones[1]!).find(
        (mensaje) => mensaje.role === "tool",
      );
      expect(String(resultado?.content)).toContain("Tarea no encontrada");
    } finally {
      await proveedor.cerrar();
    }
  });

  it("corta al alcanzar el tope de vueltas y avisa", async () => {
    const proveedor = await crearProveedorFalso([
      { llamadas: [{ nombre: "listar_proyectos", argumentos: {} }] },
      { llamadas: [{ nombre: "listar_proyectos", argumentos: {} }] },
      { llamadas: [{ nombre: "listar_proyectos", argumentos: {} }] },
    ]);
    try {
      const app = await crearApp({
        asistente: {
          ...OPCIONES_CHAT,
          chat: { ...OPCIONES_CHAT!.chat!, maxVueltas: 2 },
        },
      });
      const cookie = await registrar(app, "vueltas");
      await configurar(app, cookie, proveedor.baseUrl);

      const chat = await chatear(app, cookie, [{ rol: "user", texto: "Lista todo" }]);
      expect(chat.statusCode).toBe(200);
      expect((chat.json() as { mensaje: string }).mensaje).toContain("límite");
      expect(proveedor.peticiones).toHaveLength(2);
    } finally {
      await proveedor.cerrar();
    }
  });

  it("devuelve 502 con el proveedor caído y sin filtrar la clave", async () => {
    const proveedor = await crearProveedorFalso([{ estado: 500 }]);
    try {
      const app = await crearApp();
      const cookie = await registrar(app, "caido");
      await configurar(app, cookie, proveedor.baseUrl);

      const chat = await chatear(app, cookie, [{ rol: "user", texto: "Hola" }]);
      expect(chat.statusCode).toBe(502);
      expect((chat.json() as { mensaje: string }).mensaje).toBe(
        "El proveedor no responde en este momento.",
      );
      expect(chat.body).not.toContain(CLAVE_PROVEEDOR);
    } finally {
      await proveedor.cerrar();
    }
  });

  it("devuelve 409 con configurar:true si el usuario no ha configurado el asistente", async () => {
    const app = await crearApp();
    const cookie = await registrar(app, "sin-config");
    const chat = await chatear(app, cookie, [{ rol: "user", texto: "Hola" }]);
    expect(chat.statusCode).toBe(409);
    expect(chat.json()).toMatchObject({ configurar: true });
  });

  it("maneja herramientas desconocidas y argumentos JSON inválidos", async () => {
    const proveedor = await crearProveedorFalso([
      {
        llamadas: [
          { nombre: "borrar_todo", argumentos: {} },
          { nombre: "crear_tarea", argumentos: "{esto no es json" },
        ],
      },
      { contenido: "Listo." },
    ]);
    try {
      const app = await crearApp();
      const cookie = await registrar(app, "invalidos");
      await configurar(app, cookie, proveedor.baseUrl);

      const chat = await chatear(app, cookie, [{ rol: "user", texto: "Haz algo raro" }]);
      expect(chat.statusCode).toBe(200);
      expect((chat.json() as { acciones: unknown[] }).acciones).toHaveLength(0);

      const resultados = mensajesDe(proveedor.peticiones[1]!).filter(
        (mensaje) => mensaje.role === "tool",
      );
      const contenidos = resultados.map((mensaje) => String(mensaje.content)).join("\n");
      expect(contenidos).toContain("Herramienta desconocida");
      expect(contenidos).toContain("no son JSON válido");
    } finally {
      await proveedor.cerrar();
    }
  });
});
