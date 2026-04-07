/**
 * Minimal retry utility inspired by p-retry (https://github.com/sindresorhus/p-retry).
 * Exponential backoff with configurable hooks for filtering retryable errors and
 * observing failed attempts.
 */

export interface RetryContext {
  readonly error: Error;
  readonly attemptNumber: number;
  readonly retriesLeft: number;
}

export interface RetryOptions {
  /** Number of retries after the initial attempt. Default: 2 */
  readonly retries?: number;
  /** Exponential backoff factor. Default: 2 */
  readonly factor?: number;
  /** Base delay in ms for the first retry. Default: 1000 */
  readonly minTimeout?: number;
  /** Maximum delay cap in ms. Default: Infinity */
  readonly maxTimeout?: number;
  /** Return false to abort retries for this error. Default: () => true */
  readonly shouldRetry?: (context: RetryContext) => boolean | Promise<boolean>;
  /** Called after each failed attempt (useful for logging). Default: noop */
  readonly onFailedAttempt?: (context: RetryContext) => void | Promise<void>;
}

/**
 * Throw inside the input function to immediately abort without retrying.
 */
export class AbortError extends Error {
  readonly originalError: Error;

  constructor(messageOrError: string | Error) {
    super();
    if (messageOrError instanceof Error) {
      this.originalError = messageOrError;
      this.message = messageOrError.message;
    } else {
      this.originalError = new Error(messageOrError);
      this.originalError.stack = this.stack;
      this.message = messageOrError;
    }
    this.name = "AbortError";
  }
}

function calculateDelay(
  attempt: number,
  options: Required<RetryOptions>,
): number {
  const timeout = Math.round(options.minTimeout * options.factor ** attempt);
  return Math.min(timeout, options.maxTimeout);
}

export async function retry<T>(
  input: (attemptNumber: number) => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const retries = options?.retries ?? 2;
  const factor = options?.factor ?? 2;
  const minTimeout = options?.minTimeout ?? 1000;
  const maxTimeout = options?.maxTimeout ?? Number.POSITIVE_INFINITY;
  const shouldRetry = options?.shouldRetry ?? (() => true);
  const onFailedAttempt = options?.onFailedAttempt ?? (() => {});

  const resolved: Required<RetryOptions> = {
    retries,
    factor,
    minTimeout,
    maxTimeout,
    shouldRetry,
    onFailedAttempt,
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await input(attempt + 1);
    } catch (error) {
      if (error instanceof AbortError) {
        throw error.originalError;
      }

      const normalizedError =
        error instanceof Error ? error : new Error(String(error));

      const context: RetryContext = {
        error: normalizedError,
        attemptNumber: attempt + 1,
        retriesLeft: retries - attempt,
      };

      await onFailedAttempt(context);

      if (attempt >= retries) {
        throw normalizedError;
      }

      if (!(await shouldRetry(context))) {
        throw normalizedError;
      }

      const delay = calculateDelay(attempt, resolved);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error("Retry loop exited unexpectedly");
}
