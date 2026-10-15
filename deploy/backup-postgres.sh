#!/usr/bin/env bash
# Copia de la base de datos con rotación. Uso: deploy/backup-postgres.sh [días_a_conservar]
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DIAS="${1:-14}"
DESTINO="$RAIZ/backups"
COMPOSE=(docker compose -f "$RAIZ/docker-compose.prod.yml" --env-file "$RAIZ/.env")

mkdir -p "$DESTINO"
umask 077
FICHERO="$DESTINO/todo-$(date +%F-%H%M).sql.gz"

# Las variables se leen dentro del contenedor, así no hace falta cargar el .env.
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$FICHERO"

# Una copia vacía o corrupta no debe sustituir a las buenas.
gzip -t "$FICHERO"
[ "$(gzip -dc "$FICHERO" | wc -c)" -gt 1000 ] || { rm -f "$FICHERO"; echo "Copia sospechosamente pequeña" >&2; exit 1; }

find "$DESTINO" -name 'todo-*.sql.gz' -mtime +"$DIAS" -delete
echo "Copia creada: $FICHERO"
