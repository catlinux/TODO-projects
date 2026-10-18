// Acceso personal: PIN del propietario y passkeys (huella, cara o Windows Hello).
import { verify } from "@node-rs/argon2";
import { and, eq, isNotNull } from "drizzle-orm";
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import { esquemaPin } from "@todo/shared";

import {
  crearSesion,
  MENSAJE_DEMASIADOS_INTENTOS,
  obtenerHashFicticio,
  type LimitesAuth,
} from "./auth.js";
import type { Database } from "./db/index.js";
import { passkeys, usuarios } from "./db/schema.js";
import {
  ALGORITMOS,
  aBase64url,
  crearAlmacenRetos,
  ErrorWebAuthn,
  prepararEntrada,
  verificarRegistro,
  type ConfigWebAuthn,
  type RespuestaEntrada,
  type RespuestaRegistro,
} from "./webauthn.js";

const FALLOS_POR_TRAMO = 5;
const BLOQUEO_BASE_MS = 60 * 1000;
const BLOQUEO_MAX_MS = 24 * 60 * 60 * 1000;
const TIEMPO_CEREMONIA_MS = 2 * 60 * 1000;
/** Margen desde que se entra hasta que se puede añadir una passkey nueva. */
export const SESION_RECIENTE_MS = 10 * 60 * 1000;
const MENSAJE_REAUTENTICAR = "Vuelve a entrar para añadir un dispositivo";
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bloqueo global del PIN: cada FALLOS_POR_TRAMO fallos seguidos (de cualquier IP)
 * bloquea el PIN para todos 1, 2, 4… minutos, hasta 24 h. Complementa el límite por
 * IP, que no frena a un atacante con muchas IP frente a un PIN de pocos dígitos.
 */
export function crearBloqueoGlobal(
  fallosPorTramo = FALLOS_POR_TRAMO,
  baseMs = BLOQUEO_BASE_MS,
  maxMs = BLOQUEO_MAX_MS,
) {
  let fallos = 0;
  let tramos = 0;
  let hasta = 0;
  return {
    segundosBloqueado(): number {
      const resto = hasta - Date.now();
      return resto > 0 ? Math.ceil(resto / 1000) : 0;
    },
    registrarFallo(): number {
      fallos += 1;
      if (fallos % fallosPorTramo !== 0) return 0;
      tramos += 1;
      const duracion = Math.min(baseMs * 2 ** (tramos - 1), maxMs);
      hasta = Date.now() + duracion;
      return Math.ceil(duracion / 1000);
    },
    reiniciar(): void {
      fallos = 0;
      tramos = 0;
      hasta = 0;
    },
  };
}

export interface OpcionesAcceso {
  limites: LimitesAuth;
  accesoCorreo: boolean;
  registroAbierto: boolean;
  webauthn: ConfigWebAuthn | null;
  bloqueo?: ReturnType<typeof crearBloqueoGlobal>;
}

const esquemaNombreDispositivo = z.string().trim().min(1).max(100);

function demasiados(reply: FastifyReply, segundos: number): FastifyReply {
  return reply
    .code(429)
    .header("Retry-After", segundos)
    .send({ mensaje: MENSAJE_DEMASIADOS_INTENTOS });
}

function datosUsuario(usuario: typeof usuarios.$inferSelect) {
  return { id: usuario.id, email: usuario.email, nombre: usuario.nombre };
}

/**
 * Registrar una passkey con una cookie robada daría al atacante un acceso duradero;
 * por eso exigimos que la sesión sea reciente.
 */
function exigirSesionReciente(request: FastifyRequest, reply: FastifyReply): FastifyReply | null {
  const creadaEn = request.sesionCreadaEn;
  if (creadaEn && Date.now() - creadaEn.getTime() > SESION_RECIENTE_MS) {
    return reply.code(403).send({ mensaje: MENSAJE_REAUTENTICAR, codigo: "reautenticar" });
  }
  return null;
}

export function registrarRutasAcceso(
  app: FastifyInstance,
  db: Database,
  opciones: OpcionesAcceso,
): void {
  const { limites, webauthn } = opciones;
  const bloqueo = opciones.bloqueo ?? crearBloqueoGlobal();
  const retos = crearAlmacenRetos();
  const limiteIp = {
    config: { rateLimit: { max: limites.login.max, timeWindow: limites.login.ventanaMs } },
  };

  // Las comprobaciones de PIN van de una en una: con argon2 asíncrono, una ráfaga en
  // paralelo podría pasar el bloqueo global antes de que se registren sus fallos.
  let cola: Promise<unknown> = Promise.resolve();
  function enCola<T>(tarea: () => Promise<T>): Promise<T> {
    const resultado = cola.then(tarea, tarea);
    cola = resultado.catch(() => undefined);
    return resultado;
  }

  // Gestionar passkeys exige sesión de navegador, no un token de API.
  async function soloSesion(request: FastifyRequest, reply: FastifyReply) {
    if (request.tokenId !== null) {
      reply.code(403).send({ mensaje: "Solo disponible con sesión iniciada en el navegador" });
      return reply;
    }
  }
  const conSesion = { preHandler: [app.requireAuth, soloSesion] };

  function sinWebAuthn(reply: FastifyReply): FastifyReply {
    return reply.code(503).send({ mensaje: "La entrada con huella no está configurada" });
  }

  app.get("/auth/metodos", async () => {
    const [conPin] = await db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(isNotNull(usuarios.pinHash))
      .limit(1);
    const [conPasskey] = webauthn
      ? await db.select({ id: passkeys.id }).from(passkeys).limit(1)
      : [];
    return {
      correo: opciones.accesoCorreo,
      registro: opciones.registroAbierto,
      pin: Boolean(conPin),
      huella: Boolean(conPasskey),
    };
  });

  app.post("/auth/pin", limiteIp, async (request, reply) => {
    const resultado = esquemaPin.safeParse(request.body);
    if (!resultado.success) {
      return reply.code(400).send({ mensaje: "El PIN debe tener de 6 a 12 dígitos" });
    }

    return enCola(async () => {
      const espera = bloqueo.segundosBloqueado();
      if (espera > 0) return demasiados(reply, espera);

      const [propietario] = await db
        .select()
        .from(usuarios)
        .where(isNotNull(usuarios.pinHash))
        .limit(1);
      const hashAComparar = propietario?.pinHash ?? (await obtenerHashFicticio());

      let esValido = false;
      try {
        esValido = await verify(hashAComparar, resultado.data.pin);
      } catch {
        esValido = false;
      }

      if (!propietario || !esValido) {
        const bloqueoNuevo = bloqueo.registrarFallo();
        if (bloqueoNuevo > 0) return demasiados(reply, bloqueoNuevo);
        return reply.code(401).send({ mensaje: "PIN incorrecto" });
      }

      bloqueo.reiniciar();
      await crearSesion(db, propietario.id, reply);
      return reply.code(200).send(datosUsuario(propietario));
    });
  });

  app.post("/auth/huella/registro-opciones", conSesion, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) return reply.code(401).send({ mensaje: "No autenticado" });
    const reautenticar = exigirSesionReciente(request, reply);
    if (reautenticar) return reautenticar;
    if (!webauthn) return sinWebAuthn(reply);

    const existentes = await db
      .select({ credencialId: passkeys.credencialId })
      .from(passkeys)
      .where(eq(passkeys.usuarioId, usuario.id));

    return {
      challenge: retos.crear("registro", usuario.id),
      rp: { id: webauthn.rpId, name: "TODO-projects" },
      user: {
        id: aBase64url(Buffer.from(usuario.id.replace(/-/g, ""), "hex")),
        name: usuario.nombre,
        displayName: usuario.nombre,
      },
      pubKeyCredParams: [ALGORITMOS.ES256, ALGORITMOS.RS256, ALGORITMOS.EdDSA].map((alg) => ({
        type: "public-key",
        alg,
      })),
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      attestation: "none",
      timeout: TIEMPO_CEREMONIA_MS,
      excludeCredentials: existentes.map((p) => ({ type: "public-key", id: p.credencialId })),
    };
  });

  app.post("/auth/huella/registro", conSesion, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) return reply.code(401).send({ mensaje: "No autenticado" });
    const reautenticar = exigirSesionReciente(request, reply);
    if (reautenticar) return reautenticar;
    if (!webauthn) return sinWebAuthn(reply);

    const cuerpo = (request.body ?? {}) as RespuestaRegistro & { nombre?: unknown };
    const nombre = esquemaNombreDispositivo.safeParse(cuerpo.nombre);

    let credencial;
    try {
      credencial = verificarRegistro(cuerpo, webauthn, retos);
    } catch (error) {
      if (error instanceof ErrorWebAuthn) {
        return reply
          .code(400)
          .send({ mensaje: `No se pudo registrar la huella: ${error.message}` });
      }
      throw error;
    }
    if (credencial.usuarioId !== usuario.id) {
      return reply.code(400).send({ mensaje: "No se pudo registrar la huella" });
    }

    try {
      const [creada] = await db
        .insert(passkeys)
        .values({
          usuarioId: usuario.id,
          credencialId: credencial.credencialId,
          clavePublica: credencial.clavePublica,
          algoritmo: credencial.algoritmo,
          contador: credencial.contador,
          nombre: nombre.success ? nombre.data : "Dispositivo",
        })
        .returning({ id: passkeys.id, nombre: passkeys.nombre, createdAt: passkeys.createdAt });
      return reply.code(201).send(creada);
    } catch (error) {
      const causa = (error as { cause?: { code?: string } }).cause;
      if (causa?.code === "23505") {
        return reply.code(409).send({ mensaje: "Este dispositivo ya está registrado" });
      }
      throw error;
    }
  });

  app.post("/auth/huella/entrada-opciones", limiteIp, async (_request, reply) => {
    if (!webauthn) return sinWebAuthn(reply);
    const credenciales = await db.select({ credencialId: passkeys.credencialId }).from(passkeys);
    return {
      challenge: retos.crear("entrada", null),
      rpId: webauthn.rpId,
      allowCredentials: credenciales.map((p) => ({ type: "public-key", id: p.credencialId })),
      userVerification: "required",
      timeout: TIEMPO_CEREMONIA_MS,
    };
  });

  app.post("/auth/huella/entrada", limiteIp, async (request, reply) => {
    if (!webauthn) return sinWebAuthn(reply);
    const rechazo = () => reply.code(401).send({ mensaje: "No se pudo verificar la huella" });

    try {
      const entrada = prepararEntrada((request.body ?? {}) as RespuestaEntrada, webauthn, retos);
      const [guardada] = await db
        .select()
        .from(passkeys)
        .where(eq(passkeys.credencialId, entrada.credencialId))
        .limit(1);
      if (!guardada) return rechazo();

      const contador = entrada.verificar(guardada);
      await db
        .update(passkeys)
        .set({ contador, ultimoUso: new Date() })
        .where(eq(passkeys.id, guardada.id));

      const [usuario] = await db
        .select()
        .from(usuarios)
        .where(eq(usuarios.id, guardada.usuarioId))
        .limit(1);
      if (!usuario) return rechazo();

      bloqueo.reiniciar();
      await crearSesion(db, usuario.id, reply);
      return reply.code(200).send(datosUsuario(usuario));
    } catch (error) {
      if (error instanceof ErrorWebAuthn) return rechazo();
      throw error;
    }
  });

  app.get("/auth/huella", conSesion, async (request) => {
    const usuario = request.usuario;
    if (!usuario) return [];
    return db
      .select({
        id: passkeys.id,
        nombre: passkeys.nombre,
        createdAt: passkeys.createdAt,
        ultimoUso: passkeys.ultimoUso,
      })
      .from(passkeys)
      .where(eq(passkeys.usuarioId, usuario.id))
      .orderBy(passkeys.createdAt);
  });

  app.delete("/auth/huella/:id", conSesion, async (request, reply) => {
    const usuario = request.usuario;
    const { id } = request.params as { id: string };
    if (!usuario || !ES_UUID.test(id)) {
      return reply.code(404).send({ mensaje: "Dispositivo no encontrado" });
    }
    const borradas = await db
      .delete(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.usuarioId, usuario.id)))
      .returning({ id: passkeys.id });
    if (borradas.length === 0) {
      return reply.code(404).send({ mensaje: "Dispositivo no encontrado" });
    }
    return reply.code(204).send();
  });
}
