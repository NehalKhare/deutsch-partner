# Deployment

Three containers, one database, one repository.

| Deployable | Image | What it is | Holds |
| --- | --- | --- | --- |
| `@dp/learner` | `docker/next-app.Dockerfile` (`APP=learner`) | The learner product. Its own route handlers call the model gateway for chat, the trainer and embeddings. | Supabase secret key, OpenRouter key, pseudonym salt |
| `@dp/ops` | `docker/next-app.Dockerfile` (`APP=ops`) | The operator product on its own origin: product-ops board, runs, AI spend. Own sign-in with a TOTP second factor. Enqueues work; runs no stage. | Supabase secret key, pseudonym salt, operator allowlist |
| `@dp/worker` | `docker/worker.Dockerfile` | Drains the `ops_jobs` queue: product-ops stages, FX and pricing snapshots, checkpoint pruning, ingestion. A second instance of the same image drains the `coder` queue with a checkout and the repository token. | Supabase secret key, OpenRouter key, pseudonym salt; the coder alone holds the GitHub token |
| the database | `packages/db/supabase/migrations` | One Supabase project. Migrations deploy first and are forward-only. | — |

`LOG_PSEUDONYM_SALT` must be the same value in all three containers. A
different salt per process hashes one learner three ways, and the ledger, the
audit trail and the dashboard stop joining.

## Images

Build from the repository root. `turbo prune` cuts the workspace to what the
app depends on, so a change to the worker never rebuilds the learner's
dependency layer.

```bash
docker build -f docker/next-app.Dockerfile --build-arg APP=learner \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
  --build-arg GIT_SHA=$(git rev-parse HEAD) -t dp-learner .
docker build -f docker/next-app.Dockerfile --build-arg APP=ops ... -t dp-ops .
docker build -f docker/worker.Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t dp-worker .
```

The two `NEXT_PUBLIC_*` values are inlined into the Next.js bundles at build
time, so a Next image is built per environment and promoted by git sha, not by
digest. The worker image carries no public key: it serves no browser.

Built and smoke-tested locally on 2026-09-23: each image boots, answers its
health check within seconds and honours SIGTERM. They are large — roughly
1.7 GB (learner), 1.5 GB (ops) and 1.3 GB (worker) uncompressed — because the
Next images carry a full production `node_modules` for `next start`. Switching
the two Next apps to `output: "standalone"` (with `outputFileTracingRoot` at the
workspace root) is the first optimisation to make and should roughly halve
them. The install stages set `CI=true` because pnpm refuses to replace a
modules directory without a TTY otherwise.

The worker image runs from TypeScript source through `tsx`. Inside `apps/worker/src`
imports are relative on purpose: the production image has no `@dp/config`, so
the worker's tsconfig — and any path alias in it — is not available at runtime. When it serves the
`coder` queue, its entrypoint clones the repository at start — never at build,
because the token is a runtime secret and a checkout baked into a layer is a
checkout in every registry that ever holds the image — and installs the
checkout's own toolchain so the coding agent's `pnpm typecheck|lint|test|build`
resolve inside a worktree. Git reads the token through `GIT_ASKPASS`; it never
appears in a URL, a config file or argv.

## Locally

```bash
supabase start                       # from packages/db, once
supabase status -o env               # the local keys; the schema refuses legacy eyJ keys
pnpm dev                             # learner on :3000, ops on :3001, worker polling
```

`docker compose up` runs the production images instead, against the same local
Supabase. The browser and the containers must both resolve the Supabase URL, so
add `127.0.0.1 host.docker.internal` to `/etc/hosts` and copy each app's
`.env.example` to `.env.docker`.

## Pipelines

| Workflow | When | What |
| --- | --- | --- |
| `ci.yml` | every push and pull request | `turbo run typecheck lint test build` for the packages the commit touched, the security tests and the database tests always, Playwright against a production build, every image built and not pushed |
| `deploy-db.yml` | push to `main` touching `packages/db/supabase/**` | `supabase db push` to the linked project, then the advisors |
| `deploy-apps.yml` | after CI and the database workflow on `main`; by hand for production | build and push the images whose packages changed to GHCR by sha, mirror to Artifact Registry, `gcloud run services replace` from `deploy/cloudrun/*.yaml` |

Staging deploys on every green `main`; production is the same job behind the
`production` environment's required reviewers. Rollback is
`gcloud run services update-traffic --to-revisions=<previous>=100`; migrations
are forward-only, so every migration must be compatible with the revision still
running while images roll (expand first, contract in a later release).

Repository variables the deploy expects: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `LEARNER_APP_URL`, `OPS_APP_URL`,
`SUPABASE_PROJECT_REF`, `GCP_PROJECT`, `GCP_REGION`,
`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOYER_SA`, `MIN_INSTANCES`,
`LANGSMITH_TRACING`. Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`.
Everything a container reads at runtime comes from Secret Manager through the
manifests, never from the workflow. The one non-secret the workflow decides
itself is `SEO_INDEXING`: `true` for the `production` environment and
`false` for every other, so only production is ever indexed
(`docs/seo-and-geo.md`).

## Cloud Run

`deploy/cloudrun/` holds one manifest per service, rendered with `envsubst`.
Each service account may read exactly the secrets its manifest names, so the
boundary the environment schemas draw is enforced by IAM as well. The learner
app runs with a request timeout of 900 s (the trainer's loop can take 120 s,
the runs feed streams for 270 s); the worker runs at exactly one instance with
CPU always allocated, because it polls rather than serves; the coder runs at
one instance with 4 vCPU and 8 GiB, because a `next build` inside a worktree
wants a machine. A Fly.io equivalent is noted in `deploy/cloudrun/README.md`.

## Kubernetes on GKE

`deploy/k8s/` runs the learner and worker images on a GKE Autopilot cluster, as
an alternative to Cloud Run. The operator app is not deployed there: it is
Cloud Run only, so a GKE installation has no `/ops` origin and needs no
`OPERATOR_USER_IDS`. It is Kustomize: `base/` holds a Deployment per
deployable with the Cloud Run sizing and probe paths, `components/coder/` the
optional coding worker, and `overlays/gke/` a Google load balancer with a
managed certificate, a 900 s backend timeout and an HTTP-to-HTTPS redirect.
Per-installation values (hostnames, image tags, the public Supabase values)
come from a gitignored `site.env`. Secrets are created in the cluster by hand,
one Secret per deployable, and `packages/security-tests/tests/kubernetes.test.ts`
holds the manifests and secret templates to the same split as the `.env.example`
files. As on Cloud Run, the schedules are pg_cron and the migrations run from
`deploy-db.yml`, so the cluster runs no CronJob and no migration Job.

`deploy/k8s/README.md` is the step-by-step guide, written for someone new to
Kubernetes. `.github/workflows/deploy-gke.yml` builds and deploys on manual
dispatch only, so it never races the Cloud Run pipeline.

## Going live with the split

1. **Database.** Push the migrations (the queue, the rate-limit buckets, the
   `queued` event). In the Supabase dashboard enable TOTP MFA and add the
   operator origin to the auth redirect allowlist.
2. **Worker.** Deploy `dp-worker` and `dp-worker-coder`. Enqueue an FX refresh
   by hand (`pnpm fx:refresh` from a machine with the secret key) and watch
   `fx.*` and `worker.*` log lines; `/healthz` answers 200.
3. **Ops.** Point `ops.<domain>` at `dp-ops`. Operators sign in with their
   existing account; the first sign-in enrols an authenticator, every later one
   asks for its code.
4. **Learner.** Deploy the release that no longer carries `/operations`. The
   previous revision still does, so a rollback restores it instantly; keep the
   learner's old operator secret binding until the release after.

## Runbooks

**A run sits at "queued".** No worker is claiming. Check `dp-worker`'s
`/readyz`, then `select status, count(*) from ops_jobs group by 1` and
`select * from ops_jobs where status = 'failed' order by finished_at desc`
(the dead letters; `last_error` is a code). The nudge button re-enqueues, and
the reconciler does the same for any server-owned run quiet for three minutes.

**An operator lost their authenticator.** In the Supabase dashboard,
Authentication → Users → the account → remove the TOTP factor; their next
sign-in enrols a new one. Confirm who is asking out of band first.

**A learner types their password into the operator app.** They are signed out
of that origin and shown the generic failure; `ops.login_denied` is logged
with their pseudonym. Nothing about the allowlist is disclosed.

**Rate limits deny everything.** The store is unreachable and the limiter
fails closed; look for `rate_limit.unavailable`. The learner and operator apps
share one quota per scope across every instance through `consume_rate_limit`.
