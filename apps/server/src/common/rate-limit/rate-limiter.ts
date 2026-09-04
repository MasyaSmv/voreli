export const RATE_LIMITER = Symbol("RATE_LIMITER");

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  /** Attempts recorded in the current window, this one included. */
  readonly hits: number;
  /**
   * Milliseconds until the current window resets. Doubles as the retry-after value when
   * the attempt was refused.
   */
  readonly resetAfterMs: number;
}

/**
 * Counts attempts per key inside a time window.
 *
 * A contract rather than a class because the counter must live outside the process: with
 * an in-memory implementation every instance keeps its own tally and the effective limit
 * silently multiplies by the number of instances.
 */
export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision>;
}
