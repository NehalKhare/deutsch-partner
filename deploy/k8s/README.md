# Deploying Deutsch Partner on Kubernetes (Google GKE Autopilot)

This guide takes you from nothing to the app running on the public internet,
where anyone with the link can use it. No Kubernetes experience is assumed.
Commands are run from the repository root on your Mac.

## What you end up with

- **`https://learner.<your-domain>`**: the learner app, which is what your friends use.
- **`https://ops.<your-domain>`**: the operator app, which only accounts on the allowlist can sign in to.
- **A worker** running inside the cluster with no public address. It processes background jobs.
- **Your existing Supabase project** stays the database. Nothing about it moves.

Google runs the servers underneath. With Autopilot you never create or patch a
machine: you say what each program needs, and Google finds room for it.

## A few words you will see

| Word | What it means here |
| --- | --- |
| **Cluster** | The group of Google machines that runs your containers. |
| **Pod** | One running copy of one program, such as one learner. |
| **Deployment** | The instruction "keep N copies of this program running, and replace them when the image changes". |
| **Service** | A stable internal address for a Deployment's pods. |
| **Ingress** | The public front door. On GKE it creates a Google load balancer with HTTPS. |
| **ConfigMap / Secret** | Settings handed to a program as environment variables. Secrets are the private ones. |
| **`kubectl`** | The command-line tool that talks to the cluster. |
| **Kustomize** | Built into `kubectl`. It assembles the files in this folder into what the cluster receives. |

## How this folder is laid out

```
deploy/k8s/
├── base/                 the three programs, with nothing Google-specific
│   ├── learner.yaml      Deployment + Service for the learner app
│   ├── ops.yaml          Deployment + Service for the operator app
│   ├── worker.yaml       Deployment for the queue worker
│   ├── hpa.yaml          autoscaling for the two web apps
│   └── config/*.env      non-secret settings, one file per program
├── components/coder/     the optional coding worker, off by default
└── overlays/gke/         the Google pieces: load balancer, HTTPS, timeouts
    ├── site.env.example  your hostnames and image names: copy to site.env
    └── secrets/          templates for the secrets: copy each to *.env
```

`site.env` and `secrets/*.env` are ignored by git, so your real values never
get committed.

## What it costs

Kubernetes on Google is billed every hour it runs, whether or not anyone uses
the app. With the defaults here expect **roughly $80 to $100 a month**:

- Autopilot bills for the CPU and memory each pod asks for. The defaults ask
  for about 1.75 vCPU and 4 GiB in total, which is around $70 a month.
- The load balancer is around $18 a month.
- The cluster's own management fee is covered by Google's free tier for one
  Autopilot cluster per billing account.

Prices vary by region and change over time. Check the
[Google Cloud pricing calculator](https://cloud.google.com/products/calculator)
for your region. The coding worker, if you switch it on, adds more than
$150 a month because it reserves 4 vCPU and 8 GiB. OpenRouter and Supabase bill
you separately, as they do today.

To stop paying, delete the cluster and release the IP (see "Stopping and
deleting" below).

---

## Step 1. Install the tools

You need Docker Desktop, `kubectl` and the Google Cloud CLI.

```sh
# Docker Desktop: install from https://www.docker.com/products/docker-desktop/
# It also installs kubectl.

brew install --cask google-cloud-sdk
gcloud components install gke-gcloud-auth-plugin
```

Check that they work:

```sh
docker version
kubectl version --client
gcloud version
```

## Step 2. Set up a Google Cloud project

Create a project at <https://console.cloud.google.com/> and turn on billing for
it. Then sign in from the terminal and set a few variables. The rest of the
guide uses these variables, so keep this terminal open. If you open a new one,
set them again.

```sh
gcloud auth login

export PROJECT=your-project-id          # from the Cloud console
export REGION=europe-west1              # pick a region near your users
export DOMAIN=example.com               # a domain you control
export REGISTRY=$REGION-docker.pkg.dev/$PROJECT/dp

gcloud config set project $PROJECT
```

Turn on the Google services this needs:

```sh
gcloud services enable container.googleapis.com artifactregistry.googleapis.com compute.googleapis.com
```

## Step 3. Create a place to store your images

The cluster downloads your containers from Artifact Registry.

```sh
gcloud artifacts repositories create dp --repository-format=docker --location=$REGION
```

Let the cluster's machines download from it. New projects no longer grant this
automatically:

```sh
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud artifacts repositories add-iam-policy-binding dp --location=$REGION \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/artifactregistry.reader
```

## Step 4. Create the cluster

This takes about 10 minutes.

```sh
gcloud container clusters create-auto dp --region=$REGION
gcloud container clusters get-credentials dp --region=$REGION
kubectl get nodes    # any answer, even "No resources found", means you are connected
```

## Step 5. Reserve a public IP address

The load balancer needs an address that never changes, so your domain can
point at it.

```sh
gcloud compute addresses create dp-ip --global
gcloud compute addresses describe dp-ip --global --format='value(address)'
```

Write down the address the second command prints.

## Step 6. Point your domain at it

At your domain provider, create two **A records** pointing at that address:

| Name | Type | Value |
| --- | --- | --- |
| `learner` | A | the IP from step 5 |
| `ops` | A | the IP from step 5 |

Check them. It can take a few minutes, and occasionally hours, before both
answer with your IP:

```sh
dig +short learner.$DOMAIN
dig +short ops.$DOMAIN
```

Google will not issue the HTTPS certificate until both names resolve to the IP.

> **No domain?** You can use `learner.<ip>.sslip.io` and `ops.<ip>.sslip.io`,
> which resolve to the IP without any setup. Google's certificate issuance for
> shared domains like this is not guaranteed, so treat it as a stopgap and buy
> a domain for anything you share widely.

## Step 7. Tell Supabase about the new addresses

In the Supabase dashboard for your project:

1. **Authentication → URL Configuration.** Set **Site URL** to
   `https://learner.<your-domain>`. Under **Redirect URLs**, add
   `https://learner.<your-domain>/**` and `https://ops.<your-domain>/**`.
2. **Authentication → Multi-Factor.** Make sure **TOTP** is enabled. The
   operator app requires it.

Without the first step, sign-in emails and redirects send people to the wrong
place.

## Step 8. Build and upload the images

The two web apps have your **public** Supabase URL and publishable key baked in
when they are built. Both values are safe to share, and they are the same ones in
your `apps/learner/.env.local`.

```sh
export NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
export TAG=v1

gcloud auth configure-docker $REGION-docker.pkg.dev

for APP in learner ops; do
  docker buildx build --platform linux/amd64 \
    -f docker/next-app.Dockerfile \
    --build-arg APP=$APP \
    --build-arg NEXT_PUBLIC_SUPABASE_URL \
    --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    -t $REGISTRY/dp-$APP:$TAG --push .
done

docker buildx build --platform linux/amd64 \
  -f docker/worker.Dockerfile \
  -t $REGISTRY/dp-worker:$TAG --push .
```

`--platform linux/amd64` matters on an Apple-silicon Mac. Google's machines
use a different processor type, and an image built for your Mac will not start
there. On an Apple-silicon Mac the first build is slow, often 20 to 40 minutes,
because Docker emulates the other processor. Later builds reuse most of the
work. Once the GitHub workflow is set up (see "Deploying from GitHub"), GitHub
builds the images for you instead.

## Step 9. Fill in your site settings

```sh
cp deploy/k8s/overlays/gke/site.env.example deploy/k8s/overlays/gke/site.env
```

Open `deploy/k8s/overlays/gke/site.env` and set:

- `LEARNER_HOST` and `OPS_HOST` to `learner.<your-domain>` and `ops.<your-domain>`.
- The three `*_IMAGE` lines to what you pushed, for example
  `europe-west1-docker.pkg.dev/your-project-id/dp/dp-learner:v1`.
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the same two values as in
  step 8. The apps check them again when they start.

Leave `STATIC_IP_NAME=dp-ip` unless you chose a different name in step 5.

## Step 10. Create the secrets

Each program gets its own secrets and nothing else's. In particular, the
operator app never receives the AI model key: it would refuse to start if it
did.

```sh
cd deploy/k8s/overlays/gke/secrets
cp learner.env.example learner.env
cp ops.env.example ops.env
cp worker.env.example worker.env
cd -
```

Fill in the three `.env` files, using the same values as your local
`.env.local` files:

- `SUPABASE_SECRET_KEY` starts `sb_secret_`.
- `OPENROUTER_API_KEY` goes in the learner and worker files only.
- `LOG_PSEUDONYM_SALT` must be **identical in all three**. If you do not have
  one yet, make one with `openssl rand -hex 32`.
- `OPERATOR_USER_IDS` goes in the ops file only. It is a comma-separated list
  of the Supabase user ids allowed into the operator app.

Then create the namespace and hand the secrets to the cluster:

```sh
kubectl apply -f deploy/k8s/base/namespace.yaml

for APP in learner ops worker; do
  kubectl -n deutsch-partner create secret generic $APP-secrets \
    --from-env-file=deploy/k8s/overlays/gke/secrets/$APP.env
done
```

## Step 11. Deploy

```sh
kubectl apply -k deploy/k8s/overlays/gke
```

Watch the pods start. Press Ctrl-C when all show `Running` and `1/1` ready:

```sh
kubectl -n deutsch-partner get pods -w
```

## Step 12. Wait for HTTPS

The load balancer and certificate take a while the first time, usually 15 to
60 minutes. Check progress with:

```sh
kubectl -n deutsch-partner get ingress dp                     # ADDRESS should show your IP
kubectl -n deutsch-partner describe managedcertificate dp-cert  # wait for Status: Active
```

Until the certificate is `Active`, the HTTPS address will not work, and plain
HTTP may show a 404 or a 502. That is normal.

When it is active:

```sh
curl https://learner.$DOMAIN/api/health
curl https://ops.$DOMAIN/api/health
```

Both should answer `{"ok":true,...}`.

## Step 13. Check it end to end, then share it

1. Open `https://learner.<your-domain>` on your phone **with Wi-Fi off**. That
   proves it is reachable from outside your network.
2. Sign in and have a conversation with the trainer that runs past a minute,
   to confirm long replies are not cut off.
3. Sign in to `https://ops.<your-domain>` with an allowlisted account and your
   authenticator app.
4. Currency conversion starts from a scheduled job in the database that runs
   every hour. To run it right away:

   ```sh
   kubectl -n deutsch-partner exec deploy/worker -- node_modules/.bin/tsx src/cli/fx-refresh.ts
   ```

Now send your friends the learner link.

---

## Day-to-day operations

**See what is running**

```sh
kubectl -n deutsch-partner get pods
```

**Read a program's logs**

```sh
kubectl -n deutsch-partner logs deploy/learner -f     # or ops, worker
```

**Ship a new version**

Build and push with a new tag (step 8, with `TAG=v2`). Update the three image
lines in `site.env`, then apply again:

```sh
kubectl apply -k deploy/k8s/overlays/gke
```

Kubernetes replaces the pods one at a time, so the app stays up.

**Roll back**

Put the previous tag back in `site.env` and apply again. For an immediate undo
while you work that out:

```sh
kubectl -n deutsch-partner rollout undo deploy/learner
```

`rollout undo` only lasts until the next apply, so fix `site.env` too.

**Change a secret**

Edit the `.env` file, replace the Secret, and restart the program so it picks
up the new value:

```sh
kubectl -n deutsch-partner create secret generic learner-secrets \
  --from-env-file=deploy/k8s/overlays/gke/secrets/learner.env \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n deutsch-partner rollout restart deploy/learner
```

**Change a setting**

Edit the file in `base/config/`, then apply. A changed settings file restarts
the program that uses it automatically.

**Scaling**

The learner app runs 2 to 10 copies and the operator app 1 to 3. Both scale on
CPU by themselves. To change the limits, edit `base/hpa.yaml` and apply. With
only a few friends using it, setting the learner's `minReplicas` to 1 roughly
halves its share of the bill, at the cost of a brief gap if that one pod
restarts.

## Stopping and deleting

To delete everything and stop the bill:

```sh
gcloud container clusters delete dp --region=$REGION
gcloud compute addresses delete dp-ip --global
```

Your images stay in Artifact Registry, which costs very little. Delete the `dp`
repository there too if you want nothing left.

---

## Optional: the coding worker

The operator app can ask a coding agent to implement a proposal and open a pull
request. That work runs on a separate worker that clones this repository. It
is off by default because it needs a GitHub token and costs the most.

1. Create a fine-grained GitHub token for this one repository, with read and
   write access to contents and pull requests.
2. Copy `secrets/coder.env.example` to `secrets/coder.env`, paste the token,
   and create the Secret:

   ```sh
   kubectl -n deutsch-partner create secret generic coder-secrets \
     --from-env-file=deploy/k8s/overlays/gke/secrets/coder.env
   ```

3. Set `GITHUB_REPOSITORY=owner/repo` in `site.env`.
4. In `overlays/gke/kustomization.yaml`, uncomment the two `components` lines.
5. Run `kubectl apply -k deploy/k8s/overlays/gke`. The coder takes several
   minutes to start because it clones and installs the repository first.

The ordinary worker has no checkout. A planning stage it picks up fails with
`no_repository`, so switch the coder on before relying on the operator app's
planning features.

## Optional: deploying from GitHub

`.github/workflows/deploy-gke.yml` builds the images on GitHub and deploys
them, so your Mac doesn't have to. It runs only when you start it from the
Actions tab.

It reuses the Google sign-in the Cloud Run workflow already uses: the
`GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOYER_SA` variables. If you have
not set those up yet, follow Google's guide for "Workload Identity Federation
with GitHub Actions" first. Then:

1. Give the deployer service account `roles/container.developer` on the
   project, and `roles/artifactregistry.writer` on the `dp` repository.
2. In the GitHub repository, under Settings → Environments → production, add
   these variables: `GCP_PROJECT`, `GCP_REGION`, `LEARNER_HOST`, `OPS_HOST`,
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   `GKE_CLUSTER`, `GKE_LOCATION` and `GKE_STATIC_IP_NAME` are optional and
   default to `dp`, your region and `dp-ip`.
3. Actions → "Deploy to GKE" → Run workflow.

Secrets stay in the cluster where you created them in step 10. The workflow
never sees them.

## Later improvements

- **Smaller images.** Switching both Next apps to `output: "standalone"` would
  roughly halve their size and speed up every rollout. See docs/deployment.md.
- **Secret Manager.** Keeping secrets in Google Secret Manager, synced into the
  cluster by the External Secrets Operator, gives you rotation and an audit
  trail instead of `.env` files on your Mac.
- **Staging.** A second cluster, or a second namespace with its own hostnames,
  lets you try a release before your friends see it.

---

## Troubleshooting

Start with the pod's status and its most recent events:

```sh
kubectl -n deutsch-partner get pods
kubectl -n deutsch-partner describe pod <pod-name>     # the Events section at the bottom
kubectl -n deutsch-partner logs <pod-name> --previous  # logs from the last crash
```

| What you see | What it usually means |
| --- | --- |
| `ImagePullBackOff` or `ErrImagePull` | The image name or tag in `site.env` is wrong, or step 3's permission is missing. Run `docker manifest inspect <image>` to check the image exists. |
| `exec format error` in the logs | The image was built without `--platform linux/amd64`. Rebuild it with that flag. |
| `CreateContainerConfigError` | A Secret is missing. Check `kubectl -n deutsch-partner get secrets` shows `learner-secrets`, `ops-secrets` and `worker-secrets`. |
| `CrashLoopBackOff` | The program started and exited. The logs name the missing or invalid setting, for example `SUPABASE_SECRET_KEY: is required in production`. |
| The operator app will not start and mentions a model key | `OPENROUTER_API_KEY` got into `ops.env`. Remove it and replace the Secret. |
| `Pending` for a long time | Autopilot is adding a machine, which can take a few minutes. `describe pod` shows why if it takes longer. |
| Certificate stuck on `Provisioning` | DNS for one of the two names does not point at the IP yet. Check with `dig +short`. |
| 502 errors right after deploying | The load balancer's health checks are still warming up. Give it 5 to 10 minutes. |
| Trainer replies cut off after 30 seconds | The long timeout is not attached. Check that `kubectl -n deutsch-partner get svc learner -o yaml` shows the `cloud.google.com/backend-config` annotation. |
| Sign-in redirects to localhost or fails | Step 7 was missed. The Supabase Site URL and redirect URLs must include your new hostnames. |
