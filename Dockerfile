# --- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first: the npm ci layer is reused as long as they do not change.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY server server
COPY client client

# The bundled definitions are not in git, so a fresh clone does not have them.
# `docker compose` mounts server/data over this directory and gets its copy from
# scripts/deploy.sh, which is why the file is usually already here and this step
# does nothing. It is for `docker build` on its own, so the documented quickstart
# still ships definitions.
#
# Best-effort throughout: a build must not fail because GitHub is unreachable,
# and a game without this file still answers, by asking Wiktionary live.
ARG DEFINITIONS_BASE=https://github.com/AltarBeastiful/boggle-multiplayer/releases/latest/download
RUN if [ ! -s server/data/definitions.tsv.gz ]; then \
      ( cd /tmp \
        && wget -q -O definitions.tsv.gz "$DEFINITIONS_BASE/definitions.tsv.gz" \
        && wget -q -O SHA256SUMS "$DEFINITIONS_BASE/SHA256SUMS" \
        && grep 'definitions\.tsv\.gz$' SHA256SUMS > definitions.sha256 \
        && sha256sum -c definitions.sha256 \
        && mv definitions.tsv.gz /app/server/data/definitions.tsv.gz \
        && echo '[build] definitions downloaded and verified' ) \
      || echo '[build] no bundled definitions: words will be looked up on Wiktionary'; \
    fi

# Trace of a found word on the grid; VITE_WORD_TRACE=off removes it.
ARG VITE_WORD_TRACE=on
ENV VITE_WORD_TRACE=$VITE_WORD_TRACE
RUN npm run build

# --- runtime ----------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace @boggle/server --include-workspace-root

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/data server/data
COPY --from=build /app/client/dist client/dist

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1

USER node
CMD ["node", "server/dist/index.js"]
