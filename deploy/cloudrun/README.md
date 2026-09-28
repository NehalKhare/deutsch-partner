# Cloud Run manifests

One Knative service per deployable, rendered with `envsubst` by the deploy
workflow. Secrets are referenced from Secret Manager, never written here; each
service account has `secretmanager.secretAccessor` on exactly the secrets its
manifest names, so the boundary the env schemas draw is enforced by IAM too:

| Service | Secrets |
| --- | --- |
| dp-learner | supabase-secret-key, openrouter-api-key, log-pseudonym-salt, langsmith-api-key, stripe-secret-key, stripe-webhook-secret |
| dp-ops | supabase-secret-key, log-pseudonym-salt, operator-user-ids |
| dp-worker | supabase-secret-key, openrouter-api-key, log-pseudonym-salt, langsmith-api-key |
| dp-worker-coder | the worker's, plus github-token |

`log-pseudonym-salt` is one secret bound to all four. A different salt per
service would hash one learner four ways, and nothing would join.

The two Stripe secrets are dp-learner's and nobody else's: the operator app
refuses them at boot, and the worker has no use for one until a
reconciliation job exists (`.claude/docs/billing-and-plans-spec.md` S12). Both
must exist in Secret Manager before dp-learner deploys, because Cloud Run
refuses a revision that references a missing secret. Until payments are
switched on, give each a single space as its value: the env schema reads a
blank value as unset, which is payments off. Set them together — the schema
refuses one without the other — and use test-mode keys until the consumer-law
pages are live. `STRIPE_AUTOMATIC_TAX` is a plain value from the environment's
`vars`, off unless set.

The worker runs at exactly one instance with the scheduler on; the coder runs at
one instance because a `next build` inside a worktree wants the whole machine.
In production pin `key: "<version>"` rather than `latest` so a rotation is a
deliberate deploy.

Fly.io: one `fly.toml` per app, `min_machines_running = 1` for learner and the
workers, the workers as `[processes]` with no `http_service`, a volume for the
coder checkout. Kubernetes (GKE Autopilot) is built: see `deploy/k8s/README.md`.
