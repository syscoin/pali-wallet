import type { EvmDisplayTransaction } from '../../../../source/shared/evmTransactionDisplay.ts';
import type { SmartAccountActivityIdentity } from '../../../../source/wallet/smartAccountActivity.ts';
import type { NftTransferIntent } from '../../../../source/shared/nftTransfer.ts';
import { isNativeAccountId } from '../custody/accountIdentity.ts';
import { getAddress } from 'ethers/address';
import { keccak256 } from 'ethers/crypto';
import { toUtf8Bytes } from 'ethers/utils';
import { findRegisteredEvmNetwork } from '../../../../source/shared/evmNetworks.ts';
import {
  getNativeNetwork,
  snapshotNativeNetwork,
  type NativeNetworkRegistration,
} from '../custody/networkContext.ts';

export type EvmActivityReadScope = Readonly<{
  address: string;
  network: NativeNetworkRegistration;
  key: string;
  sourceId: string;
  apiUrl: string;
  explorerUrl: string;
}>;
/** Custody persistence keeps its existing seed/account binding and wire format. */
export type ActivityScope = EvmActivityReadScope &
  Readonly<{ walletFingerprint: string; accountId: string }>;
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
  smartAccount?: SmartAccountActivityIdentity;
  collectibleTransfer?: NftTransferIntent;
  token?: Readonly<{
    contractAddress: string;
    decimals: number;
    symbol: string;
    name: string;
  }>;
}>;
export type ArchivedActivityRecord = TerminalActivityRecord |
  (Omit<TerminalActivityRecord, 'phase' | 'smartAccount'> & Readonly<{
    phase: 'submitted'; smartAccount: SmartAccountActivityIdentity;
  }>);
export const LOCAL_ACTIVITY_LIMIT = 48;
export type LocalActivityRecord = Omit<
  TerminalActivityRecord,
  'phase' | 'recipient'
> &
  Readonly<{
    recipient: string | null;
    inspectionOnly?: true;
    speedUpEligible?: true;
    operation?: import('../../../../source/wallet/evmSignedRecords.ts').EvmSignedRecordSummary['operation'];
    originalHash?: string;
    transactionType?: number | null;
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
/** Full shared mapper output is transient. The persisted candidate stays four fields. */
export type IndexedActivityTransaction = EvmDisplayTransaction &
  Readonly<{
    hash: string;
    from: string;
    to: string | null;
    tokenRecipient?: string;
    timestamp: number;
    confirmations: number;
    blockNumber?: number;
    blockHash?: string;
    nonce?: number;
    txreceipt_status?: unknown;
    isError?: unknown;
  }>;
export type DiscoveredActivityCandidate = ActivityCandidate &
  Readonly<{ indexed: IndexedActivityTransaction; tokenEvent?: Readonly<Record<string, unknown>> }>;
export const activityCandidateSummary = (
  row: ActivityCandidate
): ActivityCandidate =>
  Object.freeze({
    hash: row.hash,
    blockNumber: row.blockNumber,
    timestamp: row.timestamp,
    tokenHint: row.tokenHint,
  });
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
  const normalized = getAddress(address);
  const key = localScopeKey({
    walletFingerprint,
    accountId,
    address: normalized,
    chainId: (typeof networkId === 'string'
      ? getNativeNetwork(networkId)
      : snapshotNativeNetwork(networkId)
    ).chainId,
  });
  const read = createActivityReadScope(key, normalized, networkId);
  return Object.freeze({
    walletFingerprint,
    accountId,
    address: read.address,
    network: read.network,
    key: read.key,
    sourceId: read.sourceId,
    apiUrl: read.apiUrl,
    explorerUrl: read.explorerUrl,
  });
}

/** Shared query scope; the caller supplies its real owner key, never fake custody. */
export function createActivityReadScope(
  key: string,
  address: string,
  networkId: string | NativeNetworkRegistration
): EvmActivityReadScope {
  if (!/^0x[0-9a-f]{64}$/.test(key)) throw new ActivityError('INVALID');
  const network =
    typeof networkId === 'string'
      ? getNativeNetwork(networkId)
      : snapshotNativeNetwork(networkId);
  const definition = findRegisteredEvmNetwork(network);
  const apiUrl = definition?.network.apiUrl ?? '';
  const explorerUrl = definition?.network.explorer ?? '';
  const normalized = getAddress(address);
  const sourceId = keccak256(
    toUtf8Bytes(JSON.stringify([key, apiUrl, 'etherscan-account-v1']))
  );
  return Object.freeze({
    address: normalized,
    network,
    key,
    sourceId,
    apiUrl,
    explorerUrl,
  });
}
