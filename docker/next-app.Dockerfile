# syntax=docker/dockerfile:1.7
#
# One Dockerfile for both Next.js apps. Build from the repository root:
#
#   docker build -f docker/next-app.Dockerfile --build-arg APP=learner \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... .
#
# `turbo prune` cuts the workspace down to the packages this app depends on,
# so a change to the worker never rebuilds the learner's dependency layer.
# NEXT_PUBLIC_* values are inlined at build time, so an image is built per
# environment and promoted by git sha rather than by digest.
ARG NODE_IMAGE=node:22-alpine
ARG PNPM_VERSION=10.31.0
ARG TURBO_VERSION=2.11.2

# ---- 1. prune: only the workspace subset this app depends on ----------------
FROM ${NODE_IMAGE} AS pruner
ARG APP
ARG TURBO_VERSION
RUN apk add --no-cache libc6-compat
WORKDIR /repo
RUN npm install -g turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune @dp/${APP} --docker

# ---- 2. deps: install from the pruned lockfile, store cached across builds --
FROM ${NODE_IMAGE} AS deps
ARG PNPM_VERSION
RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm@${PNPM_VERSION}
# No TTY here: pnpm otherwise refuses to replace a modules directory it finds.
ENV CI=true
WORKDIR /repo
COPY --from=pruner /repo/out/pnpm-lock.yaml /repo/out/pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline

# ---- 3. build ---------------------------------------------------------------
FROM deps AS builder
ARG APP
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY} \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@dp/${APP} \
 && rm -rf apps/${APP}/.next/cache

# ---- 4. prod-deps: the same tree with devDependencies removed ----------------
FROM deps AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline --prod

# ---- 5. runner: sources + prod node_modules + .next, non-root, `next start` --
FROM ${NODE_IMAGE} AS runner
ARG APP
ARG GIT_SHA=unknown
RUN apk add --no-cache libc6-compat curl
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    GIT_SHA=${GIT_SHA}
WORKDIR /app
COPY --from=prod-deps --chown=node:node /repo/ ./
COPY --from=pruner    --chown=node:node /repo/out/full/ ./
COPY --from=builder   --chown=node:node /repo/apps/${APP}/.next ./apps/${APP}/.next
USER node
WORKDIR /app/apps/${APP}
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1
# next start honours PORT; the bind address is explicit. No pnpm at runtime.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"]
