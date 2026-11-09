import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSptInventory, projectSptBalance, sptBalanceTotalUnits } from '../../../source/shared/sptInventory.ts';
import { utxoObservation } from '../src/core/utxoBalance.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import type { UtxoBalance } from '../src/core/utxoBalanceReader.ts';

const row = (assetGuid: string, decimals: number, symbol: unknown) => ({ assetGuid, decimals, symbol, balance: '9007199254740993', unconfirmedBalance: '-125' });
const project = (rows: unknown[]) => [...parseSptInventory({ address: 'account', tokensAsset: rows }, 'account').holdings.values()].map(projectSptBalance);
test('all SPT GUIDs use observed precision and exact pending totals, including the historical SYSX identifier', () => {
  const assets = project([row('123456', 3, 'A token'), row('18446744073709551615', 0, 'WHOLE'), row('42', 8, 'FRACTION')]);
  assert.deepEqual(assets.map(a => [a.assetGuid, a.decimals]), [['123456', 3], ['18446744073709551615', 0], ['42', 8]]);
  assert(assets.every(a => sptBalanceTotalUnits(a) === '9007199254740868' && Object.isFrozen(a)));
  assert.throws(() => project([row('18446744073709551616', 3, 'BAD')]));
});
test('untrusted display metadata falls back to the exact GUID, with no embedded direction or control characters', () => {
  for (const symbol of [undefined, '', 'x'.repeat(129), 'BANK\u202eXYZ', 'A\nB', {}, 42]) assert.equal(project([row('42', 2, symbol)])[0]!.symbol, '42');
  assert.equal(project([row('42', 2, 'ABC / Δ')])[0]!.symbol, 'ABC / Δ');
  assert.throws(() => sptBalanceTotalUnits({ confirmedUnits: '1', pendingDeltaUnits: '-2' }));
  assert.throws(() => sptBalanceTotalUnits({ confirmedUnits: (1n << 256n).toString(), pendingDeltaUnits: '0' }));
});
test('public asset projection is cloned/frozen and refuses duplicate, extra, out-of-range or cross-chain rows', () => {
  const network = getUtxoNetwork('syscoin');
  const balance: UtxoBalance = { kind: 'utxo', networkId: network.id, chainId: network.chainId, genesisHash: network.genesisHash,
    confirmedUnits: '1000', pendingDeltaUnits: '0', unconfirmedTransactions: 0, observedHeight: 1, assets: project([row('42', 3, 'TOKEN')]) };
  const observed = utxoObservation(balance, network, 10);
  assert.notEqual(observed.assets, balance.assets); assert(Object.isFrozen(observed.assets)); assert(Object.isFrozen(observed.assets![0]));
  for (const assets of [[...balance.assets!, ...balance.assets!], [{ ...balance.assets![0], decimals: 9 }],
    [{ ...balance.assets![0], rawSecret: 'no' }], [{ ...balance.assets![0], pendingDeltaUnits: '-9007199254740994' }]])
    assert.throws(() => utxoObservation({ ...balance, assets } as UtxoBalance, network, 10));
  const bitcoin = getUtxoNetwork('bitcoin');
  assert.throws(() => utxoObservation({ ...balance, networkId: bitcoin.id, chainId: bitcoin.chainId, genesisHash: bitcoin.genesisHash }, bitcoin, 10));
});
