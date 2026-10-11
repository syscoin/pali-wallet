import type { IVaultState } from 'state/vault/types';
import {
  IKeyringAccountState,
  INetwork,
  INetworkType,
  KeyringAccountType,
} from 'types/network';

import { isAccountCompatibleWithNetwork } from './accountCompatibility';

/** Local smart-account ownership is chain-specific, including before deployment. */
export const getLocalEvmRecipients = (
  accountBuckets: Partial<IVaultState['accounts']>,
  network: INetwork
): {
  accounts: IKeyringAccountState[];
  addresses: string[];
  incompatibleSmartAddresses: Set<string>;
} => {
  const accounts: IKeyringAccountState[] = [];
  const addresses = new Set<string>();
  const incompatibleSmartAddresses = new Set<string>();

  for (const [type, byId] of Object.entries(accountBuckets || {})) {
    for (const account of Object.values(byId || {})) {
      if (
        !account ||
        typeof account.address !== 'string' ||
        !/^0x[0-9a-f]{40}$/i.test(account.address)
      )
        continue;
      const address = account.address.toLowerCase();
      if (
        network.kind === INetworkType.Ethereum &&
        isAccountCompatibleWithNetwork(account, type, network)
      ) {
        accounts.push(account);
        addresses.add(address);
      } else if (type === KeyringAccountType.SmartAccount) {
        incompatibleSmartAddresses.add(address);
      }
    }
  }

  // An address can also belong to a compatible local account. Bucket order
  // must not block that destination merely because another chain uses it.
  for (const address of addresses) incompatibleSmartAddresses.delete(address);

  return { accounts, addresses: [...addresses], incompatibleSmartAddresses };
};
