const DEFAULT_CACHE_SAVE_DELAY_MS = 2000;

export class NativeBalanceCacheSaveScheduler {
  private timeout: ReturnType<typeof setTimeout> | null = null;

  public constructor(private readonly delayMs = DEFAULT_CACHE_SAVE_DELAY_MS) {}

  public cancel(): void {
    if (!this.timeout) return;

    clearTimeout(this.timeout);
    this.timeout = null;
  }

  public schedule(task: () => void): void {
    this.cancel();

    const timeout = setTimeout(() => {
      if (this.timeout !== timeout) return;

      // Release the slot before the task runs so an update arriving during
      // persistence can schedule the next write instead of being dropped.
      this.timeout = null;
      task();
    }, this.delayMs);

    this.timeout = timeout;
  }
}
