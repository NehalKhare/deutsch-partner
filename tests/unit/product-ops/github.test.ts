import { describe, expect, it } from "vitest";

import { createGitHubClient, repositorySchema } from "@/lib/github/client";

/**
 * The GitHub tool layer.
 *
 * Five calls, so what is worth asserting is narrow and mostly about what does
 * not happen: the token appears in exactly one place, every path is built from
 * the configured repository rather than from anything a model produced, and a
 * refusal is a null rather than a throw carrying a provider's message.
 *
 * The fetch is injected, the same way the model transport's tests do it. There
 * is no network here and no token.
 */

const TOKEN = "ghp_notarealtoken0000000000";
const REPOSITORY = "acme/german-partner";

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function client(
  responses: readonly { status?: number; body?: unknown }[] = [{ body: {} }],
) {
  const calls: Recorded[] = [];
  let at = 0;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });

    const response = responses[Math.min(at, responses.length - 1)];
    at += 1;

    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
    } as Response;
  }) as typeof fetch;

  return {
    calls,
    github: createGitHubClient({ token: TOKEN, repository: REPOSITORY, fetchImpl }),
  };
}

describe("the repository name", () => {
  it("accepts owner/name and refuses anything else", () => {
    expect(repositorySchema.safeParse(REPOSITORY).success).toBe(true);
    // Anything that could turn a path into a different path.
    for (const bad of [
      "german-partner",
      "acme/german-partner/extra",
      "acme/../secrets",
      "https://github.com/acme/german-partner",
      "acme/german partner",
    ]) {
      expect(repositorySchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("the token", () => {
  it("travels as a header, and appears nowhere else", async () => {
    const { calls, github } = client([{ body: { default_branch: "main" } }]);

    await github.defaultBranch();

    expect(calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    // Not in the URL, where it would reach a log or a proxy's access record.
    expect(calls[0].url).not.toContain(TOKEN);
    expect(JSON.stringify(calls[0].body ?? {})).not.toContain(TOKEN);
  });
});

describe("reading the repository", () => {
  it("asks for the default branch a pull request is opened against", async () => {
    const { calls, github } = client([{ body: { default_branch: "trunk" } }]);

    expect(await github.defaultBranch()).toBe("trunk");
    expect(calls[0].url).toBe(`https://api.github.com/repos/${REPOSITORY}`);
  });

  it("falls back to main rather than throwing", async () => {
    // A pull request has to be opened against something. A wrong guess is a
    // refused pull request, which the worker records; a throw would lose the
    // branch it just pushed.
    const { github } = client([{ status: 404 }]);

    expect(await github.defaultBranch()).toBe("main");
  });

  it("answers null for a ref that does not exist", async () => {
    const { github } = client([{ status: 404 }]);

    expect(await github.refSha("heads/product-ops/abc")).toBeNull();
  });

  it("reads a ref's commit", async () => {
    const { github } = client([{ body: { object: { sha: "abc123" } } }]);

    expect(await github.refSha("heads/main")).toBe("abc123");
  });

  it("answers null for a ref whose shape changed", async () => {
    const { github } = client([{ body: { object: {} } }]);

    expect(await github.refSha("heads/main")).toBeNull();
  });
});

describe("finding the pull request for a branch", () => {
  it("scopes the head to the configured owner, never to a supplied one", async () => {
    const { calls, github } = client([
      { body: [{ number: 7, html_url: "https://git.test/7" }] },
    ]);

    const found = await github.findPullRequestForBranch("product-ops/abc");

    expect(found).toEqual({ number: 7, url: "https://git.test/7" });
    expect(calls[0].url).toContain("head=acme%3Aproduct-ops%2Fabc");
    expect(calls[0].url).toContain("state=open");
  });

  it("answers null when there is none", async () => {
    const { github } = client([{ body: [] }]);

    expect(await github.findPullRequestForBranch("product-ops/abc")).toBeNull();
  });

  it("skips an entry whose shape it does not recognise", async () => {
    const { github } = client([
      { body: [{ number: "seven" }, { number: 8, html_url: "https://git.test/8" }] },
    ]);

    expect(await github.findPullRequestForBranch("product-ops/abc")).toEqual({
      number: 8,
      url: "https://git.test/8",
    });
  });
});

describe("opening one", () => {
  it("posts the head, the base, the title and the body", async () => {
    const { calls, github } = client([
      { body: { number: 9, html_url: "https://git.test/9" } },
    ]);

    const opened = await github.openPullRequest({
      branch: "product-ops/abc",
      base: "main",
      title: "Medical German module",
      body: "The PRD.",
    });

    expect(opened).toEqual({ number: 9, url: "https://git.test/9" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({
      head: "product-ops/abc",
      base: "main",
      title: "Medical German module",
    });
  });

  it("adopts the one that already exists when the open is refused", async () => {
    // GitHub refuses a second pull request for a head, and on a retry that
    // refusal is a success in disguise: the branch was pushed and the pull
    // request opened on a previous attempt.
    const { github } = client([
      { status: 422 },
      { body: [{ number: 7, html_url: "https://git.test/7" }] },
    ]);

    expect(
      await github.openPullRequest({
        branch: "product-ops/abc",
        base: "main",
        title: "t",
        body: "b",
      }),
    ).toEqual({ number: 7, url: "https://git.test/7" });
  });

  it("answers null when it is refused and there is nothing to adopt", async () => {
    const { github } = client([{ status: 422 }, { body: [] }]);

    expect(
      await github.openPullRequest({
        branch: "product-ops/abc",
        base: "main",
        title: "t",
        body: "b",
      }),
    ).toBeNull();
  });
});

describe("labelling", () => {
  it("posts the labels to the pull request's issue", async () => {
    const { calls, github } = client([{ body: [] }]);

    expect(await github.addLabels(7, ["product-ops"])).toBe(true);
    expect(calls[0].url).toContain("/issues/7/labels");
    expect(calls[0].body).toEqual({ labels: ["product-ops"] });
  });
});

describe("when the network fails", () => {
  it("reports a null rather than throwing a provider's words", async () => {
    const fetchImpl = (async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    }) as typeof fetch;
    const github = createGitHubClient({
      token: TOKEN,
      repository: REPOSITORY,
      fetchImpl,
    });

    await expect(github.refSha("heads/main")).resolves.toBeNull();
    await expect(
      github.findPullRequestForBranch("product-ops/abc"),
    ).resolves.toBeNull();
    await expect(github.addLabels(7, ["x"])).resolves.toBe(false);
  });
});
