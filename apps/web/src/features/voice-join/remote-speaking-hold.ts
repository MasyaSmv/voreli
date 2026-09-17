const REMOTE_HOLD_MS = 300;

/** Keeps intermittent server reports visually stable without inventing new speakers. */
export class RemoteSpeakingHold {
  private readonly expiresAt = new Map<string, number>();

  report(userIds: readonly string[], now: number): ReadonlySet<string> {
    this.prune(now);
    for (const userId of userIds) this.expiresAt.set(userId, now + REMOTE_HOLD_MS);

    return new Set(this.expiresAt.keys());
  }

  expire(now: number): ReadonlySet<string> {
    this.prune(now);

    return new Set(this.expiresAt.keys());
  }

  nextExpiry(): number | null {
    if (this.expiresAt.size === 0) return null;

    return Math.min(...this.expiresAt.values());
  }

  clear(): void {
    this.expiresAt.clear();
  }

  private prune(now: number): void {
    for (const [userId, expiry] of this.expiresAt) {
      if (expiry <= now) this.expiresAt.delete(userId);
    }
  }
}
