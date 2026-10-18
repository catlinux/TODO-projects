// Fija el PIN del propietario. Si no hay usuarios, crea el propietario.
// Uso: PIN=… [NOMBRE=…] [EMAIL=…] pnpm --filter @todo/api exec tsx src/fijar-pin.ts
// Con varios usuarios, EMAIL elige cuál es el propietario; a los demás se les quita el PIN.
import { randomBytes } from "node:crypto";

import { hash } from "@node-rs/argon2";
import { eq, inArray, ne } from "drizzle-orm";

import { esquemaPin } from "@todo/shared";

import { createDatabase } from "./db/index.js";
import { sesiones, usuarios } from "./db/schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL no está definida");
}

const pin = esquemaPin.safeParse({ pin: process.env.PIN });
if (!pin.success) {
  console.error("El PIN debe tener de 6 a 12 dígitos");
  process.exit(1);
}

const email = process.env.EMAIL?.trim().toLowerCase() || undefined;
const { db, pool } = createDatabase(databaseUrl);
try {
  const pinHash = await hash(pin.data.pin);
  const todos = await db.select().from(usuarios);

  let propietarioId: string;
  if (todos.length === 0) {
    const [creado] = await db
      .insert(usuarios)
      .values({
        email: email ?? "propietario@todo.invalid",
        nombre: process.env.NOMBRE?.trim() || "Propietario",
        // Contraseña aleatoria que nadie conoce: el acceso es con PIN o huella.
        passwordHash: await hash(randomBytes(32).toString("base64url")),
        pinHash,
      })
      .returning();
    if (!creado) throw new Error("No se pudo crear el propietario");
    propietarioId = creado.id;
    console.log(`Propietario creado (${creado.email}) con el PIN indicado.`);
  } else {
    const elegido = email
      ? todos.find((u) => u.email === email)
      : todos.length === 1
        ? todos[0]
        : undefined;
    if (!elegido) {
      console.error(
        email
          ? `No existe ningún usuario con el correo ${email}.`
          : "Hay varios usuarios: indica con EMAIL cuál es el propietario.",
      );
      process.exit(1);
    }
    propietarioId = elegido.id;
    await db.update(usuarios).set({ pinHash }).where(eq(usuarios.id, propietarioId));
    console.log(`PIN actualizado para ${elegido.email}.`);
  }

  await db.update(usuarios).set({ pinHash: null }).where(ne(usuarios.id, propietarioId));

  // Cambiar (o quitar) el PIN invalida las sesiones abiertas de los afectados.
  const afectados = [
    propietarioId,
    ...todos.filter((u) => u.id !== propietarioId && u.pinHash !== null).map((u) => u.id),
  ];
  const cerradas = await db
    .delete(sesiones)
    .where(inArray(sesiones.usuarioId, afectados))
    .returning({ id: sesiones.id });
  console.log(
    cerradas.length === 0
      ? "No había sesiones abiertas que cerrar."
      : `Sesiones cerradas: ${cerradas.length}.`,
  );
} finally {
  await pool.end();
}
