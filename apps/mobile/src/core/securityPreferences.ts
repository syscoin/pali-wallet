import { DEFAULT_IDLE_MINUTES, idleMinutes } from '../../../../source/shared/idleLockPolicy.ts';
export const SECURITY_PREFERENCES_KEY = 'pali.mobile.security-preferences.v1';
export type IdleMode = 'custody' | 'watch';
export type SecurityPreferenceSnapshot = Readonly<{ version: 1; custodyIdleMinutes: number; watchIdleMinutes: number }>;
export type PreferencePort = Readonly<{ get(): Promise<string | null>; set(raw: string): Promise<void> }>;
const invalid = (): never => { throw new Error('Security settings unavailable'); };
function parse(raw: string | null): SecurityPreferenceSnapshot {
  if (raw === null) return Object.freeze({ version: 1, custodyIdleMinutes: DEFAULT_IDLE_MINUTES, watchIdleMinutes: DEFAULT_IDLE_MINUTES });
  if (typeof raw !== 'string' || raw.length > 256 || new TextEncoder().encode(raw).length > 256) return invalid();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'custodyIdleMinutes,version,watchIdleMinutes') return invalid();
  const v = value as SecurityPreferenceSnapshot;
  if (v.version !== 1) return invalid();
  return Object.freeze({ version: 1, custodyIdleMinutes: idleMinutes(v.custodyIdleMinutes), watchIdleMinutes: idleMinutes(v.watchIdleMinutes) });
}
function check(guard: () => void) { const result: unknown = guard(); if (result !== undefined) { if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined); throw new Error('Invalid security-settings guard'); } }
export class SecurityPreferences {
  private queue: Promise<void> = Promise.resolve();
  private epoch = 0;
  private tokens = new WeakMap<SecurityPreferenceSnapshot, { raw: string | null; epoch: number; used: boolean }>();
  private state: Readonly<{ status: 'opening' | 'ready' | 'unavailable'; value: SecurityPreferenceSnapshot | null }> = Object.freeze({ status: 'opening', value: null });
  private listeners = new Set<() => void>();
  private readonly port: PreferencePort;
  constructor(port: PreferencePort) { this.port = port; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(status: typeof this.state.status, value: SecurityPreferenceSnapshot | null) { const next = Object.freeze({ status, value }); this.state = next; for (const listener of [...this.listeners]) { if (this.state !== next) break; if (this.listeners.has(listener)) { try { listener(); } catch { /* Observers cannot interrupt policy publication. */ } } } }
  private queued<T>(work: () => Promise<T>): Promise<T> { const result = this.queue.then(work); this.queue = result.then(() => undefined, () => undefined); return result; }
  private issue(value: SecurityPreferenceSnapshot, raw: string | null) { this.tokens.set(value, { raw, epoch: this.epoch, used: false }); return value; }
  validate(expected: SecurityPreferenceSnapshot): void {
    const token = this.tokens.get(expected);
    if (this.state.status !== 'ready' || !token || token.epoch !== this.epoch || token.used) return invalid();
  }
  load = (): Promise<SecurityPreferenceSnapshot> => this.queued(async () => {
    try { const raw = await this.port.get(), value = this.issue(parse(raw), raw); this.publish('ready', value); return value; }
    catch { this.epoch++; this.publish('unavailable', null); return invalid(); }
  });
  /** Mode is supplied only by the owning native/watch adapter, never a settings form. */
  save(expected: SecurityPreferenceSnapshot, mode: IdleMode, minutes: number, guard: () => void): Promise<SecurityPreferenceSnapshot> {
    const checked = idleMinutes(minutes);
    if (mode !== 'custody' && mode !== 'watch') return Promise.reject(new Error('Invalid security settings mode'));
    return this.queued(async () => {
      this.validate(expected); check(guard);
      const token = this.tokens.get(expected)!; token.used = true;
      const next = Object.freeze({ ...expected, [mode === 'custody' ? 'custodyIdleMinutes' : 'watchIdleMinutes']: checked });
      const raw = JSON.stringify(next);
      try {
        if (await this.port.get() !== token.raw) return invalid(); check(guard);
        await this.port.set(raw); check(guard);
        if (await this.port.get() !== raw) return invalid(); check(guard);
        this.epoch++; const value = this.issue(parse(raw), raw); this.publish('ready', value); return value;
      } catch { this.epoch++; this.publish('unavailable', null); return invalid(); }
    });
  }
}
