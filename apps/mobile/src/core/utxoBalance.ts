import { assertBaseUnits } from './amounts.ts';
import type { PublicBalance } from './types.ts';
import { isSptDisplaySymbol, sptBalanceTotalUnits, supportsSptUtxoChain } from '../../../../source/shared/sptInventory.ts';
import { parseSyscoinAssetGuid } from '../../../../source/shared/syscoinAssetIds.ts';
import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import type { UtxoBalance } from './utxoBalanceReader.ts';
import { resolveUtxoNetwork, type UtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';

export function utxoObservation(value: UtxoBalance, scope: UtxoNetworkId | UtxoNetwork, updatedAt: number): Extract<PublicBalance, { kind: 'utxo' }> {
  assertJsonWorkBudget(value, 128 * 1024, 5, 10000);
  const network = resolveUtxoNetwork(scope);
  const hasAssets = !!value && Object.hasOwn(value, 'assets');
  const fieldCount = hasAssets ? 9 : 8;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Reflect.ownKeys(value).length !== fieldCount || Object.keys(value).length !== fieldCount || Object.keys(value).some((key) => ![
        'networkId', 'kind', 'chainId', 'genesisHash', 'confirmedUnits', 'pendingDeltaUnits', 'unconfirmedTransactions', 'observedHeight', 'assets',
      ].includes(key)) || value.kind !== 'utxo' || value.networkId !== network.id || value.chainId !== network.chainId ||
      value.genesisHash !== network.genesisHash || typeof value.pendingDeltaUnits !== 'string' ||
      !/^(?:0|-?[1-9][0-9]{0,77})$/.test(value.pendingDeltaUnits) ||
      !Number.isSafeInteger(value.unconfirmedTransactions) || value.unconfirmedTransactions < 0 ||
      !Number.isSafeInteger(value.observedHeight) || value.observedHeight < 0)
    throw new Error('Invalid UTXO balance observation');
  assertBaseUnits(value.confirmedUnits);
  assertBaseUnits(value.pendingDeltaUnits.replace(/^-/, ''));
  const assets = hasAssets ? value.assets : undefined;
  const seen = new Set<string>();
  if (hasAssets) {
    if (!supportsSptUtxoChain(network.chainId) || !Array.isArray(assets)) throw new Error('Invalid SPT observation');
    for (const asset of assets) {
      if (!asset || typeof asset !== 'object' || Array.isArray(asset) || Object.keys(asset).length !== 5 ||
          Object.keys(asset).some(key => !['assetGuid', 'decimals', 'symbol', 'confirmedUnits', 'pendingDeltaUnits'].includes(key)) ||
          !parseSyscoinAssetGuid(asset.assetGuid) || seen.has(asset.assetGuid) || !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 8 ||
          !isSptDisplaySymbol(asset.symbol) ||
          typeof asset.pendingDeltaUnits !== 'string' || !/^(?:0|-?[1-9][0-9]{0,77})$/.test(asset.pendingDeltaUnits)) throw new Error('Invalid SPT observation');
      assertBaseUnits(asset.confirmedUnits);
      assertBaseUnits(asset.pendingDeltaUnits.replace(/^-/, ''));
      sptBalanceTotalUnits(asset);
      seen.add(asset.assetGuid);
    }
  }
  if (!Number.isFinite(updatedAt) || updatedAt < 0) throw new Error('Invalid UTXO balance time');
  return Object.freeze({ status: 'available', kind: 'utxo', units: value.confirmedUnits, updatedAt,
    pendingDeltaUnits: value.pendingDeltaUnits, unconfirmedTransactions: value.unconfirmedTransactions, observedHeight: value.observedHeight,
    ...(assets ? { assets: Object.freeze(assets.map(asset => Object.freeze({ ...asset }))) } : {}) });
}
