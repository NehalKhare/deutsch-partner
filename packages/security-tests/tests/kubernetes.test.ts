import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseAllDocuments } from "yaml";

import { REPO_ROOT, ROOTS, absolute, toPosix } from "../src/roots";

/**
 * What each deployable may hold, on Kubernetes.
 *
 * deployables.test.ts holds the committed .env.example templates to the
 * split. These hold the Kubernetes manifests to the same split: which Secret
 * each Deployment reads, what the secret templates list, and that no secret
 * or model id is written into a committed file.
 */

interface RepoFile {
  readonly path: string;
  readonly source: string;
}

function k8sFiles(): RepoFile[] {
  const found: RepoFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else found.push({ path: toPosix(relative(REPO_ROOT, full)), source: readFileSync(full, "utf8") });
    }
  };
  walk(absolute(ROOTS.kubernetes));
  return found;
}

const FILES = k8sFiles();
const SECRETS_DIR = `${ROOTS.kubernetes}/overlays/gke/secrets`;

/** `KEY=value` lines, and with `commented` also the `# KEY=` optional ones. */
function envEntries(source: string, commented = false): Array<{ key: string; value: string }> {
  const pattern = commented ? /^#?\s*([A-Z][A-Z0-9_]*)=(.*)$/ : /^([A-Z][A-Z0-9_]*)=(.*)$/;
  return source
    .split("\n")
    .map((line) => pattern.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ key: match[1]!, value: match[2]!.trim() }));
}

function keysOf(path: string, commented = false): string[] {
  return envEntries(readFileSync(absolute(path), "utf8"), commented).map((entry) => entry.key);
}

type Manifest = { kind?: string; metadata?: { name?: string }; spec?: unknown };

function manifests(): Manifest[] {
  return FILES.filter((file) => file.path.endsWith(".yaml")).flatMap((file) =>
    parseAllDocuments(file.source).map((doc) => {
      if (doc.errors.length > 0) throw new Error(`${file.path}: ${doc.errors[0]!.message}`);
      return doc.toJS() as Manifest;
    }),
  );
}

/** Every Secret or ConfigMap name a Deployment's pods can read. */
function references(deployment: Manifest, kind: "secret" | "configMap"): string[] {
  const names = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const ref = value as { name?: string; secretName?: string };
      if (key === `${kind}Ref` || key === `${kind}KeyRef`) names.add(ref.name!);
      else if (kind === "secret" && key === "secret") names.add(ref.secretName!);
      else if (kind === "configMap" && key === "configMap") names.add(ref.name!);
      visit(value);
    }
  };
  visit(deployment.spec);
  return [...names].sort();
}

/** Which Secret and ConfigMap each Deployment may read. A new one is a deliberate edit here. */
const ALLOWED = {
  learner: { secrets: ["learner-secrets"], configMaps: ["learner-config"] },
  ops: { secrets: ["ops-secrets"], configMaps: ["ops-config"] },
  worker: { secrets: ["worker-secrets"], configMaps: ["worker-config"] },
  "worker-coder": { secrets: ["coder-secrets", "worker-secrets"], configMaps: ["coder-config"] },
} as const;

/** Each secret template, and the deployable whose .env.example it must stay inside. */
const TEMPLATES = {
  learner: "apps/learner/.env.example",
  ops: "apps/ops/.env.example",
  worker: "apps/worker/.env.example",
  coder: "apps/worker/.env.example",
} as const;

const template = (name: keyof typeof TEMPLATES) => `${SECRETS_DIR}/${name}.env.example`;

const SECRET_NAMES = [
  "SUPABASE_SECRET_KEY",
  "OPENROUTER_API_KEY",
  "LOG_PSEUDONYM_SALT",
  "LANGSMITH_API_KEY",
  "MCP_SERVER_API_KEY",
  "GITHUB_TOKEN",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OPERATOR_USER_IDS",
];

const MODEL_KEYS = /^(OPENROUTER_MODEL_[A-Z]+|EMBEDDING_MODEL|SPEECH_TO_TEXT_MODEL|TEXT_TO_SPEECH_MODEL)$/;

/** Settings files that reach a ConfigMap: committed, non-secret, per app. */
const settingsFiles = () =>
  FILES.filter((file) => /\.env(\.example)?$/.test(file.path) && !file.path.startsWith(`${SECRETS_DIR}/`));

describe("the Kubernetes manifests", () => {
  const deployments = manifests().filter((doc) => doc.kind === "Deployment");

  it("find the Deployments to check", () => {
    expect(deployments.map((doc) => doc.metadata?.name).sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it.each(Object.entries(ALLOWED))("give %s only its own Secrets", (name, allowed) => {
    const deployment = deployments.find((doc) => doc.metadata?.name === name)!;
    expect(references(deployment, "secret")).toEqual([...allowed.secrets]);
  });

  it.each(Object.entries(ALLOWED))("give %s only its own ConfigMap", (name, allowed) => {
    const deployment = deployments.find((doc) => doc.metadata?.name === name)!;
    expect(references(deployment, "configMap")).toEqual([...allowed.configMaps]);
  });

  it("commit no Secret and generate none", () => {
    // Secrets are created in the cluster by hand. A generator here would put
    // a path to the real values in the build, and a Secret would put them in git.
    expect(manifests().filter((doc) => doc.kind === "Secret")).toEqual([]);
    const generators = FILES.filter((file) => /kustomization\.yaml$/.test(file.path))
      .filter((file) => /secretGenerator/.test(file.source))
      .map((file) => file.path);
    expect(generators).toEqual([]);
  });
});

describe("the secret templates", () => {
  it.each(Object.entries(TEMPLATES))("list for %s only names its .env.example declares", (name, example) => {
    const declared = keysOf(example);
    const extra = keysOf(template(name as keyof typeof TEMPLATES), true).filter((key) => !declared.includes(key));
    expect(extra).toEqual([]);
  });

  it("give the operator app no model key and no repository token", () => {
    const keys = keysOf(template("ops"), true);
    expect(keys).not.toContain("OPENROUTER_API_KEY");
    expect(keys).not.toContain("GITHUB_TOKEN");
    expect(keys).not.toContain("MCP_SERVER_API_KEY");
    expect(keys).toContain("OPERATOR_USER_IDS");
  });

  it("give the allowlist to the operator app alone", () => {
    for (const name of ["learner", "worker", "coder"] as const) {
      expect(keysOf(template(name), true), name).not.toContain("OPERATOR_USER_IDS");
    }
  });

  it("give the repository token to the coder alone", () => {
    for (const name of ["learner", "ops", "worker"] as const) {
      expect(keysOf(template(name), true), name).not.toContain("GITHUB_TOKEN");
    }
    expect(keysOf(template("coder"))).toContain("GITHUB_TOKEN");
  });

  it("carry the salt for every deployable, because pseudonyms must join", () => {
    for (const name of ["learner", "ops", "worker"] as const) {
      expect(keysOf(template(name)), name).toContain("LOG_PSEUDONYM_SALT");
    }
  });

  it("hold names and never values", () => {
    for (const name of Object.keys(TEMPLATES) as Array<keyof typeof TEMPLATES>) {
      const filled = envEntries(readFileSync(absolute(template(name)), "utf8"), true)
        .filter((entry) => entry.value !== "")
        .map((entry) => entry.key);
      expect(filled, name).toEqual([]);
    }
  });
});

describe("the settings files", () => {
  it("find the settings files to check", () => {
    expect(settingsFiles().length).toBeGreaterThan(0);
  });

  it("name no secret, since they become ConfigMaps", () => {
    const offenders = settingsFiles().flatMap((file) =>
      envEntries(file.source, true)
        .filter((entry) => SECRET_NAMES.includes(entry.key))
        .map((entry) => `${file.path}: ${entry.key}`),
    );
    expect(offenders).toEqual([]);
  });

  it("name no model, so a tier stays the only thing configuration picks", () => {
    const offenders = settingsFiles().flatMap((file) =>
      envEntries(file.source, true)
        .filter((entry) => MODEL_KEYS.test(entry.key))
        .map((entry) => `${file.path}: ${entry.key}`),
    );
    expect(offenders).toEqual([]);
  });

  it("run every app in production mode, where the env schemas require their secrets", () => {
    const configs = settingsFiles().filter((file) => /\/(config|components\/coder)\/[^/]+\.env$/.test(file.path));
    expect(configs.length).toBeGreaterThanOrEqual(4);
    for (const file of configs) {
      expect(envEntries(file.source), file.path).toContainEqual({ key: "NODE_ENV", value: "production" });
    }
  });
});

describe("every committed Kubernetes file", () => {
  it("is free of anything shaped like a credential", () => {
    const CREDENTIAL = /sb_secret_[A-Za-z0-9]|sk-or-v1-|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|lsv2_[a-z]/;
    const offenders = FILES.filter((file) => CREDENTIAL.test(file.source)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
