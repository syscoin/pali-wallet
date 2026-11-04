import { createWatchAccount, validatePublicAccounts, type WatchAccountNetwork } from './watchOnlyAuthority.ts';
import type { NetworkId, PublicAccount } from './types.ts';
import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
export type WatchAccountState = Readonly<{ status: 'opening' | 'ready' | 'unavailable'; accounts: readonly PublicAccount[]; busy: boolean }>;
export type WatchAccountStorage = Readonly<{
  load(): Promise<readonly PublicAccount[]>;
  compareAndSet(expected: readonly PublicAccount[], accounts: readonly PublicAccount[]): Promise<void>;
}>;
export type WatchAccountChange = Readonly<{ kind: 'add'; id: string; name: string; address: string; network?: WatchAccountNetwork } | { kind: 'rename'; id: string; name: string } | { kind: 'remove'; id: string }>;
/** The public address store is independent of the encrypted native catalogue. */
export class WatchAccounts {
  private state: WatchAccountState = Object.freeze({ status: 'opening', accounts: Object.freeze([]), busy: false });
  private listeners = new Set<() => void>();
  private readonly storage: WatchAccountStorage;
  constructor(storage: WatchAccountStorage) { this.storage = storage; }
  getSnapshot = (): WatchAccountState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(state: WatchAccountState): void { this.state = Object.freeze(state); for (const listener of this.listeners) listener(); }
  async load(): Promise<void> {
    if (this.state.busy) throw new Error('Another account change is still saving.');
    this.publish({ ...this.state, busy: true });
    try { const accounts = validatePublicAccounts(await this.storage.load()); this.publish({ status: 'ready', accounts, busy: false }); }
    catch { this.publish({ ...this.state, status: 'unavailable', busy: false }); throw new Error('Your saved watch accounts could not be read. Nothing has been replaced. Retry to reopen them.'); }
  }
  async change(change: WatchAccountChange): Promise<readonly PublicAccount[]> {
    if (this.state.status !== 'ready') throw new Error('Reopen your saved watch accounts before making changes.');
    if (this.state.busy) throw new Error('Another account change is still saving.');
    assertJsonWorkBudget(change, 2048, 2, 20);
    const kind = change && typeof change === 'object' ? Object.getOwnPropertyDescriptor(change, 'kind') : undefined;
    if (!kind || !kind.enumerable || !('value' in kind)) throw new Error('Invalid watch account change');
    const fields = change?.kind === 'add' ? ['kind', 'id', 'name', 'address', ...(Object.hasOwn(change, 'network') ? ['network'] : [])]
      : change?.kind === 'rename' ? ['kind', 'id', 'name'] : change?.kind === 'remove' ? ['kind', 'id'] : [];
    if (!change || typeof change !== 'object' || Array.isArray(change) || !fields.length ||
        Reflect.ownKeys(change).length !== fields.length || Object.keys(change).length !== fields.length ||
        Object.keys(change).some((key) => !fields.includes(key)) || typeof change.id !== 'string' ||
        ('name' in change && typeof change.name !== 'string') || ('address' in change && typeof change.address !== 'string'))
      throw new Error('Invalid watch account change');
    const previous = this.state.accounts;
    let next: readonly PublicAccount[];
    if (change.kind === 'add') {
      const account = createWatchAccount(change.id, change.name.trim(), change.address, change.network);
      if (previous.some((entry) => Object.entries(account.addresses).some(([network, address]) => entry.addresses[network as NetworkId] === address)))
        throw new Error('This address is already being watched.');
      next = validatePublicAccounts([...previous, account]);
    } else {
      if (!previous.some((entry) => entry.id === change.id)) throw new Error('This watch account is no longer available.');
      next = validatePublicAccounts(change.kind === 'remove' ? previous.filter((entry) => entry.id !== change.id) : previous.map((entry) => entry.id === change.id ? { ...entry, name: change.name.trim() } : entry));
    }
    this.publish({ ...this.state, busy: true });
    try {
      await this.storage.compareAndSet(previous, next);
      this.publish({ status: 'ready', accounts: next, busy: false });
      return next;
    } catch {
      // A failed write may have reached the device. Do not overwrite it from a stale snapshot.
      this.publish({ status: 'unavailable', accounts: previous, busy: false });
      throw new Error('The watch account change could not be verified. Your saved data has been preserved. Retry to reopen it before making another change.');
    }
  }
}
