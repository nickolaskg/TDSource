# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
ENV CLOUDFLARE_INCLUDE_PROCESS_ENV=true
ENV WRANGLER_SEND_METRICS=false

RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

WORKDIR /app

# Wrangler is the Node-based local runtime for the Worker API and built assets.
# Keep build dependencies in the runtime image because Wrangler is a devDependency.
COPY --chown=node:node --from=build /app /app

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["pnpm", "exec", "wrangler", "dev", "--local", "--ip", "0.0.0.0", "--port", "8787"]
