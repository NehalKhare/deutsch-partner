import { codeEditSchema, type CodeEdit } from "@dp/domain/product-ops";
import type { CallContext } from "@dp/gateway/gateway";
import {
  runSpecialist,
  type SpecialistDeps,
  type SpecialistOutcome,
} from "./specialist";

/**
 * The code editor.
 *
 * One file at a time, and anchored edits rather than contents, because the
 * reasoning tier may emit 2000 tokens and a source file does not fit in 2000
 * tokens. That is not a style the prompt asks for; domain/product-ops.ts will
 * not accept anything else for a file that already exists.
 *
 * It checks one thing itself: that the edit it got back is for the file it
 * asked about. The apply layer checks the path against the approved plan too,
 * and would refuse this anyway — but a model that answered about a different
 * file has misunderstood the request, and continuing would mean writing a
 * correct-looking edit into the wrong place.
 */

const PROMPT = "productops.code_edit";

export interface CodeEditRequest {
  /** What to change, derived from the approved plan. Trusted framing. */
  readonly instruction: string;
  /** The file being changed. The edit must name this path and no other. */
  readonly path: string;
  /** Its current contents, or null when the file is being created. */
  readonly source: string | null;
  /**
   * Anything else it should read, fenced.
   *
   * This is where a failing build's output goes on a repair pass. Compiler and
   * test output is external content like any other: it quotes source files —
   * including the ones this agent just wrote — and a line in a test fixture
   * can say whatever it likes.
   */
  readonly notes?: readonly { readonly content: string; readonly source: string }[];
  readonly context: CallContext;
}

export async function proposeCodeEdit(
  deps: SpecialistDeps,
  request: CodeEditRequest,
): Promise<SpecialistOutcome<CodeEdit>> {
  const outcome = await runSpecialist(deps, {
    prompt: PROMPT,
    schema: codeEditSchema,
    input: {
      instruction: `${request.instruction}\n\nFile: ${request.path}`,
    },
    knowledge: [
      ...(request.source === null
        ? []
        : [
            {
              content: `${request.path}\n${request.source}`,
              score: 1,
              source: request.path,
            },
          ]),
      // Below the file itself in the shedding order: under pressure, the file
      // being edited is the thing that must survive.
      ...(request.notes ?? []).map((note) => ({
        content: note.content,
        score: 0.6,
        source: note.source,
      })),
    ],
    context: request.context,
  });

  if (outcome.status !== "ok") return outcome;

  if (outcome.value.path !== request.path) {
    return {
      status: "failed",
      reason: "invalid_output",
      // The path it answered about is model output; naming it back in a
      // detail string is fine, but the reason is what the caller acts on.
      detail: "path",
      attempts: outcome.attempts,
      costEur: outcome.costEur,
    };
  }

  return outcome;
}
