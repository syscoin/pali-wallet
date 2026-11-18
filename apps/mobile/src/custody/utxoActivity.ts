import type { UtxoActivityContext, UtxoActivityOwner, UtxoActivityReader } from '../core/utxoActivity.ts';
import { UtxoActivityRows } from '../core/utxoActivityRows.ts';
import { findUtxoNetwork } from '../core/utxoNetworks.ts';
import { CustodyOperationError, type NativeCustodyAuthority } from './authority.ts';
import type { KeyringRuntime } from './keyringRuntime.ts';

type ActivityAuthority = Pick<NativeCustodyAuthority, 'getSnapshot' | 'getCatalogue' | 'subscribe'>;
type ActivityRuntime = Pick<KeyringRuntime, 'withUtxoActivityRead'>;
type NativeUtxoActivity = UtxoActivityOwner & Readonly<{ reset(assertCurrent: () => void): Promise<void> }>;

/** Adapt selected custody without exposing its account key or vault lease to Activity. */
export function createNativeUtxoActivity(
  authority: ActivityAuthority,
  runtime: () => ActivityRuntime | undefined,
  reader: UtxoActivityReader,
): NativeUtxoActivity {
  const capture = () => {
    const snapshot = authority.getSnapshot(), catalogue = authority.getCatalogue(), selected = runtime();
    if (snapshot.phase !== 'ready' || !snapshot.account || !catalogue || !selected ||
        snapshot.account.network !== catalogue.active.networkId) return null;
    const account = catalogue.accounts.find((item) => item.id === catalogue.active.accountId);
    const network = findUtxoNetwork(catalogue.active.networkId, catalogue.utxoNetworks);
    if (!account || !network || account.address !== snapshot.account.address) return null;
    const context: UtxoActivityContext = Object.freeze({
      accountId: account.id, networkId: network.id, address: account.address, generation: snapshot.revision,
    });
    return { context, catalogue, network, selected };
  };
  const getUtxoActivityContext = () => capture()?.context ?? null;
  const rows = new UtxoActivityRows(reader, getUtxoActivityContext, (signal, assertView, read, refresh) => {
    const owner = capture();
    if (!owner) return Promise.reject(new CustodyOperationError('NOT_READY'));
    const assertOwner = () => {
      const live = authority.getSnapshot(), { generation, networkId, address } = owner.context;
      if (owner.selected !== runtime() || owner.catalogue !== authority.getCatalogue() ||
          live.phase !== 'ready' || live.revision !== generation || live.account?.network !== networkId ||
          live.account.address !== address) throw new CustodyOperationError('CANCELLED');
    };
    return owner.selected.withUtxoActivityRead(owner.context, signal, assertOwner, assertView, read, refresh);
  });
  return Object.freeze<NativeUtxoActivity>({
    getUtxoActivityContext,
    getUtxoExplorer(id) {
      const network = capture()?.network;
      if (network?.id !== id) throw new CustodyOperationError('NOT_READY');
      return network.explorer;
    },
    subscribe: (listener) => authority.subscribe(listener),
    async reset(assertCurrent: () => void) {
      assertCurrent();
      if (!getUtxoActivityContext()) throw new CustodyOperationError('NOT_READY');
      rows.releaseUtxoActivity();
      const request = new AbortController();
      try {
        await rows.readUtxoActivityPage({ page: 1 }, request.signal, assertCurrent);
        assertCurrent();
      } finally { request.abort(); }
    },
    readUtxoActivityPage: rows.readUtxoActivityPage,
    readUtxoActivityDetail: rows.readUtxoActivityDetail,
    retainUtxoActivityRows: rows.retainUtxoActivityRows,
    releaseUtxoActivity: rows.releaseUtxoActivity,
  });
}
