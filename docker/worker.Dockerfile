# syntax=docker/dockerfile:1.7
#
# The worker: drains the job queue, runs the product-ops stages and the
# scheduled jobs, and — for a process serving the "coder" queue — holds a
# checkout of the repository and cuts a worktree per run.
#
# Debian slim rather than Alpine: the coder runs the checkout's own
# `pnpm typecheck|lint|test|build` inside a worktree, where musl trips native
# dependencies. The worker itself runs from TypeScript source via tsx, so the
# runtime image is the pruned source tree plus a production node_modules.
ARG NODE_IMAGE=node:22-bookworm-slim
ARG PNPM_VERSION=10.31.0
ARG TURBO_VERSION=2.11.2

# ---- 1. prune ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS pruner
ARG TURBO_VERSION
WORKDIR /repo
RUN npm install -g turbo@${TURBO_VERSION}
COPY . .
# @dp/corpus rides along because apps/worker/package.json depends on it.
RUN turbo prune @dp/worker --docker

# ---- 2. deps ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
# No TTY here: pnpm otherwise refuses to replace a modules directory it finds.
ENV CI=true
WORKDIR /repo
COPY --from=pruner /repo/out/pnpm-lock.yaml /repo/out/pnpm-workspace.yaml ./
# No BuildKit cache mounts: Railway's Dockerfile validator rejects an id
# without its own service prefix, and neither GitHub Actions' type=gha cache
# nor Railway persists a RUN cache mount between builds anyway. Layer caching
# on the lockfile does the work instead.
RUN pnpm fetch --frozen-lockfile
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile --offline --prod

# ---- 3. runner --------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
ARG PNPM_VERSION
ARG GIT_SHA=unknown
ENV NODE_ENV=production \
    GIT_SHA=${GIT_SHA} \
    PORT=8080 \
    REPO_CHECKOUT_PATH=/workspace/repo \
    WORKER_QUEUES=jobs \
    WORKER_CONCURRENCY=2 \
    WORKER_POLL_MS=2000 \
    WORKER_LOCK_SECONDS=90 \
    WORKER_SCHEDULER=true \
    GIT_ASKPASS=/usr/local/bin/git-askpass \
    GIT_TERMINAL_PROMPT=0 \
    npm_config_store_dir=/workspace/.pnpm-store \
    NODE_OPTIONS=--max-old-space-size=3072 \
    TURBO_CONCURRENCY=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1
# GIT_ASKPASS: git never sees the token in a URL, a config file or argv.
# npm_config_store_dir: the checkout's pnpm store lives beside it, on the volume.
# NODE_OPTIONS: inherited by every child (turbo, next build, vitest forks). A cap.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@${PNPM_VERSION} \
 && mkdir -p /workspace && chown node:node /workspace
COPY --chmod=0755 docker/worker-entrypoint.sh /usr/local/bin/worker-entrypoint
COPY --chmod=0755 docker/git-askpass.sh /usr/local/bin/git-askpass
WORKDIR /app
COPY --from=deps   --chown=node:node /repo/ ./
COPY --from=pruner --chown=node:node /repo/out/full/ ./
USER node
WORKDIR /app/apps/worker
# No VOLUME instruction: Railway rejects it, and it was only declarative. The
# coder's checkout volume is mounted at /workspace by the platform manifest
# (Cloud Run, Kubernetes) or a Railway Volume, never by the image.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1
ENTRYPOINT ["tini", "--", "worker-entrypoint"]
CMD ["node_modules/.bin/tsx", "src/main.ts"]
