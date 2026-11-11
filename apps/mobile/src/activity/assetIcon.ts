import { assetIconIdentityKey, type AssetIconIdentity } from '../../../../source/shared/assetIconIdentity.ts';
import type { ActivityRow } from './nativeActivity.ts';
import type { UtxoActivityRow } from '../core/utxoActivity.ts';

/** Use a full public asset identity only when it describes the displayed row. */
export function activityAssetIcon(row: ActivityRow, chainId: string | null, registrationHash?: string | null): AssetIconIdentity | undefined {
  if (!chainId) return;
  let contractAddress: unknown, decimals: unknown;
  if (row.indexed) {
    if (!row.display?.isErc20Transfer && !row.display?.isNft) return;
    const token = row.indexed.tokenTransfer;
    const sameChain = (value: unknown) => value === undefined || ['string', 'number', 'bigint'].includes(typeof value) && String(value) === chainId;
    if (!sameChain(row.indexed.chainId) || !sameChain(token?.chainId)) return;
    contractAddress = token?.contractAddress ?? row.indexed.to;
    decimals = token?.decimals;
  } else if (row.local?.token || row.local?.collectibleTransfer) {
    if (row.local.chainId !== chainId || registrationHash && row.local.registrationHash !== registrationHash) return;
    contractAddress = row.local.token?.contractAddress ?? row.local.collectibleTransfer?.contractAddress;
    decimals = row.local.token?.decimals;
  } else if (!row.indexed && !row.local && row.observation?.valueUnits === '0' && row.observation.events.length) {
    if (row.observation.events.some(event => typeof event?.contractAddress !== 'string')) return;
    const contracts = new Set(row.observation.events.map(event => event.contractAddress.toLowerCase()));
    if (contracts.size !== 1) return;
    contractAddress = contracts.values().next().value;
  }
  if (typeof contractAddress !== 'string') return;
  const precision = decimals === undefined ? undefined : typeof decimals === 'number' ? decimals
    : typeof decimals === 'string' && /^(?:0|[1-9][0-9]*)$/.test(decimals) ? Number(decimals) : NaN;
  const identity = { kind: 'evm' as const, chainId, contractAddress, ...(precision === undefined ? {} : { decimals: precision }) };
  return assetIconIdentityKey(identity) ? identity : undefined;
}

export function utxoActivityAssetIcon(row: UtxoActivityRow, chainId: number): AssetIconIdentity | undefined {
  const asset = row.assetAmount;
  if (!row.hasAssetData || !asset?.assetGuid) return;
  const identity = { kind: 'spt' as const, chainId, assetGuid: asset.assetGuid, decimals: asset.decimals };
  return assetIconIdentityKey(identity) ? identity : undefined;
}
