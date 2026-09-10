import { z } from "zod";

/**
 * The GitHub calls this product makes, and no others.
 *
 * Five of them, so there is no dependency here — a fetch wrapper is smaller
 * than the client library it would replace, and a narrow surface is the point
 * rather than a side effect. The agent never receives this object, never
 * receives the token, and has no way to name a URL: every path below is built
 * from the configured repository and a branch derived from a proposal id.
 *
 * The token travels in a header and nowhere else. Not in a URL, not in a
 * query, not in argv, and not in a log line — the logger redacts token-shaped
 * keys, and nothing here hands it one to redact.
 *
 * Every response is Zod-parsed. A shape change should surface as a typed
 * failure rather than as undefined becoming a pull request number.
 */

const API = "https://api.github.com";

/** owner/name, as GitHub states it. Validated so a typo is a boot failure. */
export const repositorySchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, {
    error: 'must be a repository as "owner/name"',
  });

export interface GitHubOptions {
  readonly token: string;
  readonly repository: string;
  readonly fetchImpl?: typeof fetch;
}

export interface PullRequestRef {
  readonly number: number;
  readonly url: string;
}

export interface GitHubClient {
  readonly repository: string;
  /** The repository's default branch, which a pull request is opened against. */
  defaultBranch(): Promise<string>;
  /** The commit a ref points at, or null when the ref does not exist. */
  refSha(ref: string): Promise<string | null>;
  createBranch(branch: string, fromSha: string): Promise<boolean>;
  /** The open pull request for this head, or null. The idempotency check. */
  findPullRequestForBranch(branch: string): Promise<PullRequestRef | null>;
  openPullRequest(input: {
    readonly branch: string;
    readonly base: string;
    readonly title: string;
    readonly body: string;
  }): Promise<PullRequestRef | null>;
  addLabels(pullNumber: number, labels: readonly string[]): Promise<boolean>;
}

const repositorySnapshot = z
  .object({ default_branch: z.string().min(1) })
  .loose();

const refSnapshot = z
  .object({ object: z.object({ sha: z.string().min(1) }).loose() })
  .loose();

const pullSnapshot = z
  .object({
    number: z.number().int().positive(),
    html_url: z.string().min(1),
  })
  .loose();

const pullListSnapshot = z.array(z.unknown());

/**
 * A failure is a null, never a throw.
 *
 * The worker's job is to record what happened and leave the branch intact for
 * a person; an exception carrying a provider's message would be both less
 * useful and a way for a response body to reach a log.
 */
export function createGitHubClient(options: GitHubOptions): GitHubClient {
  const call = options.fetchImpl ?? fetch;
  const base = `${API}/repos/${options.repository}`;

  const headers = (): HeadersInit => ({
    // The one place the token appears.
    authorization: `Bearer ${options.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
  });

  async function request(
    path: string,
    init?: { method: string; body?: unknown },
  ): Promise<unknown | null> {
    try {
      const response = await call(`${base}${path}`, {
        method: init?.method ?? "GET",
        headers: headers(),
        ...(init?.body === undefined
          ? {}
          : { body: JSON.stringify(init.body) }),
      });

      if (!response.ok) return null;

      return await response.json();
    } catch {
      return null;
    }
  }

  return {
    repository: options.repository,

    async defaultBranch() {
      const parsed = repositorySnapshot.safeParse(await request(""));

      // "main" rather than a throw: a pull request has to be opened against
      // something, and this repository's default is main. A wrong guess is a
      // refused pull request, which the worker records.
      return parsed.success ? parsed.data.default_branch : "main";
    },

    async refSha(ref) {
      const parsed = refSnapshot.safeParse(
        await request(`/git/ref/${encodeURIComponent(ref)}`),
      );

      return parsed.success ? parsed.data.object.sha : null;
    },

    async createBranch(branch, fromSha) {
      const created = await request("/git/refs", {
        method: "POST",
        body: { ref: `refs/heads/${branch}`, sha: fromSha },
      });

      return created !== null;
    },

    async findPullRequestForBranch(branch) {
      // head is owner:branch, which is how GitHub scopes a head filter. The
      // owner comes from the configured repository, never from anywhere else.
      const [owner] = options.repository.split("/");
      const found = await request(
        `/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
      );

      const list = pullListSnapshot.safeParse(found);
      if (!list.success) return null;

      for (const candidate of list.data) {
        const parsed = pullSnapshot.safeParse(candidate);
        if (parsed.success) {
          return { number: parsed.data.number, url: parsed.data.html_url };
        }
      }

      return null;
    },

    async openPullRequest({ branch, base: target, title, body }) {
      const opened = await request("/pulls", {
        method: "POST",
        body: { head: branch, base: target, title, body },
      });

      const parsed = pullSnapshot.safeParse(opened);
      if (parsed.success) {
        return { number: parsed.data.number, url: parsed.data.html_url };
      }

      // A refusal here is very often "a pull request already exists for this
      // head", which is a success in disguise: the branch was pushed and
      // adopted on a previous attempt.
      return this.findPullRequestForBranch(branch);
    },

    async addLabels(pullNumber, labels) {
      const added = await request(`/issues/${pullNumber}/labels`, {
        method: "POST",
        body: { labels: [...labels] },
      });

      return added !== null;
    },
  };
}
