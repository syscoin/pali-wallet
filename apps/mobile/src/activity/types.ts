import { isNativeAccountId } from '../custody/accountIdentity.ts';
import { getAddress } from 'ethers/address';
import { keccak256 } from 'ethers/crypto';
import { toUtf8Bytes } from 'ethers/utils';
import { EVM_NETWORK_DEFINITIONS } from '../../../../source/shared/evmNetworks.ts';
import {
  getNativeNetwork,
  snapshotNativeNetwork,
  type NativeNetworkRegistration,
} from '../custody/networkContext.ts';

export type ActivityScope = Readonly<{
  walletFingerprint: string;
  accountId: string;
  address: string;
  network: NativeNetworkRegistration;
  key: string;
  sourceId: string;
  apiUrl: string;
  explorerUrl: string;
}>;
export type TerminalActivityRecord = Readonly<{
  walletFingerprint: string;
  accountId: string;
  address: string;
  networkId: string;
  registrationHash: string;
  chainId: string;
  hash: string;
  phase: 'confirmed' | 'reverted' | 'nonce-consumed';
  nonce: number;
  createdAt: number;
  recipient: string;
  amountUnits: string;
  maximumFeeUnits: string;
  token?: Readonly<{
    contractAddress: string;
    decimals: number;
    symbol: string;
    name: string;
  }>;
}>;
export const LOCAL_ACTIVITY_LIMIT = 48;
export type LocalActivityRecord = Omit<TerminalActivityRecord, 'phase' | 'recipient'> &
  Readonly<{
    recipient: string | null;
    phase:
      | 'signed'
      | 'attempted'
      | 'submitted'
      | 'confirmed'
      | 'reverted'
      | 'nonce-consumed';
  }>;
export type ActivityCandidate = Readonly<{
  hash: string;
  blockNumber: string;
  timestamp: number | null;
  tokenHint: boolean;
}>;
export type ActivityViewState = Readonly<{
  filter: 'all' | 'sent' | 'received';
  showZero: boolean;
  anchor: string | null;
  offset: number;
}>;
export const DEFAULT_ACTIVITY_VIEW: ActivityViewState = Object.freeze({
  filter: 'all',
  showZero: false,
  anchor: null,
  offset: 0,
});
export class ActivityError extends Error {
  readonly code:
    | 'INVALID'
    | 'UNAVAILABLE'
    | 'CANCELLED'
    | 'CHANGED'
    | 'REOPEN_REQUIRED'
    | 'CONFLICT';
  constructor(code: ActivityError['code']) {
    super(code);
    this.code = code;
    this.name = 'ActivityError';
  }
}
export function localScopeKey(
  value: Pick<
    TerminalActivityRecord,
    'walletFingerprint' | 'accountId' | 'address' | 'chainId'
  >
): string {
  return keccak256(
    toUtf8Bytes(
      JSON.stringify([
        value.walletFingerprint,
        value.accountId,
        value.address,
        value.chainId,
      ])
    )
  );
}
export function createActivityScope(
  walletFingerprint: string,
  accountId: string,
  address: string,
  networkId: string | NativeNetworkRegistration
): ActivityScope {
  if (
    !/^[0-9a-f]{64}$/.test(walletFingerprint) ||
    !isNativeAccountId(accountId)
  )
    throw new ActivityError('INVALID');
  const network = typeof networkId === 'string' ? getNativeNetwork(networkId) : snapshotNativeNetwork(networkId);
  const definition = EVM_NETWORK_DEFINITIONS.find((item) => item.id === network.id && item.network.url === network.rpcUrl && String(item.network.chainId) === network.chainId);
  const apiUrl = definition?.network.apiUrl ?? '';
  const explorerUrl = definition?.network.explorer ?? '';
  const normalized = getAddress(address);
  const key = localScopeKey({
    walletFingerprint,
    accountId,
    address: normalized,
    chainId: network.chainId,
  });
  const sourceId = keccak256(
    toUtf8Bytes(JSON.stringify([key, apiUrl, 'etherscan-account-v1']))
  );
  return Object.freeze({
    walletFingerprint,
    accountId,
    address: normalized,
    network,
    key,
    sourceId,
    apiUrl,
    explorerUrl,
  });
}
