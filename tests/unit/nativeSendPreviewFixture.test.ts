jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');

import { createUtxoFixture, fixtureRead } from '../../e2e/harness/utxoFixture';

it('supplies a consistent native balance, real prevout and fee read for the unsigned UI', () => {
  const fixture = createUtxoFixture();
  const backend = 'https://blockbook-dev.syscoin.org/api/v2';
  const account = fixtureRead(
    fixture,
    backend + '/xpub/' + fixture.userXpub,
    'GET'
  ) as any;
  const utxos = fixtureRead(
    fixture,
    backend + '/utxo/' + fixture.userXpub,
    'GET'
  ) as any[];
  expect(account.balance).toBe('100000');
  expect(utxos).toHaveLength(1);
  expect(utxos[0].txid).toBe(fixture.parentTxs[0].getId());
  expect(BigInt(utxos[0].value)).toBe(fixture.parentTxs[0].outs[0].value);
  expect(utxos[0].value).toBe(account.balance);
  expect(fixtureRead(fixture, backend + '/estimatefee/1', 'GET')).toEqual({
    result: '0.00001',
  });
  expect(fixtureRead(fixture, backend + '/sendtx/', 'POST')).toBeUndefined();
});
