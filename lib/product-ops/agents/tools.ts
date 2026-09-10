import type { StructuredToolInterface } from "@langchain/core/tools";
import { tool } from "langchain";
import { z } from "zod";

import {
  codeEditSchema,
  isDeniedPath,
  repoPathSchema,
  type MarketFinding,
} from "@/domain/product-ops";
import type { CallContext } from "@/lib/ai/gateway/gateway";
import {
  PRODUCT_OPS_TOOL_HELP,
  type ProductOpsToolName,
} from "@/lib/ai/prompts/product-ops-agents";
import type { UntrustedTag } from "@/lib/ai/prompts/delimiters";
import type { Applier, ApplyOutcome } from "@/lib/product-ops/apply";
import { researchMarket } from "@/lib/product-ops/research";
import type { SpecialistDeps } from "@/lib/product-ops/specialist";

/**
 * The product-ops agents' tools.
 *
 * Every tool here is a narrow, argument-checked door onto something the agent
 * is allowed to have: a search, a stored row, a file inside the worktree, a
 * write through the validation layer. None of them takes an argument that
 * reaches a shell, names a URL, or chooses a path the deny-list would refuse.
 * Where a tool touches the repository it applies the deny-list itself, before
 * the layer beneath it applies it again — the apply layer is the control, and
 * this is what stops a planner from even reading a secret.
 *
 * Tools answer JSON strings, and every failure is spelled the same way, with
 * an "error" key. The progress middleware reads that to say whether a call
 * worked, and the fencing middleware wraps whatever comes back as untrusted.
 */

/** How many paths a listing returns. Enough to orient, not a whole tree. */
export const MAX_LISTED_PATHS = 200;

/** How much of one file the planner or coder is shown. */
export const MAX_READ_CHARS = 24_000;

/** How many lines a code search returns. */
export const MAX_SEARCH_HITS = 50;

/** The fence each tool's results belong in. */
export const TOOL_FENCES: Readonly<Record<ProductOpsToolName, UntrustedTag>> = {
  search_market: "web_results",
  read_findings: "market_research",
  list_prior_proposals: "market_research",
  search_internal_docs: "retrieved_knowledge",
  read_prd: "tool_result",
  list_files: "repo_source",
  read_file: "repo_source",
  search_code: "repo_source",
  propose_edit: "tool_result",
};

const answer = (value: unknown): string => JSON.stringify(value);
const refuse = (error: string): string => JSON.stringify({ error });

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

export interface ResearchToolDeps {
  readonly specialist: SpecialistDeps;
  readonly context: CallContext;
  /** Stores findings. The unique hash per run makes a repeat a no-op. */
  readonly record: (findings: readonly MarketFinding[]) => Promise<boolean>;
}

export interface ResearchToolset {
  readonly tools: readonly StructuredToolInterface[];
  /** What the run actually recorded, counted here rather than believed. */
  recorded(): number;
  searches(): number;
}

/**
 * The research agent's one tool.
 *
 * search_market is the existing web-grounded extraction call: one query, one
 * finding, on the task route that alone may search. It records what it finds
 * itself — validated, and with every address the provider did not actually
 * return removed — so the run's output is the rows the searches produced and
 * never the model's discipline about a second call. What the agent adds is
 * choosing the queries and deciding when it has enough.
 */
export function researchTools(deps: ResearchToolDeps): ResearchToolset {
  let recorded = 0;
  let searches = 0;

  const searchMarket = tool(
    async ({ query }) => {
      searches += 1;
      const outcome = await researchMarket(deps.specialist, {
        query,
        context: deps.context,
      });
      if (outcome.status !== "ok") return refuse(outcome.reason);

      const stored = outcome.value.length > 0 ? await deps.record(outcome.value) : true;
      if (stored) recorded += outcome.value.length;

      return answer({
        recorded: stored ? outcome.value.length : 0,
        findings: outcome.value.map((finding) => ({
          title: finding.title,
          summary: finding.summary,
        })),
        sources: outcome.citations.map((citation) => citation.url),
      });
    },
    {
      name: "search_market",
      description: PRODUCT_OPS_TOOL_HELP.search_market,
      schema: z.strictObject({ query: z.string().trim().min(3).max(400) }),
    },
  );

  return {
    tools: [searchMarket],
    recorded: () => recorded,
    searches: () => searches,
  };
}

// ---------------------------------------------------------------------------
// The CPO
// ---------------------------------------------------------------------------

export interface PriorProposal {
  readonly title: string;
  readonly status: string;
  readonly problemStatement: string;
}

/** What the product already teaches, as a search. Optional: not every deployment embeds. */
export interface InternalDocs {
  search(
    query: string,
  ): Promise<readonly { readonly content: string; readonly source: string }[]>;
}

export interface CpoToolDeps {
  readonly findings: readonly MarketFinding[];
  readonly prior: readonly PriorProposal[];
  readonly docs?: InternalDocs;
}

export function cpoTools(deps: CpoToolDeps): readonly StructuredToolInterface[] {
  const readFindings = tool(async () => answer({ findings: deps.findings }), {
    name: "read_findings",
    description: PRODUCT_OPS_TOOL_HELP.read_findings,
    schema: z.strictObject({}),
  });

  const listPrior = tool(async () => answer({ proposals: deps.prior }), {
    name: "list_prior_proposals",
    description: PRODUCT_OPS_TOOL_HELP.list_prior_proposals,
    schema: z.strictObject({}),
  });

  const searchDocs = tool(
    async ({ query }) => {
      if (!deps.docs) return refuse("unavailable");
      try {
        const chunks = await deps.docs.search(query);
        return answer({ chunks: chunks.slice(0, 8) });
      } catch {
        return refuse("unavailable");
      }
    },
    {
      name: "search_internal_docs",
      description: PRODUCT_OPS_TOOL_HELP.search_internal_docs,
      schema: z.strictObject({ query: z.string().trim().min(2).max(200) }),
    },
  );

  return [readFindings, listPrior, searchDocs];
}

// ---------------------------------------------------------------------------
// The repository, read-only
// ---------------------------------------------------------------------------

/**
 * How the planner sees the worktree.
 *
 * A port, supplied by the workspace: list paths under a prefix, read one
 * file, find lines containing an exact text. The workspace decides how — the
 * real one walks the filesystem and runs `git grep -F` through the command
 * allowlist — and the tools decide what may be asked for.
 */
export interface RepositoryBrowser {
  list(prefix: string): Promise<readonly string[]>;
  read(path: string): Promise<string | null>;
  search(
    text: string,
  ): Promise<readonly { readonly path: string; readonly line: number; readonly text: string }[]>;
}

/** A directory prefix: like a path, but a directory and possibly empty. */
const prefixSchema = z
  .string()
  .trim()
  .max(200)
  .refine((value) => !value.includes("\\") && !value.startsWith("/") && !value.startsWith("~"), {
    message: "a prefix is relative and uses forward slashes",
  })
  .refine(
    (value) =>
      value
        .split("/")
        .every((segment) => segment !== "." && segment !== ".."),
    { message: "a prefix may not contain dot segments" },
  );

/** Literal text, not a pattern, and nothing a terminal would read differently. */
const searchTextSchema = z
  .string()
  .min(2)
  .max(120)
  .refine((value) => ![...value].some((c) => (c.codePointAt(0) ?? 0) < 0x20), {
    message: "no control characters",
  });

export interface PlannerToolDeps {
  readonly prd: string;
  readonly browser: RepositoryBrowser;
}

export function plannerTools(deps: PlannerToolDeps): readonly StructuredToolInterface[] {
  const readPrd = tool(async () => answer({ prd: deps.prd }), {
    name: "read_prd",
    description: PRODUCT_OPS_TOOL_HELP.read_prd,
    schema: z.strictObject({}),
  });

  const listFiles = tool(
    async ({ prefix }) => {
      try {
        const paths = await deps.browser.list(prefix.replace(/\/+$/u, ""));
        return answer({
          paths: paths.filter((path) => !isDeniedPath(path)).slice(0, MAX_LISTED_PATHS),
        });
      } catch {
        return refuse("unavailable");
      }
    },
    {
      name: "list_files",
      description: PRODUCT_OPS_TOOL_HELP.list_files,
      schema: z.strictObject({ prefix: prefixSchema }),
    },
  );

  const readFile = tool(
    async ({ path }) => {
      if (isDeniedPath(path)) return refuse("denied_path");
      try {
        const content = await deps.browser.read(path);
        if (content === null) return refuse("file_missing");
        return answer({
          path,
          truncated: content.length > MAX_READ_CHARS,
          content: content.slice(0, MAX_READ_CHARS),
        });
      } catch {
        return refuse("unreadable");
      }
    },
    {
      name: "read_file",
      description: PRODUCT_OPS_TOOL_HELP.read_file,
      schema: z.strictObject({ path: repoPathSchema }),
    },
  );

  const searchCode = tool(
    async ({ text }) => {
      try {
        const hits = await deps.browser.search(text);
        return answer({
          hits: hits.filter((hit) => !isDeniedPath(hit.path)).slice(0, MAX_SEARCH_HITS),
        });
      } catch {
        return refuse("unavailable");
      }
    },
    {
      name: "search_code",
      description: PRODUCT_OPS_TOOL_HELP.search_code,
      schema: z.strictObject({ text: searchTextSchema }),
    },
  );

  return [readPrd, listFiles, readFile, searchCode];
}

// ---------------------------------------------------------------------------
// The coder
// ---------------------------------------------------------------------------

export interface CoderToolDeps {
  /** The trusted validation layer, built over the approved plan. */
  readonly applier: Applier;
  /** Every attempt, applied or refused, the moment it is decided. */
  readonly onChange: (outcome: ApplyOutcome) => Promise<void> | void;
}

export interface CoderToolset {
  readonly tools: readonly StructuredToolInterface[];
  /** Everything proposed, in order. The record, not the model's account of it. */
  changes(): readonly ApplyOutcome[];
}

export function coderTools(deps: CoderToolDeps): CoderToolset {
  const changes: ApplyOutcome[] = [];

  const readFile = tool(
    async ({ path }) => {
      // The applier's read is behind the same first three checks as a write:
      // inside the worktree, in the plan, not denied. A read of a path outside
      // the plan is how a secret reaches a prompt.
      const content = await deps.applier.read(path);
      if (content === null) return refuse("not_readable");
      return answer({
        path,
        truncated: content.length > MAX_READ_CHARS,
        content: content.slice(0, MAX_READ_CHARS),
      });
    },
    {
      name: "read_file",
      description: PRODUCT_OPS_TOOL_HELP.read_file,
      schema: z.strictObject({ path: repoPathSchema }),
    },
  );

  const proposeEdit = tool(
    async ({ edit }) => {
      const outcome = await deps.applier.apply(edit);
      changes.push(outcome);
      await deps.onChange(outcome);

      return outcome.applied
        ? answer({ applied: true, path: outcome.path, edits: outcome.editCount })
        : answer({ applied: false, refused: true, path: outcome.path, error: outcome.rejectedReason });
    },
    {
      name: "propose_edit",
      description: PRODUCT_OPS_TOOL_HELP.propose_edit,
      schema: z.strictObject({ edit: codeEditSchema }),
    },
  );

  return { tools: [readFile, proposeEdit], changes: () => changes };
}
