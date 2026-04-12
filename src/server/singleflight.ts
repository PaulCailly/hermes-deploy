/**
 * Single-flight guard that ensures at most one mutating operation runs
 * per deployment at a time. Read-only operations bypass this entirely.
 */
export class SingleFlight {
  private inflight = new Map<string, string>(); // name → jobId

  isRunning(key: string): string | undefined {
    return this.inflight.get(key);
  }

  acquire(key: string, jobId: string): boolean {
    if (this.inflight.has(key)) return false;
    this.inflight.set(key, jobId);
    return true;
  }

  release(key: string): void {
    this.inflight.delete(key);
  }
}
