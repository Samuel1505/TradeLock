/** Errors that must not be retried (contract panics, validation failures, mismatches). */
export class NonRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NonRetryableError';
  }
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with jitter. Throws the last error after `attempts`. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 10_000;
  const isRetryable = opts.isRetryable ?? ((e) => !(e instanceof NonRetryableError));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === attempts) break;
      const delay = Math.min(max, base * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5);
      (opts.onRetry ?? defaultOnRetry(opts.label))(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

const defaultOnRetry = (label?: string) => (err: unknown, attempt: number, delayMs: number) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[retry${label ? ` ${label}` : ''}] attempt ${attempt} failed: ${msg}; retrying in ${Math.round(delayMs)}ms`);
};
