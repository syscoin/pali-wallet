import { idleMinutes, idleRemaining, idleSample, type IdleClockSample } from '../../../../source/shared/idleLockPolicy.ts';
import { DEFAULT_MOBILE_IDLE_MINUTES } from './securityPreferences.ts';
export type IdleClock = () => IdleClockSample;
export class IdleLock {
  private owner: object | null = null;
  private expired = false;
  private generation = 0;
  private interval = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private minutes = DEFAULT_MOBILE_IDLE_MINUTES;
  private activity: IdleClockSample | null = null;
  private previous: IdleClockSample | null = null;
  private revoke: (() => void) | null = null;
  constructor(privateClock: IdleClock = () => ({ monotonic: performance.now(), wall: Date.now() }),
    schedule: typeof setTimeout = setTimeout, cancel: typeof clearTimeout = clearTimeout) {
    this.clock = privateClock; this.schedule = schedule.bind(globalThis); this.cancel = cancel.bind(globalThis);
  }
  private readonly clock: IdleClock;
  private readonly schedule: typeof setTimeout;
  private readonly cancel: typeof clearTimeout;
  setPolicy(value: number): void { this.minutes = idleMinutes(value); if (this.owner && !this.expired) this.arm(); }
  isOwned(owner: object): boolean { return this.owner === owner && !this.expired; }
  begin(owner: object, revoke: () => void): void {
    if (this.isOwned(owner)) return;
    this.stop(); this.owner = owner; this.expired = false; this.revoke = revoke;
    try { this.activity = this.previous = idleSample(this.clock()); this.arm(); } catch { this.expire(); }
  }
  stop(owner?: object): void {
    if (owner && this.owner !== owner) return;
    this.interval++;
    this.generation++; if (this.timer !== null) this.cancel(this.timer); this.timer = null;
    this.owner = null; this.revoke = null; this.activity = this.previous = null;
  }
  allowNewInput(): void { if (!this.owner) this.expired = false; }
  private expire(): void {
    if (!this.owner || this.expired) return;
    // Invalidate before callbacks/observers: reentrant guards cannot revoke twice.
    this.expired = true; this.generation++; if (this.timer !== null) this.cancel(this.timer); this.timer = null;
    const revoke = this.revoke; this.revoke = null; revoke?.();
  }
  invalidate(): void { try { this.expire(); } finally { this.stop(); } }
  check(owner?: object): boolean {
    if (!this.owner || this.expired || owner && this.owner !== owner) return false;
    try {
      const now = idleSample(this.clock()), remaining = idleRemaining(this.minutes, this.activity!, this.previous!, now);
      this.previous = now;
      if (remaining <= 0) { this.expire(); return false; }
      return true;
    } catch { this.expire(); return false; }
  }
  assertCurrent(owner?: object): void { if (!this.check(owner)) throw new Error('CANCELLED'); }
  captureGuard(): () => void { const owner = this.owner; return () => { if (!owner) throw new Error('CANCELLED'); this.assertCurrent(owner); }; }
  /** A press belongs to one interval even if its screen is later rearmed. */
  captureInteraction(): () => boolean {
    const interval = this.interval, accepted = this.userActivity();
    return () => accepted && interval === this.interval && this.userActivity();
  }
  userActivity(): boolean {
    if (!this.owner) return !this.expired;
    if (!this.check()) return false;
    this.activity = this.previous!; this.arm(); return true;
  }
  private arm(): void {
    const generation = ++this.generation;
    if (this.timer !== null) this.cancel(this.timer); this.timer = null;
    if (!this.check()) return;
    const remaining = idleRemaining(this.minutes, this.activity!, this.previous!, this.previous!);
    if (Number.isFinite(remaining)) this.timer = this.schedule(() => {
      if (generation !== this.generation) return;
      this.timer = null; if (this.check()) this.arm();
    }, remaining);
  }
}
