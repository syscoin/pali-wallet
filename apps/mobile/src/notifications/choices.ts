import type { NativeMonitoringSnapshot } from '../custody/walletCatalogue.ts';
import { utxoRegistrationData } from '../core/utxoNetworks.ts';
import type { NativeNotificationScope } from './types.ts';
import type { WatchOnlyAuthority } from '../core/watchOnlyAuthority.ts';

export type NotificationChoice = Readonly<{
  scope: NativeNotificationScope;
  label: string;
  networkName: string;
  symbol: string;
}>;

/** Reuses saved public identities; never derives an account or changes selection. */
export function nativeNotificationChoices(snapshot: NativeMonitoringSnapshot): readonly NotificationChoice[] {
  return Object.freeze(snapshot.accounts.flatMap(({ account, identifier, isAccount, kind, chainId }) => {
    const networks = kind === 'utxo'
      ? snapshot.utxoNetworks.filter(network => network.chainId === chainId && network.slip44 === account.slip44)
      : snapshot.networks.filter(network => account.type !== 'SmartAccount' || String(account.smartAccount?.chainId) === network.chainId);
    return networks.map(network => Object.freeze({
      label: account.label,
      networkName: network.name,
      symbol: network.symbol,
      scope: Object.freeze({ id: `native:${account.id}:${network.id}`, accountId: account.id,
        accountType: account.type, accountAddress: account.address,
        network: network.kind === 'utxo' ? utxoRegistrationData(network) : network,
        ...(kind === 'utxo' ? { identifier, isAccount } : { guardian: account.type === 'SmartAccount' }),
      }),
    }));
  }));
}

export function watchNotificationChoices(authority: WatchOnlyAuthority): readonly NotificationChoice[] {
  return Object.freeze(authority.getMonitoringEntries().map(entry => Object.freeze({
    label: entry.label, networkName: entry.network.name, symbol: entry.network.symbol,
    scope: Object.freeze({ id: `watch:${entry.accountId}:${entry.network.id}`,
      accountId: entry.accountId, accountType: 'watch', accountAddress: entry.address,
      network: entry.network.kind === 'utxo' ? utxoRegistrationData(entry.network) : entry.network,
      ...(entry.network.kind === 'utxo' ? { identifier: entry.identifier, isAccount: entry.isAccount } : { guardian: true }),
    }),
  })));
}
