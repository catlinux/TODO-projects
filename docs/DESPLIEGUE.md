# Despliegue en producción

> **Probado en el VPS de producción (0.5.1 a 0.7.0):** arranque con Docker, Apache como proxy con HTTPS, registro, inicio de sesión, creación de proyectos, límite de intentos por IP real, copia de la base de datos y, en la 0.7.0, entrada con PIN (ordenador y móvil) y activación y entrada con huella en un móvil Android. **No probado:** la restauración de una copia, los avisos con SMTP y claves VAPID reales, y el reinicio completo del servidor.

## Qué levanta

`docker-compose.prod.yml` arranca tres servicios:

- **postgres**: PostgreSQL 16 con un volumen persistente `postgres_data`.
- **api**: la API Fastify (imagen `api` del `Dockerfile`), que aplica las migraciones al arrancar. No publica puerto al exterior: solo es accesible desde la red interna.
- **web**: Caddy (imagen `web`) sirviendo la web estática y haciendo de proxy de `/api/*` hacia `api:3000`, quitando el prefijo `/api`.

```
navegador ──► Apache (host, 443) ──► web (Caddy, 127.0.0.1:8083) ──► /api/* ──► api:3000 ──► postgres:5432
                                                          └──► resto: ficheros estáticos de la SPA
```

Los tres servicios llevan `restart: unless-stopped` y rotación de logs (10 MB × 3). Con Docker habilitado en el arranque (`systemctl is-enabled docker`) vuelven solos tras reiniciar el servidor; no hace falta ninguna unidad de systemd propia.

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
   chmod 600 .env
   # Edita .env: pon una POSTGRES_PASSWORD fuerte (por ejemplo `openssl rand -hex 24`) y, si quieres, POSTGRES_USER, POSTGRES_DB y WEB_PORT.
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

`WEB_PORT` es la dirección y el puerto donde publica el contenedor `web`. Con `WEB_PORT=80` (valor por defecto) la web queda en `http://IP-del-servidor/`; con `WEB_PORT=127.0.0.1:8083` solo es accesible desde el propio servidor, que es lo que se usa detrás de Apache. La API aplica las migraciones automáticamente al arrancar.

## Copia de seguridad y restauración de PostgreSQL

[deploy/backup-postgres.sh](../deploy/backup-postgres.sh) hace un `pg_dump` comprimido en `backups/` (fuera de git, permisos 600), lo valida y borra las copias de más de 14 días (o los días que indiques como argumento):

```sh
deploy/backup-postgres.sh
```

Para programarla a diario, siguiendo la convención del servidor (timer de systemd), crea `/etc/systemd/system/todo-backup.service` y `todo-backup.timer`. **No está activado:**

```ini
# todo-backup.service
[Unit]
Description=Copia diaria de PostgreSQL de todo-project
[Service]
Type=oneshot
User=sysmarc
ExecStart=/opt/contabo-apps/todo-project/deploy/backup-postgres.sh

# todo-backup.timer
[Unit]
Description=Copia diaria de todo-project
[Timer]
OnCalendar=*-*-* 04:30:00
RandomizedDelaySec=15min
Persistent=true
[Install]
WantedBy=timers.target
```

Con `sudo systemctl enable --now todo-backup.timer`. La alternativa con cron es la línea `30 4 * * * /opt/contabo-apps/todo-project/deploy/backup-postgres.sh`.

La carpeta `backups/` está en el mismo disco que los datos: si necesitas protegerte de un fallo del disco, copia esos archivos a otro sitio.

Restauración (sobre una base vacía; **sin probar**):

```sh
gunzip -c backups/todo-AAAA-MM-DD-HHMM.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## Actualización

```sh
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Las migraciones de la API se aplican solas al reiniciar el contenedor. No borres el volumen `postgres_data` salvo que quieras empezar de cero.

## HTTPS y proxy con Apache (instalación del VPS)

**HTTPS es obligatorio en producción.** Con `NODE_ENV=production` la cookie de sesión se marca `Secure`, y el navegador no la guarda si accedes por HTTP (salvo en `localhost`): nadie podría iniciar sesión.

En el VPS el TLS lo termina Apache (como en el resto de servicios) y reenvía al contenedor `web`, que publica solo en `127.0.0.1:8083` (`WEB_PORT=127.0.0.1:8083` en `.env`). El vhost de referencia es [deploy/apache-todo-project.conf](../deploy/apache-todo-project.conf); `ProxyPreserveHost` y `X-Forwarded-Proto` son necesarios. Con los módulos `proxy`, `proxy_http` y `headers` ya activos:

```sh
sudo cp deploy/apache-todo-project.conf /etc/apache2/sites-available/todo-project.invierteconcriterio.es.conf
sudo a2ensite todo-project.invierteconcriterio.es.conf
sudo apachectl configtest && sudo systemctl reload apache2
sudo certbot --apache -d todo-project.invierteconcriterio.es --redirect
sudo certbot renew --dry-run
```

Certbot añade el vhost 443 y la redirección. La renovación la hace `certbot.timer`.

### IP real del cliente

La API limita los intentos de acceso por IP y, con `TRUST_PROXY=1`, usa la **primera** IP de `X-Forwarded-For`. En la cadena Apache → Caddy → API eso exige que Caddy entregue solo la IP real:

- Sin configuración, Caddy no confía en el `X-Forwarded-For` de Apache y lo sustituye por la IP de la pasarela de Docker: todos los usuarios compartirían IP y el límite sería global.
- Confiar en el proxy sin más sería peor: la API recibiría `falsa, real` y cualquiera se saltaría el límite enviando su propia cabecera.

[deploy/Caddyfile](../deploy/Caddyfile) usa `trusted_proxies static private_ranges` con `trusted_proxies_strict` (Caddy toma la IP más a la derecha que no es de confianza, la que añade Apache) y `header_up X-Forwarded-For {client_ip}` hacia la API. Comprobado en el VPS: 13 fallos de login con un `X-Forwarded-For` distinto en cada petición dan 429 desde el décimo, y una petición desde otra IP de origen sigue pasando.

Si en el futuro hay un proxy delante de Apache (p. ej. Cloudflare), Apache debería usar `mod_remoteip` para exponer la IP real antes de reenviar.

### Alternativa: Caddy con TLS automático

Si no hay un proxy en el host, edita `deploy/Caddyfile` y sustituye `:80` por tu dominio, publica `80:80` y `443:443` en `web` y monta volúmenes para los certificados:

```yaml
web:
  ports:
    - "80:80"
    - "443:443"
  volumes:
    - caddy_data:/data
    - caddy_config:/config
```

(y `caddy_data:` y `caddy_config:` en `volumes`). Caddy pedirá y renovará el certificado solo. Esta variante no se ha probado.

## Acceso personal: PIN y huella

En producción se entra con un PIN y con la huella del dispositivo, sin correo ni contraseña. En `.env`:

```sh
REGISTRO_ABIERTO=0
ACCESO_CORREO=0
ORIGEN_PUBLICO=https://todo-project.invierteconcriterio.es
```

Aplica los cambios con `docker compose -f docker-compose.prod.yml up -d` y fija el PIN (de 6 a 12 dígitos) desde el servidor:

```sh
deploy/fijar-pin.sh "Tu nombre" [correo-para-avisos]
```

El script pide el PIN dos veces sin mostrarlo. Si no hay usuarios, crea el propietario; si ya existe, solo cambia el PIN. Para cambiarlo más adelante, vuelve a ejecutarlo. El correo es opcional y solo sirve para los avisos por correo.

La huella se activa desde cada dispositivo después de entrar con el PIN. **Las passkeys quedan atadas al dominio de `ORIGEN_PUBLICO`** y exigen HTTPS: si cambia el dominio, hay que borrarlas en Ajustes › Acceso y volver a activarlas.

Si en algún momento se quiere volver al acceso con correo (`ACCESO_CORREO=1`), `deploy/crear-usuario.sh correo "Nombre"` crea usuarios con contraseña.

## Avisos

Los avisos son opcionales y se configuran en `.env`:

- **Correo**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` y `SMTP_SECURE` (`1` para TLS directo en el 465, `0` para STARTTLS). Sin `SMTP_HOST` el canal de correo queda desactivado.
- **Push**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`. Genera las claves una vez con `npx web-push generate-vapid-keys` y cópialas al `.env`; sin las tres el canal push queda desactivado. `VAPID_SUBJECT` debe ser un contacto válido, por ejemplo `mailto:tu-correo@ejemplo.com`.
- **`AVISOS_ACTIVOS`**: `1` (por defecto) arranca el bucle que procesa los avisos cada minuto; `0` lo desactiva.

Si no hay ningún canal configurado, la API no arranca el bucle y lo indica por consola. El servicio `api` del compose recibe estas variables desde el `.env`.

## Notas

- La API confía en el proxy (`TRUST_PROXY=1`) para calcular la IP real de los límites de intentos. No lo pongas a `0` si estás detrás de Caddy. Ver «IP real del cliente».
- El contenedor `api` ejecuta TypeScript con `tsx` (por eso `tsx` es dependencia de producción de `apps/api`), ya que `@todo/shared` se consume como código fuente.
