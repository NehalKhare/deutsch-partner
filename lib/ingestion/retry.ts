/**
 * Retrying a step that can fail transiently.
 *
 * Ingestion talks to an embedding provider and a database over a run that can
 * last minutes, so a single refused connection should not throw away the work
 * already done. What it must not do is retry something that will fail the same
 * way every time: a malformed document is not a network blip, and hammering it
 * three times only makes the failure report slower to arrive.
 */

export interface RetryOptions {
  readonly attempts: number;
  readonly baseDelayMs: number;
  /** Injected so tests do not wait, and so a long run stays interruptible. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly isRetryable?: (error: unknown) => boolean;
  readonly onRetry?: (attempt: number, error: unknown) => void;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const retryable = options.isRetryable ?? (() => true);
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === options.attempts || !retryable(error)) throw error;

      options.onRetry?.(attempt, error);
      // Exponential, so a provider that is briefly overloaded is not kept
      // overloaded by the client that noticed.
      await sleep(options.baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}
