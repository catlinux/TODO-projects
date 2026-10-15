import { createHash, randomBytes } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";
import { type FastifyInstance, type FastifyReply } from "fastify";
import { eq } from "drizzle-orm";

import { esquemaLogin, esquemaRegistro } from "@todo/shared";

import { sesiones, usuarios } from "./db/schema.js";
import type { Database } from "./db/index.js";

const UNA_SEMANA_SEGUNDOS = 7 * 24 * 60 * 60;
const UNA_SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

export const MENSAJE_DEMASIADOS_INTENTOS = "Demasiados intentos. Inténtalo de nuevo más tarde.";

export interface LimitesAuth {
  login: { max: number; ventanaMs: number };
  registro: { max: number; ventanaMs: number };
  maxPorCorreo: number;
}

interface EntradaFallos {
  fallos: number;
  expira: number;
}

interface LimitePorCorreo {
  segundosBloqueado(correo: string): number;
  registrarFallo(correo: string): number;
  reiniciar(correo: string): void;
}

function crearLimitePorCorreo(max: number, ventanaMs: number): LimitePorCorreo {
  const fallosPorCorreo = new Map<string, EntradaFallos>();

  function limpiarExpirados(ahora: number): void {
    for (const [correo, entrada] of fallosPorCorreo) {
      if (entrada.expira <= ahora) {
        fallosPorCorreo.delete(correo);
      }
    }
  }

  return {
    segundosBloqueado(correo: string): number {
      const ahora = Date.now();
      limpiarExpirados(ahora);
      const entrada = fallosPorCorreo.get(correo);
      if (!entrada || entrada.fallos < max) {
        return 0;
      }
      return Math.max(1, Math.ceil((entrada.expira - ahora) / 1000));
    },
    registrarFallo(correo: string): number {
      const ahora = Date.now();
      limpiarExpirados(ahora);
      const entrada = fallosPorCorreo.get(correo);
      const fallos = (entrada?.fallos ?? 0) + 1;
      const expira = ahora + ventanaMs;
      fallosPorCorreo.set(correo, { fallos, expira });
      return fallos >= max ? Math.max(1, Math.ceil(ventanaMs / 1000)) : 0;
    },
    reiniciar(correo: string): void {
      fallosPorCorreo.delete(correo);
    },
  };
}

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

export function registrarRutasAuth(app: FastifyInstance, db: Database, limites: LimitesAuth): void {
  const limitePorCorreo = crearLimitePorCorreo(limites.maxPorCorreo, limites.login.ventanaMs);

  app.post(
    "/auth/registro",
    {
      config: {
        rateLimit: { max: limites.registro.max, timeWindow: limites.registro.ventanaMs },
      },
    },
    async (request, reply) => {
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
      let usuario: typeof usuarios.$inferSelect | undefined;
      try {
        [usuario] = await db.insert(usuarios).values({ email, nombre, passwordHash }).returning();
      } catch (error) {
        // Dos registros simultáneos con el mismo correo: gana la restricción única.
        const causa = (error as { cause?: { code?: string } }).cause;
        if (causa?.code === "23505") {
          reply.code(409).send({ mensaje: "El correo ya está registrado" });
          return;
        }
        throw error;
      }

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
    },
  );

  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: { max: limites.login.max, timeWindow: limites.login.ventanaMs },
      },
    },
    async (request, reply) => {
      const resultado = esquemaLogin.safeParse(request.body);
      if (!resultado.success) {
        reply.code(400).send({ mensaje: "Datos de inicio de sesión no válidos" });
        return;
      }

      const { email, contrasena } = resultado.data;

      const espera = limitePorCorreo.segundosBloqueado(email);
      if (espera > 0) {
        reply
          .code(429)
          .header("Retry-After", espera)
          .send({ mensaje: MENSAJE_DEMASIADOS_INTENTOS });
        return;
      }

      const [usuario] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);

      const hashAComparar = usuario?.passwordHash ?? (await obtenerHashFicticio());

      let esValida = false;
      try {
        esValida = await verify(hashAComparar, contrasena);
      } catch {
        esValida = false;
      }

      if (!usuario || !esValida) {
        const esperaTrasFallo = limitePorCorreo.registrarFallo(email);
        if (esperaTrasFallo > 0) {
          reply
            .code(429)
            .header("Retry-After", esperaTrasFallo)
            .send({ mensaje: MENSAJE_DEMASIADOS_INTENTOS });
          return;
        }
        reply.code(401).send({ mensaje: "Credenciales inválidas" });
        return;
      }

      limitePorCorreo.reiniciar(email);
      await crearSesion(db, usuario.id, reply);
      reply.code(200).send({
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
      });
    },
  );

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
    permisoToken: "lectura" | "escritura" | "calendario" | null;
  }

  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}
