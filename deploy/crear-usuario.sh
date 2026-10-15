#!/usr/bin/env bash
# Crea un usuario en producción. Pide la contraseña sin mostrarla ni dejarla en el historial.
# Uso: deploy/crear-usuario.sh correo@ejemplo.com "Nombre"
set -euo pipefail

[ $# -eq 2 ] || { echo "Uso: $0 correo \"Nombre\"" >&2; exit 1; }
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
read -rsp "Contraseña (mínimo 10 caracteres): " CONTRASENA; echo

docker compose -f "$RAIZ/docker-compose.prod.yml" --env-file "$RAIZ/.env" exec -T \
  -e EMAIL="$1" -e NOMBRE="$2" -e CONTRASENA="$CONTRASENA" \
  api pnpm --filter @todo/api exec tsx src/crear-usuario.ts
