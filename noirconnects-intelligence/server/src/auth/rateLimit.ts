/** Simple in-memory fixed-window limiter for login attempts (single-process deployment). */
export class LoginRateLimiter {
  private readonly attempts = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly maxFailures = 8,
    private readonly windowMs = 15 * 60_000,
  ) {}

  isBlocked(key: string, now: number): boolean {
    const entry = this.attempts.get(key);
    if (!entry) return false;
    if (now - entry.windowStart > this.windowMs) {
      this.attempts.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  recordFailure(key: string, now: number): void {
    const entry = this.attempts.get(key);
    if (!entry || now - entry.windowStart > this.windowMs) this.attempts.set(key, { count: 1, windowStart: now });
    else entry.count++;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}
