# 5. Docker, Docker Compose and Kubernetes

How the three deployables are packaged, run together on a laptop, and run in production. This document explains the general concepts and then shows exactly what this repository does, including where it does something *other* than the textbook answer and why.

One candid note up front: **this project deploys to Google Cloud Run, not to a Kubernetes cluster you manage.** Cloud Run is built on Knative, which runs on Kubernetes under the hood, and its manifests use the Kubernetes object model. So everything in section 3 about clusters, pods and deployments is real and relevant; it is just that Google runs the cluster and we hand it manifests. The reasons are in section 3.5.

---

## 1. Containerisation fundamentals (Docker)

### 1.1 What Docker is

A **container** is a running program packaged together with everything it needs to run: the operating system libraries, the language runtime (Node 22), the dependencies (`node_modules`), the built code, and the configuration. It runs isolated from other containers on the same machine, but shares the machine's kernel, so it starts in milliseconds rather than the minutes a full virtual machine takes.

An **image** is the frozen, read-only blueprint a container is started from. A **Dockerfile** is the recipe that builds an image. A **registry** (GitHub Container Registry, Google Artifact Registry) is where images are stored and pulled from.

**Analogy: the standardised shipping container.** Before 1956, cargo was loaded piece by piece, each ship and each port different. The shipping container standardised the box: any container fits any ship, any crane, any truck, regardless of what is inside. Docker did the same for software. Whatever is inside (a Next.js app, a Node worker, a Python script), the box has the same shape, starts the same way, and runs identically on a laptop, a CI runner and a cloud server.

### 1.2 Why we containerise this Turborepo app

**The "works on my machine" problem.** Without containers, a program depends on whatever happens to be installed where it runs: which Node version, which system libraries, which environment variables. The learner app worked on the developer's Mac with Node 22.4 and failed on a server with Node 20. Containers eliminate that class of bug by shipping the runtime *with* the code.

**Three specific reasons here:**

1. **Three different runtime shapes.** The Next.js apps need `next start` and a production `node_modules`. The worker needs `git`, `tini`, and a writable `/workspace` volume. The coding worker needs glibc (not Alpine's musl) because it runs `next build` inside a checkout. Each image carries exactly its own needs.
2. **Secrets discipline.** An image contains no secrets. They arrive at run time from the platform's secret manager. The image can be pushed to any registry without leaking a key.
3. **Promotion by SHA.** Every image is tagged with the git commit that built it. The image that passed CI is the byte-identical image that runs in production. Nothing is rebuilt between staging and production.

**Why not bare-metal or a raw Node server?** You would install Node on the server, `git pull`, `pnpm install`, `pnpm build`, and restart. Every one of those steps can produce a different result from CI. A missing system library surfaces at 2 a.m. on the server rather than in CI. Rollback means reversing all of them. With images, rollback is "run yesterday's tag".

---

## 2. Local multi-service orchestration (Docker Compose)

### 2.1 Docker vs Docker Compose

- **Docker** runs *one* container from one image: `docker run dp-learner`.
- **Docker Compose** reads a file (`docker-compose.yml`) describing *several* containers, their images or build recipes, their environment, their ports and their shared volumes, and starts them all with one command: `docker compose up`.

**Analogy: the blueprints binder for a food-truck court.** One truck (Docker) needs a power hookup and a water line. A court of three trucks (Compose) needs all of that planned together: which truck gets which bay, a shared water main, one electrical panel, and everything switched on at once with one master switch.

### 2.2 What this repository's `docker-compose.yml` actually does

Read it carefully, because it is **not** the textbook Compose file with a Postgres and a Redis service in it.

```yaml
name: dp

x-common: &common
  restart: unless-stopped
  extra_hosts:
    - "host.docker.internal:host-gateway"

services:
  learner:  # builds docker/next-app.Dockerfile with APP=learner, port 3000
  ops:      # builds docker/next-app.Dockerfile with APP=ops,     port 3001 -> 3000
  worker:   # builds docker/worker.Dockerfile, port 8080, a /workspace volume

volumes:
  worker-workspace: {}
```

Three things to understand:

**There is no database service in the Compose file.** The database is Supabase, which has its own local stack started with `supabase start` (from `pnpm db:start`). That stack is itself a set of Docker containers (Postgres 17, the Auth service, PostgREST, the Studio UI) managed by the Supabase CLI, which knows how to apply our migrations and mint local keys. Putting a bare Postgres in our Compose file would lose Auth and the RLS-aware API. So Compose runs *our three images* and points them at the Supabase stack running beside them.

**There is no Redis.** Rate limiting, the job queue, the embedding cache and the scheduler are all Postgres. There is nothing for a Redis container to do. If the project ever adds one (document 1 says when that would happen), this is the file it would be declared in.

**`host.docker.internal` is how the containers reach Supabase.** Inside a container, `localhost` is the container itself. The Supabase stack is on the *host* machine at port 54321. Docker provides the special hostname `host.docker.internal` for "the machine I am running on". The browser also has to resolve the Supabase URL (the publishable key and URL are inlined into the browser bundle), so the same hostname must work outside Docker too, which is why the file's comment says to add `127.0.0.1 host.docker.internal` to `/etc/hosts`.

Each service reads its secrets from a gitignored `apps/<app>/.env.docker`, copied from the app's `.env.example`. The build argument `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is required from the shell (`${SUPABASE_PUBLISHABLE_KEY:?...}` fails loudly if unset) because Next.js inlines `NEXT_PUBLIC_*` values at build time.

The worker service declares a **named volume** `worker-workspace` mounted at `/workspace`. A volume is disk that outlives the container. The coding worker clones the repository there at start, and the clone should survive a restart.

### 2.3 When to use Compose here, and when not to

**Use `pnpm dev`** (no containers) for everyday development. It runs all three deployables with hot reload against your local or linked Supabase.

**Use `pnpm docker:build && pnpm docker:up`** when you need to see the *production* images running together: checking a Dockerfile change, reproducing a container-only bug, confirming the health checks, or testing the worker's git checkout entrypoint.

---

## 3. Production orchestration (Kubernetes and Cloud Run)

### 3.1 The problem Compose does not solve

Compose runs containers on **one machine**. Production needs: several machines so one failure is not an outage; automatic restart of a crashed container; more copies when traffic rises and fewer when it falls; replacing containers with a new version without dropping requests; and one stable address in front of however many copies exist. That is **orchestration**.

### 3.2 Kubernetes vocabulary

| Term | Definition |
| --- | --- |
| **Cluster** | A set of machines managed as one unit. |
| **Node** | One machine in the cluster (a VM or a physical server). |
| **Pod** | The smallest unit Kubernetes schedules: one or more containers that share a network address and storage, always placed on the same node together. Usually one container per pod. |
| **Deployment** | A declaration: "I want N copies of this pod, from this image, with these resources." Kubernetes makes reality match, restarting pods that die and replacing pods when the image changes. |
| **Service** | A stable address and load balancer in front of a set of pods, so callers do not need to know which pods exist right now. |
| **Ingress** | The rule that maps a public hostname and path to a Service. |
| **Probes** | Health checks. A **startup probe** waits for the app to be ready before sending traffic. A **liveness probe** restarts a pod that stops answering. A **readiness probe** removes a pod from the load balancer without restarting it. |
| **Resource limits** | The CPU and memory a pod may use. A pod over its memory limit is killed and restarted. |
| **Horizontal Pod Autoscaler** | Adds and removes pods based on load. |
| **Secret** | A named value (an API key) injected into a pod as an environment variable, stored separately from the manifest. |
| **Rolling update** | Replacing pods one at a time with the new version, so some old and some new are serving at once and nothing drops. |

**Analogy: the harbour master and the automated cranes.** The harbour (cluster) has many berths (nodes). The harbour master (Kubernetes control plane) holds the schedule: "this ship line wants three containers of type A unloaded and running at all times". Cranes (the scheduler) place containers on whichever berth has room. If a container falls in the water (pod crash), a crane fetches another from the stack (the image) without anyone asking. When a new shipment of type A arrives (new image), the cranes swap containers one at a time so the line never stops (rolling update). Trucks arriving to collect goods (requests) are sent to the harbour's front gate (Service), not to a specific berth.

### 3.3 Why Kubernetes-style orchestration rather than Compose in production

| Need | Compose | Kubernetes / Cloud Run |
| --- | --- | --- |
| A machine dies | Everything on it is down until someone acts | Pods are rescheduled onto healthy nodes |
| A container crashes | `restart: unless-stopped` restarts it on the same machine | Restarted, and if it keeps failing the liveness probe, replaced |
| Traffic triples | Manual: edit the file, run `up --scale` | Autoscaling adds pods within seconds |
| New version | Stop old, start new: a gap | Rolling update, zero downtime, automatic rollback if the new pods fail their startup probe |
| One address for many copies | Not built in | Service and Ingress |
| Secrets | Files on the machine | A secret store, injected at run time, never on disk in the image |

### 3.4 What this repository actually deploys: Cloud Run

The four manifests in `deploy/cloudrun/` are **Knative `Service` objects**. Knative is a layer on Kubernetes that adds request-driven autoscaling (including to zero) and revision management. Cloud Run is Google's hosted Knative. Reading `learner.yaml`:

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: dp-learner
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "${MIN_INSTANCES}"   # 0 in staging: scales to zero when idle
        autoscaling.knative.dev/maxScale: "10"                 # never more than ten copies
    spec:
      containerConcurrency: 80          # requests one copy handles at once before another is added
      timeoutSeconds: 900               # the Trainer's 90-second loop fits comfortably
      containers:
        - image: ${IMAGE}
          resources:
            limits: { cpu: "1", memory: 1Gi }
          startupProbe:  { httpGet: { path: /api/health, port: 3000 }, periodSeconds: 2, failureThreshold: 15 }
          livenessProbe: { httpGet: { path: /api/health, port: 3000 }, periodSeconds: 30 }
          env:
            - name: SUPABASE_SECRET_KEY
              valueFrom: { secretKeyRef: { name: dp-${ENVIRONMENT}-supabase-secret-key, key: latest } }
```

Map it to the vocabulary: the `Service` plays the role of Deployment + Service + Ingress together; `containerConcurrency` and `maxScale` are the autoscaler; the probes are the probes; `resources.limits` are the limits; `secretKeyRef` is a Secret. The `${...}` placeholders are filled by `envsubst` in the deploy workflow.

The four services differ in ways that reveal the architecture:

| Service | min / max | Concurrency | CPU / memory | Ingress | Why |
| --- | --- | --- | --- | --- | --- |
| `dp-learner` | 0 or 1 / 10 | 80 | 1 / 1Gi | public | Stateless web. Many copies, cheap ones. |
| `dp-ops` | 0 or 1 / 3 | 40 | 1 / 1Gi | public | A handful of operators. |
| `dp-worker` | 1 / 1 | 1 | 1 / 1Gi | internal | Always on, never scaled by traffic (it receives none). `cpu-throttling: false` so it keeps polling between requests. Health only. |
| `dp-worker-coder` | 1 / 1 | 1 | 4 / 8Gi | internal | Runs `next build` and the test suite inside a git worktree. `/workspace` is a 4 GiB in-memory volume. Lock held for 45 minutes. |

The two worker services run **the same image** with different environment. That is the queue split from document 1: `WORKER_QUEUES=jobs` vs `WORKER_QUEUES=coder`, and only the coder has `GITHUB_TOKEN`.

### 3.5 Why Cloud Run and not a self-managed Kubernetes cluster

- **Nobody is on call for a cluster.** A small team should not run a control plane, upgrade nodes, patch the operating system, or debug a networking plugin. Cloud Run does that.
- **Scale to zero.** Staging costs nothing when nobody is using it. A Kubernetes node pool has a minimum size.
- **The manifests are portable.** The comment in `deploy-apps.yml` says it: Fly.io is `flyctl deploy --image`; Kubernetes is `kubectl set image`. The images are standard, the health endpoints are standard, and the secrets come from the environment. Moving to a cluster later is a manifest change, not a code change.
- **What we give up:** custom networking, sidecars, persistent disks for the worker's checkout (hence the in-memory volume that re-clones on start), and the ability to run things Cloud Run's request model does not fit. None of those is needed yet.

### 3.6 Health checks in this codebase

Every image declares a `HEALTHCHECK` and every manifest a probe:

- Both Next apps answer `GET /api/health`.
- The worker answers `/healthz` (200 while the loop has polled within the last minute) and `/readyz` (also needs the last poll to have succeeded). A database blip makes the worker *unready* without getting it *restarted*, which is the right distinction: restarting would not fix the database.

### 3.7 The deploy pipeline, end to end

1. **CI** (`ci.yml`) verifies the affected packages, runs the security and database gates over the whole tree, runs Playwright against a production build, and builds all three images without pushing.
2. **Deploy database** (`deploy-db.yml`) runs when a migration file changes on `main`: `supabase db push`, behind the production environment's approval. Migrations go first and must be compatible with the app version still running while images roll (expand now, contract in a later release).
3. **Deploy apps** (`deploy-apps.yml`) runs after both. It asks turbo which deployables changed (`--dry-run=json`), builds only those, tags them `ghcr.io/<owner>/dp-<app>:<env>-<sha>`, mirrors to Artifact Registry (Cloud Run pulls from there, not from GitHub), fills the manifest with `envsubst`, runs `gcloud run services replace`, and shifts 100% of traffic to the new revision. Staging on every push to `main`; production is the same job behind a manual approval.

---

## 4. Turborepo containerisation strategy: multi-stage builds

### 4.1 The problem

A monorepo has one lockfile and fourteen packages. The naive Dockerfile copies the whole repository, runs `pnpm install` for everything, builds one app, and ships an image containing the other two apps' source, every dev dependency, and the test suites. It is huge, and a change to the worker invalidates the learner's cached layers so every build starts from scratch.

### 4.2 Multi-stage builds

A **multi-stage build** is a Dockerfile with several `FROM` lines. Each `FROM` starts a new stage; a later stage can `COPY --from=` an earlier one and take *only* what it needs. Only the final stage becomes the image. Everything else is thrown away.

**Analogy:** a professional kitchen's prep line. One station washes and chops (prune), one measures out exactly the ingredients the recipe needs (deps), one cooks (build), and the plate that leaves the pass (runner) carries the dish and nothing else: no peelings, no measuring jugs, no recipe book.

### 4.3 `docker/next-app.Dockerfile`, stage by stage

One Dockerfile serves both Next apps; `--build-arg APP=learner` or `APP=ops` selects which.

```
1. pruner    node:22-alpine  + turbo        turbo prune @dp/${APP} --docker
2. deps      node:22-alpine  + pnpm         pnpm fetch, then pnpm install --frozen-lockfile --offline
3. builder   FROM deps                      copy full pruned source; pnpm turbo run build --filter=@dp/${APP}
4. prod-deps FROM deps                      pnpm install --prod   (devDependencies removed)
5. runner    node:22-alpine, non-root       prod node_modules + source + .next; next start
```

**Stage 1, prune.** `turbo prune @dp/learner --docker` reads the dependency graph and writes `out/` with three things: a `pnpm-lock.yaml` **trimmed to only the packages the learner needs**, `out/json/` (just the `package.json` files, for installing), and `out/full/` (the source). The learner does not depend on `@dp/product-ops` or `@dp/corpus`, so they are simply absent from the image.

**Stage 2, deps.** Copies *only* the lockfile and the `package.json` files, then installs. Because this layer depends on nothing but manifests, editing a `.ts` file does not invalidate it. Two details worth knowing: `pnpm fetch` downloads packages by lockfile alone into a **BuildKit cache mount** (`--mount=type=cache,id=pnpm-store`) that persists across builds on the same machine, so a rebuild downloads nothing; and `ENV CI=true` because without a TTY pnpm refuses to replace a `node_modules` it finds.

**Stage 3, builder.** Now copies the full pruned source and builds just this app with turbo. `NEXT_PUBLIC_*` values are passed as build args and inlined into the browser bundle here, which is why an image is built **per environment** and promoted by git SHA rather than by digest. `.next/cache` is deleted because it is a build accelerator, not a runtime asset.

**Stage 4, prod-deps.** The same pruned manifests, installed with `--prod`. TypeScript, Vitest, ESLint, Playwright: gone.

**Stage 5, runner.** A fresh Alpine base with `curl` (for the health check). Copies the production `node_modules`, the pruned source, and the `.next` output, all `--chown=node:node`. Switches to `USER node` so the process does not run as root. Declares the health check. The command is `node node_modules/next/dist/bin/next start -H 0.0.0.0`: **no pnpm at run time**, because pnpm is a build tool.

### 4.4 `docker/worker.Dockerfile`

Three stages (prune, deps with `--prod`, runner) on **Debian bookworm-slim rather than Alpine**. Alpine uses the musl C library; the coding worker runs the checkout's own `pnpm typecheck|lint|test|build` inside a worktree, and native dependencies trip on musl. The worker itself runs from TypeScript source via `tsx`, so there is no build stage.

The runner installs `git`, `tini` (a tiny init process that forwards signals correctly so `SIGTERM` reaches Node and the graceful stop in `loop.ts` runs), sets `GIT_ASKPASS=/usr/local/bin/git-askpass` so the GitHub token is printed from the environment when git asks and never appears in a URL, `.git/config` or `argv`, and caps memory with `NODE_OPTIONS=--max-old-space-size=3072` for every child process.

**The entrypoint** (`worker-entrypoint.sh`) clones or refreshes the repository at *start*, never at build: the token is a runtime secret, and a checkout baked into a layer is a checkout in every registry that ever holds the image. It only does this when `coder` is in `WORKER_QUEUES`.

### 4.5 Image size and cache, in practice

- A change to `apps/worker/src/loop.ts` rebuilds only the worker's stages after `deps`. The learner's and ops's layers are untouched. CI proves this with per-image `cache-from: type=gha,scope=<name>`.
- A change to `pnpm-lock.yaml` invalidates every `deps` stage, as it should.
- The `.dockerignore` keeps `node_modules`, `.next`, `.turbo`, `.git`, `docs`, `.claude`, every `.env*` except `.env.example`, and the Python virtualenv out of the build context, so the first `COPY . .` is small and can never carry a secret.

### 4.6 Building locally

```bash
# From the repository root, always.
docker build -f docker/next-app.Dockerfile --build-arg APP=learner \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:54321 \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
  --build-arg GIT_SHA=$(git rev-parse HEAD) -t dp-learner .

docker build -f docker/worker.Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t dp-worker .
```

Or let Compose do it: `pnpm docker:build` then `pnpm docker:up`, with `SUPABASE_PUBLISHABLE_KEY` exported from `supabase status -o env`.
