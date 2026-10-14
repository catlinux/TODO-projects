import { createHash, randomBytes } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";
import { type FastifyInstance, type FastifyReply } from "fastify";
import { eq } from "drizzle-orm";

import { esquemaLogin, esquemaRegistro } from "@todo/shared";

import { sesiones, usuarios } from "./db/schema.js";
import type { Database } from "./db/index.js";

const UNA_SEMANA_SEGUNDOS = 7 * 24 * 60 * 60;
const UNA_SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

let hashFicticioPromesa: Promise<string> | undefined;
function obtenerHashFicticio(): Promise<string> {
  hashFicticioPromesa ??= hash("contraseña-ficticia-para-igualar-tiempos");
  return hashFicticioPromesa;
}

function generarToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function crearSesion(db: Database, usuarioId: string, reply: FastifyReply): Promise<void> {
  const token = generarToken();
  const tokenHash = hashToken(token);
  const expiraEn = new Date(Date.now() + UNA_SEMANA_MS);

  await db.insert(sesiones).values({
    usuarioId,
    tokenHash,
    expiraEn,
  });

  reply.setCookie("sesion", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: UNA_SEMANA_SEGUNDOS,
  });
}

export async function obtenerSesion(db: Database, token: string | undefined) {
  if (!token) {
    return null;
  }

  const filas = await db
    .select({ sesion: sesiones, usuario: usuarios })
    .from(sesiones)
    .innerJoin(usuarios, eq(sesiones.usuarioId, usuarios.id))
    .where(eq(sesiones.tokenHash, hashToken(token)));

  const fila = filas[0];
  if (!fila) {
    return null;
  }

  if (fila.sesion.expiraEn <= new Date()) {
    await db.delete(sesiones).where(eq(sesiones.id, fila.sesion.id));
    return null;
  }

  return fila;
}

export function registrarRutasAuth(app: FastifyInstance, db: Database): void {
  app.post("/auth/registro", async (request, reply) => {
    const resultado = esquemaRegistro.safeParse(request.body);
    if (!resultado.success) {
      reply.code(400).send({ mensaje: "Datos de registro no válidos" });
      return;
    }

    const { email, nombre, contrasena } = resultado.data;

    const existente = await db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.email, email))
      .limit(1);

    if (existente.length > 0) {
      reply.code(409).send({ mensaje: "El correo ya está registrado" });
      return;
    }

    const passwordHash = await hash(contrasena);
    const [usuario] = await db.insert(usuarios).values({ email, nombre, passwordHash }).returning();

    if (!usuario) {
      reply.code(500).send({ mensaje: "No se pudo crear el usuario" });
      return;
    }

    await crearSesion(db, usuario.id, reply);
    reply.code(201).send({
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
    });
  });

  app.post("/auth/login", async (request, reply) => {
    const resultado = esquemaLogin.safeParse(request.body);
    if (!resultado.success) {
      reply.code(400).send({ mensaje: "Datos de inicio de sesión no válidos" });
      return;
    }

    const { email, contrasena } = resultado.data;

    const [usuario] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);

    const hashAComparar = usuario?.passwordHash ?? (await obtenerHashFicticio());

    let esValida = false;
    try {
      esValida = await verify(hashAComparar, contrasena);
    } catch {
      esValida = false;
    }

    if (!usuario || !esValida) {
      reply.code(401).send({ mensaje: "Credenciales inválidas" });
      return;
    }

    await crearSesion(db, usuario.id, reply);
    reply.code(200).send({
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
    });
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies.sesion;
    if (token) {
      await db.delete(sesiones).where(eq(sesiones.tokenHash, hashToken(token)));
    }
    reply.clearCookie("sesion", { path: "/" });
    reply.code(204).send();
  });

  app.get("/auth/yo", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }
    reply.code(200).send({
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
    });
  });
}

declare module "fastify" {
  interface FastifyRequest {
    usuario: typeof usuarios.$inferSelect | null;
  }

  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}
