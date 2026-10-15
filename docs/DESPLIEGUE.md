# Despliegue en producción

> **Esta configuración no se ha probado todavía en un servidor con Docker.** Está escrita y revisada, pero el equipo de desarrollo no dispone de Docker para ejecutarla de extremo a extremo. Revísala en tu servidor antes de confiar en ella.

## Qué levanta

`docker-compose.prod.yml` arranca tres servicios:

- **postgres**: PostgreSQL 16 con un volumen persistente `postgres_data`.
- **api**: la API Fastify (imagen `api` del `Dockerfile`), que aplica las migraciones al arrancar. No publica puerto al exterior: solo es accesible desde la red interna.
- **web**: Caddy (imagen `web`) sirviendo la web estática y haciendo de proxy de `/api/*` hacia `api:3000`, quitando el prefijo `/api`.

```
navegador ──► web (Caddy :80) ──► /api/* ──► api:3000 ──► postgres:5432
                        └──► resto: ficheros estáticos de la SPA
```

## Requisitos

- Un servidor Linux (VPS) con Docker y Docker Compose v2.
- El puerto 80 libre (y 443 si vas a poner HTTPS en este mismo Caddy).
- Opcional: un dominio apuntando a la IP del servidor.

## Puesta en marcha

1. Clona el repositorio y entra en él:

   ```sh
   git clone <url-del-repositorio> todo-projects
   cd todo-projects
   ```

2. Crea el archivo de entorno a partir del ejemplo y rellena la contraseña:

   ```sh
   cp .env.example .env
   # Edita .env: cambia POSTGRES_PASSWORD y, si quieres, POSTGRES_USER, POSTGRES_DB y WEB_PORT.
   ```

3. Construye y levanta todo:

   ```sh
   docker compose -f docker-compose.prod.yml up -d --build
   ```

4. Comprueba el estado y los registros:

   ```sh
   docker compose -f docker-compose.prod.yml ps
   docker compose -f docker-compose.prod.yml logs -f api
   ```

Con `WEB_PORT=80` (valor por defecto) la web queda en `http://IP-del-servidor/`. La API aplica las migraciones automáticamente al arrancar.

## Copia de seguridad y restauración de PostgreSQL

Copia:

```sh
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > copia-$(date +%F).sql
```

Restauración (sobre una base vacía o existente):

```sh
cat copia-2026-01-01.sql | docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Si no tienes las variables cargadas en la shell, usa los valores de `.env` (`POSTGRES_USER`, `POSTGRES_DB`) o pásalos a mano.

## Actualización

```sh
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Las migraciones de la API se aplican solas al reiniciar el contenedor. No borres el volumen `postgres_data` salvo que quieras empezar de cero.

## HTTPS

**HTTPS es obligatorio en producción.** Con `NODE_ENV=production` la cookie de sesión se marca `Secure`, y el navegador no la guarda si accedes por HTTP (salvo en `localhost`): nadie podría iniciar sesión. Pon HTTPS antes de usar la aplicación fuera de tu equipo.

Tienes dos opciones:

- **Proxy externo (recomendado si ya tienes Caddy/nginx con certificados en el VPS):** deja `web` escuchando en `127.0.0.1` o en la red interna y que el proxy del host termine el TLS y reenvíe a `web`. Con Compose puedes cambiar el mapeo a `"127.0.0.1:${WEB_PORT:-80}:80"` y configurar el proxy del host. Mantén `TRUST_PROXY=1` en la API para que use la IP real.
- **Caddy con TLS automático:** edita `deploy/Caddyfile` y sustituye `:80` por tu dominio (por ejemplo `todo.midominio.com`), añade un mapeo de `443:443` a `web`, publica también el 80 para el reto ACME y monta volúmenes para los certificados:

  ```yaml
  web:
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - caddy_data:/data
      - caddy_config:/config
  ```

  y en `volumes` añade `caddy_data:` y `caddy_config:`. Caddy pedirá y renovará el certificado solo.

## Notas

- La API confía en el proxy (`TRUST_PROXY=1`) para calcular la IP real de los límites de intentos. No lo pongas a `0` si estás detrás de Caddy.
- El contenedor `api` ejecuta TypeScript con `tsx` (por eso `tsx` es dependencia de producción de `apps/api`), ya que `@todo/shared` se consume como código fuente.
