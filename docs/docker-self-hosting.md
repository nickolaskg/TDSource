# Docker self-hosting

TDSource combines a Vite client with a Cloudflare Worker API. The image uses
Node 22 and Wrangler's local Worker runtime to serve both parts on port `8787`.

## Build

```bash
docker build -t tdsource:local .
```

The Docker build context excludes `.env*` and `.dev.vars*`. Secrets are supplied
only when the container starts.

## Configure

Create a server-local file named `docker.env`. Do not commit it:

```dotenv
APP_ORIGIN=https://tdsource.example.lan
APPROVED_EMAIL_DOMAINS=tdsynnex.com
SESSION_COOKIE_NAME=__Host-tds_session
WEBEX_REDIRECT_URI=https://tdsource.example.lan/api/auth/webex/callback

SESSION_ENCRYPTION_KEY=replace-with-a-long-random-secret
WEBEX_CLIENT_ID=replace-me
WEBEX_CLIENT_SECRET=replace-me
WEBEX_BOT_ACCESS_TOKEN=replace-me
WEBEX_BOT_NAME=replace-me
WEBEX_WEBHOOK_SECRET=replace-me
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=replace-me

LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
GEMINI_AI_API=replace-me
```

For Ollama, set `LLM_PROVIDER=ollama`, `LLM_MODEL`, and `LLM_BASE_URL`. Make the
Ollama API reachable from the container. For example, use the LAN address
`http://192.168.1.42:11434`. `127.0.0.1` inside the container is the container
itself, not the Docker host.

## Run

```bash
docker run -d \
  --name tdsource \
  --restart unless-stopped \
  --env-file docker.env \
  -p 8787:8787 \
  tdsource:local
```

Verify the container:

```bash
curl http://127.0.0.1:8787/api/health
docker inspect --format='{{json .State.Health}}' tdsource
```

## HTTPS and Webex

Put the container behind an HTTPS reverse proxy such as Caddy, Nginx, or
Traefik. `APP_ORIGIN` and `WEBEX_REDIRECT_URI` must use the exact public HTTPS
origin that users open. The `__Host-` session cookie is secure-only and will not
authenticate over plain HTTP.

Register the same callback URL in the Webex OAuth application. Webex webhook
delivery also requires an HTTPS URL that Webex can reach; a LAN-only hostname
needs an approved tunnel or reverse proxy if capture commands are enabled.

The container does not host Supabase. Apply the repository's migrations to the
configured Supabase project before starting the application.
