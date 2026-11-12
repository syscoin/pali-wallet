import type { NativeCustodyAuthority } from './authority.ts';
import { KeyringRuntimeError, type KeyringRuntime } from './keyringRuntime.ts';
import type { NativeOperationCredential } from './types.ts';

export type SeedBackupPresentation = Readonly<{
  id: string;
  words: readonly string[];
}>;

type PresentationOwner = { id: string; revision: number; fingerprint: string; runtime: KeyringRuntime['backup']; words: readonly string[]; attempts: number };

/** Secret presentation is short-lived and never part of a public snapshot. */
export class SeedBackupFlow {
  private presentation: PresentationOwner | null = null;
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
      if (snapshot.phase !== 'ready' ||
        (this.presentation && this.presentation.revision !== snapshot.revision)) this.cancel();
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
    this.presentation = null;
    for (const listener of [...this.clearListeners]) {
      try { listener(); } catch { /* observers cannot retain authority */ }
    }
    this.cancelling = false;
  }

  async begin(password: NativeOperationCredential): Promise<SeedBackupPresentation> {
    if (this.disposed) throw new Error('BACKUP_EXPIRED');
    if (this.busy) throw new Error('BUSY');
    const state = this.authority.getSnapshot();
    const runtime = this.runtime();
    if (!runtime || state.phase !== 'ready') throw new Error('NOT_READY');
    // Admit before notifying observers: a clear callback may synchronously reenter.
    this.busy = true;
    this.cancel();
    const operation = this.operation;
    const current = () => {
      const now = this.authority.getSnapshot();
      if (this.disposed || operation !== this.operation || this.runtime() !== runtime || now.revision !== state.revision ||
        now.phase !== 'ready') throw new Error('CANCELLED');
    };
    try {
      current();
      const words = await runtime.readPhrase(password); current();
      if (![12, 24].includes(words.length) || words.some((word) => !/^[a-z]+$/.test(word)))
        throw new Error('UNAVAILABLE');
      const fingerprint = await runtime.fingerprint(); current();
      const id = globalThis.crypto.randomUUID();
      current();
      const presentation = Object.freeze({ id, words: Object.freeze([...words]) });
      this.presentation = { id, fingerprint, revision: state.revision, runtime, words: presentation.words, attempts: 0 };
      return presentation;
    } catch (error) {
      const wasCurrent = !this.disposed && operation === this.operation;
      this.cancel();
      const now = this.authority.getSnapshot();
      let sameOwner = false, refusal = false;
      try {
        sameOwner = wasCurrent && !this.disposed && this.runtime() === runtime && now.revision === state.revision &&
          now.phase === 'ready' && now.account?.address === state.account?.address &&
          now.account?.network === state.account?.network;
        refusal = sameOwner && error instanceof KeyringRuntimeError && runtime.isAuthenticationRefusal(error) === true;
      } catch { /* An unavailable or replaced runtime cannot preserve authority. */ }
      if (!refusal && sameOwner) this.authority.lock();
      if (error instanceof Error && error.message === 'CANCELLED') throw new Error('CANCELLED');
      if (refusal && error instanceof KeyringRuntimeError)
        throw new Error(error.code);
      throw new Error('BACKUP_UNAVAILABLE');
    } finally { this.busy = false; }
  }

  /** Verify every supplied word before marking this protected presentation backed up. */
  async confirm(id: string, answers: readonly string[]): Promise<void> {
    if (this.disposed) throw new Error('BACKUP_EXPIRED');
    if (this.busy) throw new Error('BUSY');
    const presentation = this.presentation;
    const state = this.authority.getSnapshot();
    const runtime = this.runtime();
    if (!presentation || !runtime || presentation.runtime !== runtime || presentation.id !== id || presentation.revision !== state.revision ||
      state.phase !== 'ready') throw new Error('BACKUP_EXPIRED');
    const matches = Array.isArray(answers) && answers.length === presentation.words.length &&
      presentation.words.every((word, index) => {
        const slot = Object.getOwnPropertyDescriptor(answers, String(index));
        return slot && 'value' in slot && typeof slot.value === 'string' && slot.value.trim().toLowerCase() === word;
      });
    if (!matches) {
      if (++presentation.attempts >= 5) { this.cancel(); this.authority.lock(); throw new Error('BACKUP_EXPIRED'); }
      throw new Error('BACKUP_WORDS_MISMATCH');
    }
    this.busy = true;
    const operation = this.operation;
    const current = () => {
      const now = this.authority.getSnapshot();
      if (this.disposed || operation !== this.operation || this.runtime() !== runtime ||
        now.revision !== presentation.revision || now.phase !== 'ready')
        throw new Error('BACKUP_EXPIRED');
    };
    // One shot. Failed or ambiguous persistence requires a new authenticated presentation.
    this.presentation = null;
    try {
      current();
      await runtime.confirm(presentation.fingerprint);
      current();
      await this.authority.refreshAuthenticatedMetadata();
      current();
      const confirmed = this.authority.getSnapshot();
      if (confirmed.phase !== 'ready' || confirmed.backup !== 'confirmed' || confirmed.revision !== presentation.revision)
        throw new Error('BACKUP_UNAVAILABLE');
    } catch {
      this.authority.lock();
      throw new Error('BACKUP_UNAVAILABLE');
    } finally { this.cancel(); this.busy = false; }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.unsubscribe();
    this.clearListeners.clear();
  }
}
