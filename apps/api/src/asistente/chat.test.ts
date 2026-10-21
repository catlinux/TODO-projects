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
import { VERSION } from "../version.js";

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
  /** Texto del error que devuelve el proveedor falso. */
  error?: string;
  /** `finish_reason` del proveedor; por defecto «stop». */
  finalizacion?: string;
  /** Retraso antes de responder, para probar el agotamiento del tiempo. */
  retrasoMs?: number;
  llamadas?: GuionLlamada[];
}

interface PeticionFalsa {
  autorizacion: string;
  agenteUsuario: string;
  sesion: string | null;
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
        agenteUsuario: String(peticion.headers["user-agent"] ?? ""),
        sesion:
          typeof peticion.headers["x-opencode-session"] === "string"
            ? peticion.headers["x-opencode-session"]
            : null,
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

      const responder = () => {
        if (guion.estado && guion.estado >= 400) {
          respuesta.writeHead(guion.estado, { "content-type": "application/json" });
          respuesta.end(JSON.stringify({ error: { message: guion.error ?? "Fallo del proveedor" } }));
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
        respuesta.end(
          JSON.stringify({
            choices: [{ message: mensaje, finish_reason: guion.finalizacion ?? "stop" }],
          }),
        );
      };

      if (guion.retrasoMs) {
        setTimeout(responder, guion.retrasoMs);
      } else {
        responder();
      }
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

  async function crearApp(
    opciones: OpcionesApp = {},
    antesDeListo?: (app: FastifyInstance) => void,
  ): Promise<FastifyInstance> {
    const app = await buildApp(db as unknown as Database, {
      limiteAuth: { max: 100000, ventanaMs: 60 * 60 * 1000, maxPorCorreo: 100000 },
      ...opciones,
      asistente: opciones.asistente ?? OPCIONES_CHAT,
    });
    antesDeListo?.(app);
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

  async function configurar(
    app: FastifyInstance,
    cookie: string,
    baseUrl: string,
    preset = "personalizado",
  ): Promise<void> {
    const respuesta = await app.inject({
      method: "PUT",
      url: "/asistente/config",
      headers: { cookie: `sesion=${cookie}` },
      payload: {
        preset,
        baseUrl,
        ...(preset === "personalizado"
          ? { modelo: "modelo-falso", razonamiento: null }
          : {}),
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
    conversacionId?: string,
  ) {
    return app.inject({
      method: "POST",
      url: "/asistente/chat",
      headers: { cookie: `sesion=${cookie}` },
      payload: { mensajes, ...(zona ? { zona } : {}), ...(conversacionId ? { conversacionId } : {}) },
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
      expect(primera.agenteUsuario).toBe(`TODO-projects-asistente/${VERSION}`);
      expect(primera.sesion).toBeNull();
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

  it("añade elementos al checklist con textos sueltos u objetos con descripción", async () => {
    const app = await crearApp();
    const cookie = await registrar(app, "checklist");
    const proyecto = await crearProyecto(app, cookie, "Viaje");
    const cols = await columnas(app, cookie, proyecto.id);

    const creada = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { titulo: "Preparar el viaje", columnaId: cols[0]!.id },
    });
    const tarea = creada.json() as { id: string };

    const proveedor = await crearProveedorFalso([
      {
        llamadas: [
          {
            nombre: "anadir_checklist",
            argumentos: {
              tareaId: tarea.id,
              textos: [
                "Pasaporte",
                { texto: "Maleta", descripcion: "Ropa para tres días y el cargador." },
              ],
            },
          },
        ],
      },
      { contenido: "Añadidos los elementos." },
    ]);
    try {
      await configurar(app, cookie, proveedor.baseUrl);
      const chat = await chatear(app, cookie, [
        { rol: "user", texto: "Prepara el checklist del viaje" },
      ]);
      expect(chat.statusCode).toBe(200);
      const cuerpo = chat.json() as {
        acciones: Array<{ herramienta: string; resumen: string }>;
      };
      expect(cuerpo.acciones[0]).toMatchObject({ herramienta: "anadir_checklist" });
      expect(cuerpo.acciones[0]!.resumen).toContain("2");

      const lista = await app.inject({
        method: "GET",
        url: `/tareas/${tarea.id}/checklist`,
        headers: { cookie: `sesion=${cookie}` },
      });
      expect(lista.statusCode).toBe(200);
      expect(lista.json()).toMatchObject([
        { texto: "Pasaporte", descripcion: null },
        { texto: "Maleta", descripcion: "Ropa para tres días y el cargador." },
      ]);
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

  it("traduce el error de contexto excedido del proveedor", async () => {
    const proveedor = await crearProveedorFalso([
      {
        estado: 400,
        error:
          "This model's maximum context length is 65536 tokens. However, you requested 90000 tokens.",
      },
    ]);
    try {
      const app = await crearApp();
      const cookie = await registrar(app, "contexto");
      await configurar(app, cookie, proveedor.baseUrl);

      const chat = await chatear(app, cookie, [{ rol: "user", texto: "Analiza esto" }]);
      expect(chat.statusCode).toBe(502);
      expect((chat.json() as { mensaje: string }).mensaje).toBe(
        "El texto es demasiado largo para el modelo; adjunta un fragmento más corto.",
      );
    } finally {
      await proveedor.cerrar();
    }
  });

  it("usa una sesión estable de OpenCode Go durante la conversación", async () => {
    const proveedor = await crearProveedorFalso([
      { llamadas: [{ nombre: "listar_proyectos", argumentos: {} }] },
      { contenido: "Listo." },
      { contenido: "Otra vez." },
    ]);
    try {
      const app = await crearApp();
      const cookie = await registrar(app, "opencode-go");
      await configurar(app, cookie, proveedor.baseUrl, "opencode-go");

      const conversacionId = "00000000-0000-4000-8000-000000000123";
      const primera = await chatear(
        app,
        cookie,
        [{ rol: "user", texto: "Lista mis proyectos" }],
        undefined,
        conversacionId,
      );
      expect(primera.statusCode).toBe(200);
      const segunda = await chatear(
        app,
        cookie,
        [{ rol: "user", texto: "Y otra vez" }],
        undefined,
        conversacionId,
      );
      expect(segunda.statusCode).toBe(200);

      expect(proveedor.peticiones).toHaveLength(3);
      for (const peticion of proveedor.peticiones) {
        expect(peticion.agenteUsuario).toBe(`TODO-projects-asistente/${VERSION}`);
        expect(peticion.sesion).toBe(conversacionId);
      }
    } finally {
      await proveedor.cerrar();
    }
  });

  it("crea en la Bandeja de entrada la tarea sin proyecto y con su fecha", async () => {
    const app = await crearApp();
    const cookie = await registrar(app, "bandeja-tarea");
    const vence = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const proveedor = await crearProveedorFalso([
      { llamadas: [{ nombre: "listar_proyectos", argumentos: {} }] },
      {
        llamadas: [
          {
            nombre: "crear_tarea",
            argumentos: { titulo: "Llamar al banco", venceEn: vence.toISOString() },
          },
        ],
      },
      { contenido: "La he dejado en tu Bandeja de entrada." },
    ]);
    try {
      await configurar(app, cookie, proveedor.baseUrl);
      const chat = await chatear(app, cookie, [
        { rol: "user", texto: "Crea una tarea para llamar al banco mañana" },
      ]);

      expect(chat.statusCode).toBe(200);
      const cuerpo = chat.json() as {
        mensaje: string;
        acciones: Array<{ resumen: string; enlace?: string }>;
      };
      expect(cuerpo.mensaje).toContain("Bandeja");
      expect(cuerpo.acciones[0]!.resumen).toContain("Bandeja de entrada");
      expect(cuerpo.acciones[0]!.enlace).toMatch(/^\/proyectos\/.+\/tareas\/.+$/);

      const bandeja = await app.inject({
        method: "GET",
        url: "/bandeja",
        headers: { cookie: `sesion=${cookie}` },
      });
      const datosBandeja = bandeja.json() as {
        proyecto: { id: string };
        columnas: Array<{ id: string }>;
        tareas: Array<{ id: string }>;
      };

      const [fila] = await db
        .select()
        .from(tareas)
        .where(eq(tareas.titulo, "Llamar al banco"));
      expect(fila).toBeDefined();
      expect(fila!.venceEn?.getTime()).toBe(vence.getTime());
      expect(fila!.proyectoId).toBe(datosBandeja.proyecto.id);
      expect(fila!.columnaId).toBe(datosBandeja.columnas[0]!.id);
      expect(datosBandeja.tareas.some((tarea) => tarea.id === fila!.id)).toBe(true);

      const sistema = String(mensajesDe(proveedor.peticiones[0]!)[0]!.content);
      expect(sistema).toContain("Bandeja de entrada");
      expect(sistema).toContain("Entrada");
      expect(sistema).toContain(datosBandeja.proyecto.id);

      // listar_proyectos también devuelve la bandeja, marcada como tal.
      const listado = mensajesDe(proveedor.peticiones[1]!).find(
        (mensaje) => mensaje.role === "tool",
      );
      expect(String(listado?.content)).toContain(datosBandeja.proyecto.id);
      expect(String(listado?.content)).toContain('"esBandeja":true');
    } finally {
      await proveedor.cerrar();
    }
  });

  it("respeta el proyecto explícito en vez de usar la Bandeja", async () => {
    const app = await crearApp();
    const cookie = await registrar(app, "proyecto-explicito");
    const proyecto = await crearProyecto(app, cookie, "Casa");

    const proveedor = await crearProveedorFalso([
      {
        llamadas: [
          {
            nombre: "crear_tarea",
            argumentos: { proyectoId: proyecto.id, titulo: "Renovar el seguro" },
          },
        ],
      },
      { contenido: "Creada en Casa." },
    ]);
    try {
      await configurar(app, cookie, proveedor.baseUrl);
      const chat = await chatear(app, cookie, [
        { rol: "user", texto: "Crea una tarea en Casa para renovar el seguro" },
      ]);
      expect(chat.statusCode).toBe(200);

      const [fila] = await db
        .select()
        .from(tareas)
        .where(eq(tareas.titulo, "Renovar el seguro"));
      expect(fila!.proyectoId).toBe(proyecto.id);

      const bandeja = await app.inject({
        method: "GET",
        url: "/bandeja",
        headers: { cookie: `sesion=${cookie}` },
      });
      const datosBandeja = bandeja.json() as { tareas: Array<{ id: string }> };
      expect(datosBandeja.tareas.some((tarea) => tarea.id === fila!.id)).toBe(false);
    } finally {
      await proveedor.cerrar();
    }
  });

  it("sigue funcionando si GET /bandeja falla", async () => {
    const app = await crearApp({}, (servidor) => {
      servidor.addHook("onRequest", async (request, reply) => {
        if (request.url.startsWith("/bandeja")) {
          reply.code(500).send({ mensaje: "La bandeja no está disponible" });
        }
      });
    });
    const cookie = await registrar(app, "sin-bandeja");
    await crearProyecto(app, cookie, "Trabajo");

    const proveedor = await crearProveedorFalso([
      { llamadas: [{ nombre: "listar_proyectos", argumentos: {} }] },
      { contenido: "Puedo ayudarte con Trabajo." },
    ]);
    try {
      await configurar(app, cookie, proveedor.baseUrl);
      const chat = await chatear(app, cookie, [
        { rol: "user", texto: "¿Qué proyectos tengo?" },
      ]);
      expect(chat.statusCode).toBe(200);
      expect((chat.json() as { mensaje: string }).mensaje).toContain("Trabajo");

      const sistema = String(mensajesDe(proveedor.peticiones[0]!)[0]!.content);
      expect(sistema).toContain("Trabajo");
      expect(sistema).not.toContain("[BANDEJA DE ENTRADA");
    } finally {
      await proveedor.cerrar();
    }
  });

  it("admite un mensaje de 100 000 caracteres", async () => {
    const proveedor = await crearProveedorFalso([{ contenido: "Recibido." }]);
    try {
      const app = await crearApp();
      const cookie = await registrar(app, "largo");
      await configurar(app, cookie, proveedor.baseUrl);

      const chat = await chatear(app, cookie, [{ rol: "user", texto: "a".repeat(100_000) }]);
      expect(chat.statusCode).toBe(200);
      expect((chat.json() as { mensaje: string }).mensaje).toBe("Recibido.");
      expect(proveedor.peticiones).toHaveLength(1);
    } finally {
      await proveedor.cerrar();
    }
  });

  it("rechaza un mensaje de 130 000 caracteres con un mensaje claro", async () => {
    const app = await crearApp();
    const cookie = await registrar(app, "demasiado-largo");

    const chat = await chatear(app, cookie, [{ rol: "user", texto: "a".repeat(130_000) }]);
    expect(chat.statusCode).toBe(400);
    expect((chat.json() as { mensaje: string }).mensaje).toContain("demasiado largo");
    expect((chat.json() as { mensaje: string }).mensaje).toContain("120000");
  });

  it("rechaza una suma de 300 000 caracteres entre mensajes", async () => {
    const app = await crearApp();
    const cookie = await registrar(app, "suma-larga");

    const chat = await chatear(app, cookie, [
      { rol: "user", texto: "a".repeat(120_000) },
      { rol: "assistant", texto: "b".repeat(120_000) },
      { rol: "user", texto: "c".repeat(60_000) },
    ]);
    expect(chat.statusCode).toBe(400);
    expect((chat.json() as { mensaje: string }).mensaje).toContain("250000");
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

  it("continúa automáticamente cuando el texto se corta por longitud", async () => {
    const proveedor = await crearProveedorFalso([
      { contenido: "Parte uno. ", finalizacion: "length" },
      { contenido: "Parte dos.", finalizacion: "stop" },
    ]);
    try {
      const app = await crearApp();
      const cookie = await registrar(app, "continuacion");
      await configurar(app, cookie, proveedor.baseUrl);

      const chat = await chatear(app, cookie, [{ rol: "user", texto: "Escríbeme un manual" }]);
      expect(chat.statusCode).toBe(200);
      expect((chat.json() as { mensaje: string }).mensaje).toBe("Parte uno. Parte dos.");
      expect(proveedor.peticiones).toHaveLength(2);

      const segunda = mensajesDe(proveedor.peticiones[1]!);
      expect(segunda.at(-2)).toMatchObject({ role: "assistant", content: "Parte uno. " });
      expect(segunda.at(-1)).toMatchObject({
        role: "user",
        content: "Continúa exactamente donde lo dejaste, sin repetir nada.",
      });
      // Los mensajes internos de continuación no llegan al cliente.
      expect(chat.body).not.toContain("Continúa exactamente");
    } finally {
      await proveedor.cerrar();
    }
  });

  it("avisa cuando se agotan las continuaciones por longitud", async () => {
    const guiones: Guion[] = Array.from({ length: 7 }, (_, indice) => ({
      contenido: `parte-${indice} `,
      finalizacion: "length",
    }));
    const proveedor = await crearProveedorFalso(guiones);
    try {
      const app = await crearApp();
      const cookie = await registrar(app, "tope-continuaciones");
      await configurar(app, cookie, proveedor.baseUrl);

      const chat = await chatear(app, cookie, [{ rol: "user", texto: "Manual completo" }]);
      expect(chat.statusCode).toBe(200);
      const mensaje = (chat.json() as { mensaje: string }).mensaje;
      expect(mensaje).toContain("parte-6");
      expect(mensaje).toContain(
        "(La respuesta se ha cortado por longitud; pídeme que continúe.)",
      );
      expect(proveedor.peticiones).toHaveLength(7);
    } finally {
      await proveedor.cerrar();
    }
  });

  it("no ejecuta herramientas con argumentos cortados y pide pasos más pequeños", async () => {
    const proveedor = await crearProveedorFalso([
      {
        llamadas: [{ nombre: "crear_tarea", argumentos: { titulo: "No debe crearse" } }],
        finalizacion: "length",
      },
      { contenido: "Lo haré en pasos más pequeños." },
    ]);
    try {
      const app = await crearApp();
      const cookie = await registrar(app, "tool-cortada");
      await configurar(app, cookie, proveedor.baseUrl);

      const chat = await chatear(app, cookie, [{ rol: "user", texto: "Crea la tarea" }]);
      expect(chat.statusCode).toBe(200);
      expect((chat.json() as { mensaje: string }).mensaje).toBe("Lo haré en pasos más pequeños.");
      expect((chat.json() as { acciones: unknown[] }).acciones).toHaveLength(0);

      const filas = await db
        .select()
        .from(tareas)
        .where(eq(tareas.titulo, "No debe crearse"));
      expect(filas).toHaveLength(0);

      const segunda = mensajesDe(proveedor.peticiones[1]!);
      expect(segunda.at(-1)).toMatchObject({
        role: "user",
        content:
          "La llamada anterior se ha cortado por longitud. Vuelve a intentarlo en pasos más pequeños, con argumentos más cortos.",
      });
    } finally {
      await proveedor.cerrar();
    }
  });

  it("devuelve un error claro si las herramientas se cortan otra vez", async () => {
    const guion = {
      llamadas: [{ nombre: "listar_proyectos", argumentos: {} }],
      finalizacion: "length",
    } satisfies Guion;
    const proveedor = await crearProveedorFalso([guion, { ...guion }]);
    try {
      const app = await crearApp();
      const cookie = await registrar(app, "tool-cortada-dos");
      await configurar(app, cookie, proveedor.baseUrl);

      const chat = await chatear(app, cookie, [{ rol: "user", texto: "Lista todo" }]);
      expect(chat.statusCode).toBe(502);
      expect((chat.json() as { mensaje: string }).mensaje).toContain("longitud");
      expect(proveedor.peticiones).toHaveLength(2);
    } finally {
      await proveedor.cerrar();
    }
  });

  it("devuelve el texto ya generado si se agota el tiempo total", async () => {
    const proveedor = await crearProveedorFalso([
      { contenido: "Primera parte.", finalizacion: "length" },
      { contenido: "Segunda parte.", finalizacion: "stop", retrasoMs: 500 },
    ]);
    try {
      const app = await crearApp({
        asistente: {
          ...OPCIONES_CHAT,
          chat: { ...OPCIONES_CHAT!.chat!, tiempoMaximoMs: 100 },
        },
      });
      const cookie = await registrar(app, "tiempo-agotado");
      await configurar(app, cookie, proveedor.baseUrl);

      const chat = await chatear(app, cookie, [{ rol: "user", texto: "Manual largo" }]);
      expect(chat.statusCode).toBe(200);
      const mensaje = (chat.json() as { mensaje: string }).mensaje;
      expect(mensaje).toContain("Primera parte.");
      expect(mensaje).toContain("(La respuesta se ha cortado por tiempo; pídeme que continúe.)");
    } finally {
      await proveedor.cerrar();
    }
  });

  it("reintenta con 4096 tokens si el proveedor rechaza el máximo pedido", async () => {
    const proveedor = await crearProveedorFalso([
      {
        estado: 400,
        error: "max_tokens is too large: 8000. This model supports at most 4096 tokens.",
      },
      { contenido: "Listo." },
    ]);
    try {
      const app = await crearApp({
        asistente: {
          ...OPCIONES_CHAT,
          chat: { ...OPCIONES_CHAT!.chat!, maxTokens: 8000 },
        },
      });
      const cookie = await registrar(app, "max-tokens");
      await configurar(app, cookie, proveedor.baseUrl);

      const chat = await chatear(app, cookie, [{ rol: "user", texto: "Hola" }]);
      expect(chat.statusCode).toBe(200);
      expect((chat.json() as { mensaje: string }).mensaje).toBe("Listo.");
      expect(proveedor.peticiones).toHaveLength(2);
      expect(proveedor.peticiones[0]!.cuerpo.max_tokens).toBe(8000);
      expect(proveedor.peticiones[1]!.cuerpo.max_tokens).toBe(4096);
    } finally {
      await proveedor.cerrar();
    }
  });
});
