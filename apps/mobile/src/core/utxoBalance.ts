import { assertBaseUnits } from './amounts.ts';
import type { PublicBalance } from './types.ts';
import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import type { UtxoBalance } from './utxoBalanceReader.ts';
import { resolveUtxoNetwork, type UtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';

export function utxoObservation(value: UtxoBalance, scope: UtxoNetworkId | UtxoNetwork, updatedAt: number): Extract<PublicBalance, { kind: 'utxo' }> {
  assertJsonWorkBudget(value, 2048, 3, 30);
  const network = resolveUtxoNetwork(scope);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Reflect.ownKeys(value).length !== 8 || Object.keys(value).length !== 8 || Object.keys(value).some((key) => ![
        'networkId', 'kind', 'chainId', 'genesisHash', 'confirmedUnits', 'pendingDeltaUnits', 'unconfirmedTransactions', 'observedHeight',
      ].includes(key)) || value.kind !== 'utxo' || value.networkId !== network.id || value.chainId !== network.chainId ||
      value.genesisHash !== network.genesisHash || typeof value.pendingDeltaUnits !== 'string' ||
      !/^(?:0|-?[1-9][0-9]{0,77})$/.test(value.pendingDeltaUnits) ||
      !Number.isSafeInteger(value.unconfirmedTransactions) || value.unconfirmedTransactions < 0 ||
      !Number.isSafeInteger(value.observedHeight) || value.observedHeight < 0)
    throw new Error('Invalid UTXO balance observation');
  assertBaseUnits(value.confirmedUnits);
  assertBaseUnits(value.pendingDeltaUnits.replace(/^-/, ''));
  if (!Number.isFinite(updatedAt) || updatedAt < 0) throw new Error('Invalid UTXO balance time');
  return Object.freeze({ status: 'available', kind: 'utxo', units: value.confirmedUnits, updatedAt,
    pendingDeltaUnits: value.pendingDeltaUnits, unconfirmedTransactions: value.unconfirmedTransactions, observedHeight: value.observedHeight });
}
