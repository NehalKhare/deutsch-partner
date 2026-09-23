# Cloud Run manifests

One Knative service per deployable, rendered with `envsubst` by the deploy
workflow. Secrets are referenced from Secret Manager, never written here; each
service account has `secretmanager.secretAccessor` on exactly the secrets its
manifest names, so the boundary the env schemas draw is enforced by IAM too:

| Service | Secrets |
| --- | --- |
| dp-learner | supabase-secret-key, openrouter-api-key, log-pseudonym-salt, langsmith-api-key |
| dp-ops | supabase-secret-key, log-pseudonym-salt, operator-user-ids |
| dp-worker | supabase-secret-key, openrouter-api-key, log-pseudonym-salt, langsmith-api-key |
| dp-worker-coder | the worker's, plus github-token |

`log-pseudonym-salt` is one secret bound to all four. A different salt per
service would hash one learner four ways, and nothing would join.

The worker runs at exactly one instance with the scheduler on; the coder runs at
one instance because a `next build` inside a worktree wants the whole machine.
In production pin `key: "<version>"` rather than `latest` so a rotation is a
deliberate deploy.

Fly.io: one `fly.toml` per app, `min_machines_running = 1` for learner and the
workers, the workers as `[processes]` with no `http_service`, a volume for the
coder checkout. Kubernetes: Deployments with an HPA for the two Next apps behind
an Ingress with a 900 s read timeout, one-replica Deployments for the workers,
ExternalSecrets, the same probe paths, a PVC for the checkout.
