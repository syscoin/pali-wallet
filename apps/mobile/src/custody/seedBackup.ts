import type { NativeCustodyAuthority } from './authority.ts';
import { KeyringRuntimeError, type KeyringRuntime } from './keyringRuntime.ts';

export type SeedBackupPresentation = Readonly<{
  id: string;
  words: readonly string[];
}>;

type PresentationOwner = Readonly<{ id: string; revision: number; fingerprint: string; runtime: KeyringRuntime['backup'] }>;

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
      if (!['ready', 'backup-required'].includes(snapshot.phase) ||
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
      if (this.disposed || operation !== this.operation || this.runtime() !== runtime || now.revision !== state.revision ||
        !['ready', 'backup-required'].includes(now.phase)) throw new Error('CANCELLED');
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
      this.presentation = { id, fingerprint, revision: state.revision, runtime };
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

  /** Save the user's acknowledgement, not proof that they know the phrase. */
  async acknowledge(id: string): Promise<void> {
    if (this.disposed) throw new Error('BACKUP_EXPIRED');
    if (this.busy) throw new Error('BUSY');
    const presentation = this.presentation;
    const state = this.authority.getSnapshot();
    const runtime = this.runtime();
    if (!presentation || !runtime || presentation.runtime !== runtime || presentation.id !== id || presentation.revision !== state.revision ||
      !['ready', 'backup-required'].includes(state.phase)) throw new Error('BACKUP_EXPIRED');
    this.busy = true;
    const operation = this.operation;
    const current = () => {
      const now = this.authority.getSnapshot();
      if (this.disposed || operation !== this.operation || this.runtime() !== runtime ||
        now.revision !== presentation.revision || !['ready', 'backup-required'].includes(now.phase))
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
