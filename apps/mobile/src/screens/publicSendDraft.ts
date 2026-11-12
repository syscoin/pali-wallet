import type { CustodySnapshot } from '../custody/types.ts';
import type { NativeWalletCatalogueSnapshot } from '../custody/walletCatalogue.ts';
import { findUtxoNetwork } from '../core/utxoNetworks.ts';
import { getNativeNetwork } from '../custody/networkContext.ts';

/** Navigation identity only. This never grants a transaction or secret capability. */
export type PublicSendContext = Readonly<{
  context: string;
  identity: string;
  accountId: string;
  address: string;
  networkIdentity: string;
}>;

export function publicSendContext(state?: CustodySnapshot, catalogue?: NativeWalletCatalogueSnapshot | null): PublicSendContext | null {
  if (!state?.account || !catalogue || !['ready', 'backup-required'].includes(state.phase) ||
      state.phase === 'backup-required' && state.backup !== 'unconfirmed') return null;
  const selected = catalogue.accounts.find(account => account.id === catalogue.active.accountId);
  if (catalogue.active.networkId !== state.account.network || selected?.address !== state.account.address) return null;
  try {
    const network = findUtxoNetwork(state.account.network, catalogue.utxoNetworks) ?? getNativeNetwork(state.account.network, catalogue.networks);
    const identity = `${catalogue.active.accountId}:${state.account.network}`;
    return Object.freeze({ context: `${state.revision}:${identity}`, identity,
      accountId: catalogue.active.accountId, address: state.account.address,
      networkIdentity: JSON.stringify(network) });
  } catch { return null; }
}

/** Backup may advance the revision, but cannot change the draft's destination. */
export function samePublicSendDestination(before: PublicSendContext, after: PublicSendContext): boolean {
  return before.identity === after.identity && before.accountId === after.accountId &&
    before.address === after.address && before.networkIdentity === after.networkIdentity;
}
