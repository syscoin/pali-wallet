import {
  IKeyringAccountState,
  INetwork,
  INetworkType,
  KeyringAccountType,
} from 'types/network';
import { isHexString } from 'utils/ethersV6Compat';

type AccountForCompatibility = Pick<IKeyringAccountState, 'address'> &
  Partial<Pick<IKeyringAccountState, 'slip44' | 'smartAccount'>>;

/**
 * Account buckets can briefly be delivered separately from the active network
 * while a slip44 switch is being reconciled. Keep incompatible address families
 * out of both the account picker and account-selection entry points.
 */
export const isAccountCompatibleWithNetwork = (
  account: AccountForCompatibility | null | undefined,
  type: KeyringAccountType | string,
  network: INetwork
): boolean => {
  if (!account) return false;

  if (String(type) === KeyringAccountType.SmartAccount) {
    return (
      network.kind === INetworkType.Ethereum &&
      Number(account.smartAccount?.chainId) === Number(network.chainId)
    );
  }

  if (typeof account.address !== 'string' || account.address.length === 0) {
    return false;
  }

  if (network.kind === INetworkType.Syscoin) {
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
