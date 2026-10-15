#!/usr/bin/env bash
# Fija (o cambia) el PIN de acceso del propietario. Pide el PIN sin mostrarlo.
# Uso: deploy/fijar-pin.sh ["Nombre"] [correo]   (nombre y correo solo al crear el propietario)
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
read -rsp "PIN nuevo (6 a 12 dígitos): " PIN; echo
read -rsp "Repite el PIN: " PIN2; echo
[ "$PIN" = "$PIN2" ] || { echo "Los PIN no coinciden" >&2; exit 1; }

docker compose -f "$RAIZ/docker-compose.prod.yml" --env-file "$RAIZ/.env" exec -T \
  -e PIN="$PIN" -e NOMBRE="${1:-}" -e EMAIL="${2:-}" \
  api pnpm --filter @todo/api exec tsx src/fijar-pin.ts
