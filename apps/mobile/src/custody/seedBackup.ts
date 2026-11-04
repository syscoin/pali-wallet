import type { NativeCustodyAuthority } from './authority.ts';
import { KeyringRuntimeError, type KeyringRuntime } from './keyringRuntime.ts';

export type SeedBackupPresentation = Readonly<{
  id: string;
  words: readonly string[];
  positions: readonly number[];
}>;

type Challenge = SeedBackupPresentation & { revision: number; fingerprint: string; attempts: number };

/** Secret presentation is short-lived and never part of a public snapshot. */
export class SeedBackupFlow {
  private challenge: Challenge | null = null;
  private operation = 0;
  private busy = false;
  private disposed = false;
  private cancelling = false;
  private readonly authority: NativeCustodyAuthority;
  private readonly runtime: () => KeyringRuntime['backup'] | undefined;
  private readonly unsubscribe: () => void;
  private readonly clearListeners = new Set<() => void>();

  constructor(
    authority: NativeCustodyAuthority,
    runtime: () => KeyringRuntime['backup'] | undefined
  ) {
    this.authority = authority;
    this.runtime = runtime;
    this.unsubscribe = authority.subscribe((snapshot) => {
      if (!['ready', 'backup-required'].includes(snapshot.phase) ||
        (this.challenge && this.challenge.revision !== snapshot.revision)) this.cancel();
    });
  }

  onClear(listener: () => void): () => void {
    this.clearListeners.add(listener);
    return () => this.clearListeners.delete(listener);
  }

  cancel(): void {
    if (this.cancelling) return;
    this.cancelling = true;
    this.operation++;
    this.challenge = null;
    for (const listener of [...this.clearListeners]) {
      try { listener(); } catch { /* observers cannot retain authority */ }
    }
    this.cancelling = false;
  }

  async begin(password: string): Promise<SeedBackupPresentation> {
    if (this.disposed) throw new Error('BACKUP_EXPIRED');
    if (this.busy) throw new Error('BUSY');
    const state = this.authority.getSnapshot();
    const runtime = this.runtime();
    if (!runtime || !['ready', 'backup-required'].includes(state.phase)) throw new Error('NOT_READY');
    // Admit before notifying observers: a clear callback may synchronously reenter.
    this.busy = true;
    this.cancel();
    const operation = this.operation;
    const current = () => {
      const now = this.authority.getSnapshot();
      if (this.disposed || operation !== this.operation || now.revision !== state.revision ||
        !['ready', 'backup-required'].includes(now.phase)) throw new Error('CANCELLED');
    };
    try {
      current();
      const words = await runtime.readPhrase(password); current();
      if (![12, 24].includes(words.length) || words.some((word) => !/^[a-z]+$/.test(word)))
        throw new Error('UNAVAILABLE');
      const fingerprint = await runtime.fingerprint(); current();
      const positions = new Set<number>();
      // Unbiased sampling; a broken entropy source cannot spin indefinitely.
      for (let attempts = 0; positions.size < 3 && attempts < 64; attempts++) {
        const bytes = new Uint32Array(1);
        if (globalThis.crypto.getRandomValues(bytes) !== bytes) throw new Error('UNAVAILABLE');
        const bound = Math.floor(0x1_0000_0000 / words.length) * words.length;
        if (bytes[0]! < bound) positions.add(bytes[0]! % words.length);
      }
      if (positions.size !== 3) throw new Error('UNAVAILABLE');
      const id = globalThis.crypto.randomUUID();
      current();
      const presentation = Object.freeze({
        id, words: Object.freeze([...words]), positions: Object.freeze([...positions].sort((a, b) => a - b)),
      });
      this.challenge = { ...presentation, fingerprint, revision: state.revision, attempts: 0 };
      return presentation;
    } catch (error) {
      this.cancel();
      this.authority.lock();
      if (error instanceof Error && error.message === 'CANCELLED') throw new Error('CANCELLED');
      if (error instanceof KeyringRuntimeError &&
        (error.code === 'INVALID_CREDENTIAL' || error.code === 'AUTH_THROTTLED'))
        throw new Error(error.code);
      throw new Error('BACKUP_UNAVAILABLE');
    } finally { this.busy = false; }
  }

  async confirm(id: string, answers: readonly string[]): Promise<void> {
    if (this.disposed) throw new Error('BACKUP_EXPIRED');
    if (this.busy) throw new Error('BUSY');
    const challenge = this.challenge;
    const state = this.authority.getSnapshot();
    const runtime = this.runtime();
    if (!challenge || !runtime || challenge.id !== id || challenge.revision !== state.revision ||
      !['ready', 'backup-required'].includes(state.phase)) throw new Error('BACKUP_EXPIRED');
    // Check each own slot: Array.some would silently accept a sparse answer list.
    const matches = Array.isArray(answers) && answers.length === 3 &&
      [0, 1, 2].every((index) => {
        const slot = Object.getOwnPropertyDescriptor(answers, String(index));
        return slot && 'value' in slot && typeof slot.value === 'string' &&
          slot.value.trim().toLowerCase() === challenge.words[challenge.positions[index]!];
      });
    if (!matches) {
      challenge.attempts++;
      if (challenge.attempts >= 5) {
        this.cancel();
        this.authority.lock();
        throw new Error('BACKUP_EXPIRED');
      }
      throw new Error('BACKUP_WORDS_MISMATCH');
    }
    this.busy = true;
    const operation = this.operation;
    // One shot. Failed or ambiguous persistence requires a new authenticated challenge.
    this.challenge = null;
    try {
      await runtime.confirm(challenge.fingerprint);
      if (operation !== this.operation || this.authority.getSnapshot().revision !== challenge.revision)
        throw new Error('BACKUP_EXPIRED');
      await this.authority.refreshAuthenticatedMetadata();
      if (operation !== this.operation) throw new Error('BACKUP_EXPIRED');
      if (this.authority.getSnapshot().backup !== 'confirmed') throw new Error('BACKUP_UNAVAILABLE');
    } catch {
      this.authority.lock();
      throw new Error('BACKUP_UNAVAILABLE');
    } finally { this.busy = false; this.cancel(); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.unsubscribe();
    this.clearListeners.clear();
  }
}
