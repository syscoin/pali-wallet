type Activity = Readonly<{
  state(): string;
  subscribe(listener: (state: string) => void): () => void;
}>;

/** Only the OS credential prompt may briefly interrupt the locked auth flow. */
export class DeviceUnlockPrompt {
  private pending: { cancelled: boolean } | null = null;
  private readonly activity: Activity;

  constructor(activity: Activity) { this.activity = activity; }

  isActive(): boolean { return this.pending !== null && !this.pending.cancelled; }

  cancel(): void {
    if (this.pending) this.pending.cancelled = true;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pending || this.activity.state() !== 'active') throw new Error('DEVICE_UNLOCK_UNAVAILABLE');
    const pending = { cancelled: false };
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
    });
    let result: T | undefined;
    let delivered = false;
    try {
      check();
      result = await operation();
      check();
      // Never retain a protected result while waiting for native focus events.
      if (this.activity.state() !== 'active' || !focused) throw new Error('DEVICE_UNLOCK_UNAVAILABLE');
      delivered = true;
      return result;
    } finally {
      if (!delivered && result instanceof Uint8Array) result.fill(0);
      result = undefined;
      unsubscribe();
      if (this.pending === pending) this.pending = null;
    }
  }
}
