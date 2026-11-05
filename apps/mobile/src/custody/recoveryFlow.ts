import { isNativeNewPassword, NEW_PASSWORD_HELP } from './password.ts';
import type { RecoveryInventory } from './recoveryInventory.ts';
import type { NativeRecoveryCoordinator, RecoveryProof } from './recovery.ts';

export type RecoveryOutcome = Readonly<{ kind: 'success' | 'cancelled' | 'expired' | 'failed' | 'uncertain'; operationPhase: 'inventory' | 'prepare' | 'review' | 'commit'; code: string; message: string; cleanupFailed?: boolean }>;
export type RecoveryFlowSnapshot = Readonly<{
  phase: 'reading' | 'scope' | 'entry' | 'verifying' | 'review' | 'committing' | 'reopening' | 'closed' | 'blocked';
  inventory: RecoveryInventory | null; error: string;
  fieldErrors: Readonly<{ phrase?: string; password?: string; confirmation?: string }>;
}>;
type Coordinator = Pick<NativeRecoveryCoordinator, 'prepare' | 'commit' | 'cancel'>;
const SAVED = 'Your saved wallet could not be verified for this recovery. Nothing has been reset.';
const UNCERTAIN = 'We could not confirm the password change. It may have completed. Unlock with your new password first; if it does not work, try your previous password.';
const UNAVAILABLE = 'Recovery could not be completed. Your saved wallet was not reset. Close and reopen Pali before trying again.';
const safeCode = (cause: unknown): string => cause instanceof Error && ['BUSY', 'NOT_READY', 'INVALID_INPUT', 'WRONG_PHRASE', 'INVALID_SAVED_DATA', 'AUTH_THROTTLED', 'CANCELLED', 'EXPIRED', 'STATE_CHANGED', 'UNAVAILABLE', 'REOPEN_REQUIRED'].includes(cause.message) ? cause.message : 'UNAVAILABLE';

/** Secret inputs and the opaque proof never enter this public state projection. */
export class NativeRecoveryFlow {
  private state: RecoveryFlowSnapshot = Object.freeze({ phase: 'reading', inventory: null, error: '', fieldErrors: Object.freeze({}) });
  private readonly listeners = new Set<() => void>();
  private started = false;
  private ended = false;
  private working = false;
  private request = 0;
  private coordinator: Coordinator | null = null;
  private proof: RecoveryProof | null = null;
  private deadline: number | null = null;
  private lastTime: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly dependencies: { readInventory(): Promise<RecoveryInventory>; createCoordinator(): Coordinator; isCurrent(): boolean; finish(outcome: RecoveryOutcome): Promise<void>; leave?(): void; now?(): number };
  constructor(dependencies: { readInventory(): Promise<RecoveryInventory>; createCoordinator(): Coordinator; isCurrent(): boolean; finish(outcome: RecoveryOutcome): Promise<void>; leave?(): void; now?(): number }) { this.dependencies = dependencies; }
  getSnapshot = (): RecoveryFlowSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(change: Partial<RecoveryFlowSnapshot>) {
    this.state = Object.freeze({ ...this.state, ...change });
    for (const listener of this.listeners) { try { listener(); } catch { /* Presentation cannot change an admitted operation. */ } }
  }
  private now() {
    const now = (this.dependencies.now ?? (() => performance.now()))();
    if (!Number.isFinite(now) || now < 0 || this.lastTime !== null && now < this.lastTime) throw new Error('CANCELLED');
    this.lastTime = now; return now;
  }
  private check(request: number) {
    if (this.ended || request !== this.request || this.dependencies.isCurrent() !== true) throw new Error('CANCELLED');
    if (this.ended || request !== this.request) throw new Error('CANCELLED');
    if (this.deadline !== null && this.now() >= this.deadline) throw new Error('EXPIRED');
  }
  start(): void {
    if (this.started || this.ended) return;
    this.started = true; const request = ++this.request;
    void (async () => {
      try {
        this.check(request); const inventory = await this.dependencies.readInventory(); this.check(request);
        if (inventory.status !== 'needs-matching-phrase-verification' || !inventory.counts) this.publish({ phase: 'blocked', error: SAVED });
        else this.publish({ phase: 'scope', inventory, error: '' });
      } catch { if (!this.ended && request === this.request) this.publish({ phase: 'blocked', error: SAVED }); }
    })();
  }
  enter(): void { if (!this.ended && !this.working && this.state.phase === 'scope') this.publish({ phase: 'entry', error: '', fieldErrors: Object.freeze({}) }); }
  back(): void {
    if (this.ended) { if (this.state.phase === 'reopening') this.dependencies.leave?.(); return; }
    if (this.state.phase === 'blocked') { this.finish({ kind: 'failed', operationPhase: 'inventory', code: 'INVALID_SAVED_DATA', message: SAVED }); return; }
    if (!this.ended && !this.working && this.state.phase === 'entry' && !this.coordinator) this.publish({ phase: 'scope', error: '', fieldErrors: Object.freeze({}) });
    else this.cancel();
  }
  submit(input: { phrase: string; password: string; confirmation: string }): boolean {
    if (this.ended || this.working || this.state.phase !== 'entry') return false;
    const fieldErrors: { phrase?: string; password?: string; confirmation?: string } = {};
    const phrase = typeof input.phrase === 'string' && input.phrase.isWellFormed() ? input.phrase.normalize('NFKD').trim().replace(/\s+/gu, ' ') : '';
    if (!phrase || input.phrase.length > 4096 || ![12, 24].includes(phrase.split(' ').length)) fieldErrors.phrase = 'Enter your 12 or 24 recovery words in order.';
    if (!isNativeNewPassword(input.password))
      fieldErrors.password = NEW_PASSWORD_HELP;
    if (input.password !== input.confirmation) fieldErrors.confirmation = 'Your passwords do not match.';
    if (Object.keys(fieldErrors).length) { this.publish({ fieldErrors: Object.freeze(fieldErrors), error: '' }); return false; }
    this.working = true; const request = ++this.request;
    try {
      this.check(request); this.deadline = this.now() + 600000;
      this.coordinator ??= this.dependencies.createCoordinator();
    } catch { this.working = false; this.finish({ kind: 'failed', operationPhase: 'prepare', code: 'UNAVAILABLE', message: UNAVAILABLE }); return true; }
    this.timer && clearTimeout(this.timer);
    this.timer = setTimeout(() => this.cancel('expired'), 600000);
    this.publish({ phase: 'verifying', error: '', fieldErrors: Object.freeze({}) });
    void (async () => {
      try {
        this.check(request); const proof = await this.coordinator!.prepare(phrase, input.password, () => this.check(request)); this.check(request);
        this.proof = proof; this.publish({ phase: 'review' });
      } catch (cause) {
        if (this.ended || request !== this.request) return;
        const code = safeCode(cause);
        if (['WRONG_PHRASE', 'AUTH_THROTTLED', 'INVALID_INPUT'].includes(code)) {
          this.clearTimer(); this.deadline = null;
          this.publish({ phase: 'entry', error: code === 'WRONG_PHRASE' ? 'This recovery phrase does not match this wallet.' : code === 'AUTH_THROTTLED' ? 'Too many unsuccessful attempts. Wait a few minutes before trying again.' : 'Check the recovery phrase and new password.' });
        } else if (code === 'CANCELLED' || code === 'EXPIRED') this.cancel(code === 'EXPIRED' ? 'expired' : 'cancelled');
        else this.finish({ kind: 'failed', operationPhase: 'prepare', code, message: ['STATE_CHANGED', 'INVALID_SAVED_DATA'].includes(code) ? SAVED : UNAVAILABLE });
      } finally { this.working = false; }
    })();
    return true;
  }
  commit(): void {
    if (this.ended || this.working || this.state.phase !== 'review' || !this.proof || !this.coordinator) return;
    try { this.check(this.request); } catch { this.cancel('expired'); return; }
    this.working = true; const proof = this.proof; this.proof = null;
    this.publish({ phase: 'committing', error: '' });
    void (async () => {
      try {
        await this.coordinator!.commit(proof);
        this.finish({ kind: 'success', operationPhase: 'commit', code: 'committed-locked', message: 'Password changed. Unlock with your new password.' });
      } catch (cause) {
        this.finish({ kind: 'uncertain', operationPhase: 'commit', code: safeCode(cause), message: UNCERTAIN });
      } finally { this.working = false; }
    })();
  }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  cancel(reason: 'cancelled' | 'expired' = 'cancelled'): void {
    if (this.ended) return;
    const committing = this.state.phase === 'committing';
    this.finish({ kind: committing ? 'uncertain' : reason, operationPhase: committing ? 'commit' : this.state.phase === 'review' ? 'review' : this.coordinator ? 'prepare' : 'inventory', code: reason,
      message: committing ? UNCERTAIN : reason === 'expired' ? 'Recovery expired. Start again to verify your wallet.' : 'Recovery was cancelled.' });
  }
  private finish(outcome: RecoveryOutcome) {
    if (this.ended) return;
    this.ended = true; this.request++; this.proof = null; this.clearTimer();
    try { this.coordinator?.cancel(); } catch { outcome = { ...outcome, cleanupFailed: true }; }
    this.publish({ phase: 'reopening', error: '' });
    const failed = () => this.publish({ phase: 'blocked', error: `${outcome.message} The wallet could not be reopened. Close and reopen Pali to unlock.` });
    try { void this.dependencies.finish(Object.freeze(outcome)).then(() => this.publish({ phase: 'closed' }), failed); }
    catch { failed(); }
  }
}
