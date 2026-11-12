import { isHexString } from './ethersV6Compat.ts';
import type {
  IKeyringAccountState,
  INetwork,
  KeyringAccountType,
} from '../types/network.ts';

type AccountForCompatibility = Pick<IKeyringAccountState, 'address'> &
  Partial<Pick<IKeyringAccountState, 'slip44'>> & {
    smartAccount?: Pick<
      NonNullable<IKeyringAccountState['smartAccount']>,
      'chainId'
    >;
  };

/**
 * Account buckets can briefly be delivered separately from the active network
 * while a slip44 switch is being reconciled. Keep incompatible address families
 * out of both the account picker and account-selection entry points.
 */
export const isAccountCompatibleWithNetwork = (
  account: AccountForCompatibility | null | undefined,
  type: KeyringAccountType | string,
  network: Pick<INetwork, 'kind' | 'chainId' | 'slip44'>
): boolean => {
  if (!account) return false;

  if (String(type) === 'SmartAccount') {
    return (
      network.kind === 'ethereum' &&
      Number(account.smartAccount?.chainId) === Number(network.chainId)
    );
  }

  if (typeof account.address !== 'string' || account.address.length === 0) {
    return false;
  }

  if (network.kind === 'syscoin') {
    if (isHexString(account.address)) return false;

    // UTXO accounts are not interchangeable: a Bitcoin account (slip44 0)
    // must not appear on Syscoin (slip44 57), for example. Address-family-only
    // filtering cannot distinguish those networks.
    return account.slip44 === undefined
      ? true
      : Number(account.slip44) === Number(network.slip44);
  }

  return isHexString(account.address);
};

export function getFirstCompatibleAccountForNetwork(
  accounts: Record<string, Record<number, IKeyringAccountState> | undefined>,
  network: Pick<INetwork, 'kind' | 'chainId' | 'slip44'>
) {
  for (const [type, entries] of Object.entries(accounts)) {
    for (const account of Object.values(entries || {})) {
      if (isAccountCompatibleWithNetwork(account, type, network))
        return { account, id: account.id, type: type as KeyringAccountType };
    }
  }
  return null;
}
