type Activity = Readonly<{
  state(): string;
  subscribe(listener: (state: string) => void): () => void;
}>;

/** Only the OS credential prompt may briefly interrupt the locked auth flow. */
export class DeviceUnlockPrompt {
  private pending: { cancelled: boolean; wake(): void } | null = null;
  private readonly activity: Activity;

  constructor(activity: Activity) { this.activity = activity; }

  isActive(): boolean { return this.pending !== null && !this.pending.cancelled; }

  cancel(): void {
    if (this.pending) { this.pending.cancelled = true; this.pending.wake(); }
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pending || this.activity.state() !== 'active') throw new Error('DEVICE_UNLOCK_UNAVAILABLE');
    const pending = { cancelled: false, wake: () => undefined as void };
    let focused = true;
    this.pending = pending;
    const check = () => {
      if (this.pending !== pending || pending.cancelled || this.activity.state() === 'background')
        throw new Error('DEVICE_UNLOCK_UNAVAILABLE');
    };
    const unsubscribe = this.activity.subscribe((state) => {
      if (state === 'background') pending.cancelled = true;
      if (state === 'blur') focused = false;
      if (state === 'focus') focused = true;
      pending.wake();
    });
    try {
      check();
      const result = await operation();
      check();
      while (this.activity.state() !== 'active' || !focused) {
        await new Promise<void>((resolve, reject) => {
          pending.wake = () => {
            try { check(); if (this.activity.state() === 'active' && focused) resolve(); }
            catch (error) { reject(error); }
          };
          pending.wake();
        });
      }
      check();
      return result;
    } finally {
      unsubscribe();
      if (this.pending === pending) this.pending = null;
    }
  }
}
