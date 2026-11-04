import { createWatchAccount, type WatchAccountNetwork } from './watchOnlyAuthority.ts';
import { createWatchAccountCodec, type StoredWatchAccount } from './watchAccountCodec.ts';
import { parseUtxoPublicIdentifier } from './utxoIdentifier.ts';
import type { WatchRecordSnapshot } from './publicAccountStorage.ts';
import type { NetworkId, PublicAccount } from './types.ts';
import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
export type WatchAccountState = Readonly<{ status: 'opening' | 'ready' | 'unavailable'; accounts: readonly PublicAccount[]; busy: boolean }>;
export type WatchAccountStorage = Readonly<{
  load(): Promise<WatchRecordSnapshot>;
  compareAndSet(expected: WatchRecordSnapshot, records: readonly StoredWatchAccount[]): Promise<WatchRecordSnapshot>;
}>;
export type WatchAccountChange = Readonly<{ kind: 'add'; id: string; name: string; address: string; network?: WatchAccountNetwork } | { kind: 'rename'; id: string; name: string } | { kind: 'remove'; id: string }>;
/** The public address store is independent of the encrypted native catalogue. */
export class WatchAccounts {
  private state: WatchAccountState = Object.freeze({ status: 'opening', accounts: Object.freeze([]), busy: false });
  private listeners = new Set<() => void>();
  private readonly storage: WatchAccountStorage;
  private saved: WatchRecordSnapshot | null = null;
  constructor(storage: WatchAccountStorage) { this.storage = storage; }
  getSnapshot = (): WatchAccountState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(state: WatchAccountState): void { this.state = Object.freeze(state); for (const listener of this.listeners) listener(); }
  async load(): Promise<void> {
    if (this.state.busy) throw new Error('Another account change is still saving.');
    this.publish({ ...this.state, busy: true });
    try { const saved = await this.storage.load(); const decoded = createWatchAccountCodec().validate(saved.records);
      if (JSON.stringify(decoded.accounts) !== JSON.stringify(saved.accounts)) throw new Error('Invalid saved projection');
      this.saved = saved; this.publish({ status: 'ready', accounts: decoded.accounts, busy: false }); }
    catch { this.publish({ ...this.state, status: 'unavailable', busy: false }); throw new Error('Your saved watch accounts could not be read. Nothing has been replaced. Retry to reopen them.'); }
  }
  async change(change: WatchAccountChange): Promise<readonly PublicAccount[]> {
    if (this.state.status !== 'ready' || !this.saved) throw new Error('Reopen your saved watch accounts before making changes.');
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
    let next: readonly StoredWatchAccount[];
    if (change.kind === 'add') {
      const network = change.network ?? 'evm';
      const source = network === 'evm' ? null : parseUtxoPublicIdentifier(change.address, network);
      const account = createWatchAccount(change.id, change.name.trim(), source?.address ?? change.address, network);
      if (previous.some((entry) => Object.entries(account.addresses).some(([networkId, address]) => entry.addresses[networkId as NetworkId] === address)))
        throw new Error('This account is already being watched.');
      const record: StoredWatchAccount = source?.kind === 'account' && network !== 'evm'
        ? Object.freeze({ kind: 'utxo-public', id: account.id, name: account.name, networkId: network, identifier: source.identifier })
        : Object.freeze({ kind: 'address', ...account });
      next = [...this.saved.records, record];
    } else {
      if (!previous.some((entry) => entry.id === change.id)) throw new Error('This watch account is no longer available.');
      next = change.kind === 'remove' ? this.saved.records.filter((entry) => entry.id !== change.id) : this.saved.records.map((entry) => entry.id === change.id ? { ...entry, name: change.name.trim() } : entry);
    }
    const validated = createWatchAccountCodec().validate(next);
    this.publish({ ...this.state, busy: true });
    try {
      const saved = await this.storage.compareAndSet(this.saved, validated.records);
      if (JSON.stringify(saved.records) !== JSON.stringify(validated.records) || JSON.stringify(saved.accounts) !== JSON.stringify(validated.accounts)) throw new Error('Saved records changed');
      this.saved = saved;
      this.publish({ status: 'ready', accounts: validated.accounts, busy: false });
      return validated.accounts;
    } catch {
      // A failed write may have reached the device. Do not overwrite it from a stale snapshot.
      this.publish({ status: 'unavailable', accounts: previous, busy: false });
      throw new Error('The watch account change could not be verified. Your saved data has been preserved. Retry to reopen it before making another change.');
    }
  }
}
