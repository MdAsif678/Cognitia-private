# Analysis API + fork simulator. Build from the repo root:
#   docker build -f services/api/Dockerfile -t cognitia-api .
# Anvil runs inside this container bound to 127.0.0.1 only — forks are never reachable from outside.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
# The whole repo is copied so the lockfile matches every workspace and the integrated risk engine.
COPY . .
RUN npm ci --ignore-scripts
RUN npm run build -w @cognitia/api

FROM debian:bookworm-slim AS foundry
ARG FOUNDRY_VERSION=v1.8.1
ARG TARGETARCH=amd64
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL "https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY_VERSION}/foundry_${FOUNDRY_VERSION}_linux_${TARGETARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin anvil \
 && /usr/local/bin/anvil --version

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    ANVIL_PATH=/usr/local/bin/anvil
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini && rm -rf /var/lib/apt/lists/*
COPY --from=foundry /usr/local/bin/anvil /usr/local/bin/anvil
WORKDIR /app
COPY --from=build /repo/services/api/dist/server.mjs ./server.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.mjs"]
