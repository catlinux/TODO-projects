import { createHash, randomBytes } from "node:crypto";

import { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { esquemaTokenApi, type PermisoToken } from "@todo/shared";

import { obtenerSesion } from "./auth.js";
import { tokensApi, usuarios } from "./db/schema.js";
import type { Database } from "./db/index.js";

const MAX_TOKENS_ACTIVOS = 20;
const MILISEGUNDOS_ACTUALIZACION_USO = 60 * 1000;

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

export function generarTokenApi(): string {
  return `tdp_${randomBytes(32).toString("base64url")}`;
}

export function hashTokenApi(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface TokenApiValido {
  id: string;
  permiso: PermisoToken;
  usuario: typeof usuarios.$inferSelect;
}

/** Busca un token por su hash y comprueba que sigue activo. */
export async function buscarTokenApi(db: Database, token: string): Promise<TokenApiValido | null> {
  const filas = await db
    .select({ token: tokensApi, usuario: usuarios })
    .from(tokensApi)
    .innerJoin(usuarios, eq(tokensApi.usuarioId, usuarios.id))
    .where(eq(tokensApi.tokenHash, hashTokenApi(token)));

  const fila = filas[0];
  if (!fila) {
    return null;
  }

  const ahora = new Date();
  if (fila.token.revocadoEn !== null) {
    return null;
  }
  if (fila.token.expiraEn !== null && fila.token.expiraEn <= ahora) {
    return null;
  }

  if (
    fila.token.ultimoUso === null ||
    ahora.getTime() - fila.token.ultimoUso.getTime() > MILISEGUNDOS_ACTUALIZACION_USO
  ) {
    await db.update(tokensApi).set({ ultimoUso: ahora }).where(eq(tokensApi.id, fila.token.id));
  }

  return { id: fila.token.id, permiso: fila.token.permiso as PermisoToken, usuario: fila.usuario };
}

export interface LimiteFallosTokens {
  segundosBloqueado(ip: string): number;
  registrarFallo(ip: string): number;
}

/** Cuenta los intentos con token inválido por IP; los vacía al expirar. */
export function crearLimiteFallosTokens(max: number, ventanaMs: number): LimiteFallosTokens {
  const fallosPorIp = new Map<string, { fallos: number; expira: number }>();

  function limpiar(ahora: number): void {
    for (const [ip, entrada] of fallosPorIp) {
      if (entrada.expira <= ahora) {
        fallosPorIp.delete(ip);
      }
    }
  }

  return {
    segundosBloqueado(ip: string): number {
      const ahora = Date.now();
      limpiar(ahora);
      const entrada = fallosPorIp.get(ip);
      if (!entrada || entrada.fallos < max) {
        return 0;
      }
      return Math.max(1, Math.ceil((entrada.expira - ahora) / 1000));
    },
    registrarFallo(ip: string): number {
      const ahora = Date.now();
      limpiar(ahora);
      const entrada = fallosPorIp.get(ip);
      const fallos = (entrada?.fallos ?? 0) + 1;
      fallosPorIp.set(ip, { fallos, expira: ahora + ventanaMs });
      return fallos >= max ? Math.max(1, Math.ceil(ventanaMs / 1000)) : 0;
    },
  };
}

async function usuarioPorCookie(db: Database, request: FastifyRequest) {
  const fila = await obtenerSesion(db, request.cookies.sesion);
  return fila?.usuario ?? null;
}

function rechazarSinSesion(reply: FastifyReply) {
  reply.code(403).send({ mensaje: "Esta acción requiere iniciar sesión en la web" });
}

export function registrarRutasTokens(app: FastifyInstance, db: Database): void {
  app.post("/tokens", async (request, reply) => {
    const usuario = await usuarioPorCookie(db, request);
    if (!usuario) {
      rechazarSinSesion(reply);
      return;
    }

    const cuerpo = esquemaTokenApi.safeParse(request.body);
    if (!cuerpo.success) {
      reply.code(400).send({ mensaje: "Datos de token no válidos" });
      return;
    }

    const { nombre, permiso, expiraEn } = cuerpo.data;
    const ahora = new Date();
    if (expiraEn !== null && expiraEn !== undefined && expiraEn <= ahora) {
      reply.code(400).send({ mensaje: "La fecha de caducidad debe ser futura" });
      return;
    }

    const activos = await db
      .select({ id: tokensApi.id })
      .from(tokensApi)
      .where(
        and(
          eq(tokensApi.usuarioId, usuario.id),
          isNull(tokensApi.revocadoEn),
          or(isNull(tokensApi.expiraEn), gt(tokensApi.expiraEn, ahora)),
        ),
      );

    if (activos.length >= MAX_TOKENS_ACTIVOS) {
      reply.code(409).send({ mensaje: "Has alcanzado el límite de tokens activos" });
      return;
    }

    const token = generarTokenApi();
    const [creado] = await db
      .insert(tokensApi)
      .values({
        usuarioId: usuario.id,
        nombre,
        tokenHash: hashTokenApi(token),
        prefijo: token.slice(0, 8),
        permiso,
        expiraEn: expiraEn ?? null,
      })
      .returning();

    if (!creado) {
      reply.code(500).send({ mensaje: "No se pudo crear el token" });
      return;
    }

    reply.code(201).send({
      id: creado.id,
      nombre: creado.nombre,
      permiso: creado.permiso,
      prefijo: creado.prefijo,
      expiraEn: creado.expiraEn,
      token,
    });
  });

  app.get("/tokens", async (request, reply) => {
    const usuario = await usuarioPorCookie(db, request);
    if (!usuario) {
      rechazarSinSesion(reply);
      return;
    }

    return db
      .select({
        id: tokensApi.id,
        nombre: tokensApi.nombre,
        permiso: tokensApi.permiso,
        prefijo: tokensApi.prefijo,
        ultimoUso: tokensApi.ultimoUso,
        expiraEn: tokensApi.expiraEn,
        revocadoEn: tokensApi.revocadoEn,
        createdAt: tokensApi.createdAt,
      })
      .from(tokensApi)
      .where(eq(tokensApi.usuarioId, usuario.id))
      .orderBy(desc(tokensApi.createdAt));
  });

  app.delete("/tokens/:id", async (request, reply) => {
    const usuario = await usuarioPorCookie(db, request);
    if (!usuario) {
      rechazarSinSesion(reply);
      return;
    }

    const params = esquemaId.safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ mensaje: "Identificador no válido" });
      return;
    }

    const [existente] = await db
      .select({ id: tokensApi.id })
      .from(tokensApi)
      .where(and(eq(tokensApi.id, params.data.id), eq(tokensApi.usuarioId, usuario.id)))
      .limit(1);

    if (!existente) {
      reply.code(404).send({ mensaje: "Token no encontrado" });
      return;
    }

    await db
      .update(tokensApi)
      .set({ revocadoEn: new Date() })
      .where(eq(tokensApi.id, params.data.id));

    reply.code(204).send();
  });
}
