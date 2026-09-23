import { estimateTokens, truncateToTokens } from "@dp/prompts/tokens";

/**
 * Layer 3 of the ceiling enforcement.
 *
 * The provider is sent a max-output parameter on every call, and mostly
 * honours it. Mostly is not a budget. This counts what actually arrives and
 * stops the stream at the ceiling regardless, which is the only layer that
 * still holds when a provider ignores the parameter or a router silently
 * swaps in a model that reads it differently.
 *
 * What was received is kept and flagged, never discarded: a learner who got
 * three quarters of a reply should see three quarters of a reply, marked as
 * cut off, rather than an error where their tutor's answer was.
 */

export interface StreamGuardResult {
  readonly text: string;
  readonly outputTokens: number;
  readonly truncated: boolean;
}

export interface StreamGuard {
  readonly stream: AsyncGenerator<string, void, undefined>;
  /** What has been emitted so far. Final once the stream is exhausted. */
  result(): StreamGuardResult;
}

export interface StreamGuardOptions {
  readonly maxOutputTokens: number;
  /**
   * Aborted when the ceiling is hit, so the provider stops billing for tokens
   * nobody will ever read.
   */
  readonly abort?: AbortController;
}

export function guardStream(
  source: AsyncIterable<string>,
  options: StreamGuardOptions,
): StreamGuard {
  let emitted = "";
  let truncated = false;

  async function* run(): AsyncGenerator<string, void, undefined> {
    for await (const chunk of source) {
      const next = emitted + chunk;

      if (estimateTokens(next) <= options.maxOutputTokens) {
        emitted = next;
        yield chunk;
        continue;
      }

      // Over the ceiling inside this chunk. Emit the part that fits so the
      // reply ends on a word rather than mid-token, then stop.
      const clipped = truncateToTokens(next, options.maxOutputTokens);
      if (clipped.length > emitted.length) {
        const tail = clipped.slice(emitted.length);
        emitted = clipped;
        yield tail;
      }

      truncated = true;
      options.abort?.abort();
      return;
    }
  }

  return {
    stream: run(),
    result: () => ({
      text: emitted,
      outputTokens: estimateTokens(emitted),
      truncated,
    }),
  };
}

/** Drains a guarded stream when the caller does not need the chunks. */
export async function collectGuarded(guard: StreamGuard): Promise<StreamGuardResult> {
  for await (const chunk of guard.stream) void chunk;
  return guard.result();
}
