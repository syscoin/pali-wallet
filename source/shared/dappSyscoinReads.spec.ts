import {
  normalizeDappSyscoinRead,
  projectDappSyscoinTransactions,
} from './dappSyscoinReads';
import { UTXO_SUMMARY_OBSERVATION } from './utxoDetailFreshness';
it('keeps the existing public history fields and removes wallet-only observation/backend provenance', () => {
  expect(
    projectDappSyscoinTransactions([
      {
        txid: 'ab'.repeat(32),
        value: '1',
        localAcknowledgedInputs: { url: 'https://private.example' },
        [UTXO_SUMMARY_OBSERVATION]: 'wallet-observation',
      },
    ])
  ).toEqual([{ txid: 'ab'.repeat(32), value: '1' }]);
  for (const value of [null, [], { txid: '' }, { txid: 1 }])
    expect(() => projectDappSyscoinTransactions([value])).toThrow();
});
it('normalizes a detached boolean address selection and canonical transaction ID', () => {
  const value = { isChangeAddress: true };
  const request = normalizeDappSyscoinRead('sys_getBip32Path', [value]);
  value.isChangeAddress = false;
  expect(request.params).toEqual([{ isChangeAddress: true }]);
  expect(
    normalizeDappSyscoinRead('sys_getCurrentAddressPubkey', []).params
  ).toEqual([{ isChangeAddress: false }]);
  expect(
    normalizeDappSyscoinRead('sys_transaction', ['AB'.repeat(32)]).params
  ).toEqual(['ab'.repeat(32)]);
});
it.each([
  ['sys_sign', []],
  ['sys_getPublicKey', ['unexpected']],
  ['sys_transaction', ['invalid']],
  ['sys_getBip32Path', [{ isChangeAddress: 'yes' }]],
  ['sys_getCurrentAddressPubkey', [{ path: 'm/0' }]],
])('refuses malformed or unavailable %s reads', (method, params) =>
  expect(() => normalizeDappSyscoinRead(method as string, params)).toThrow()
);
