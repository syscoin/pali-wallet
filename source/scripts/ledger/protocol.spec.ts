import {
  invokeLedgerHost,
  MAX_LEDGER_MESSAGE_BYTES,
  snapshotLedgerMessage,
} from './protocol';

const portAuthority = {
  assertCurrent: () => undefined,
  signal: new AbortController().signal,
};

it('normalizes public bigint fields and rejects oversized or cyclic messages', () => {
  expect(snapshotLedgerMessage({ chainId: BigInt(57) })).toEqual({
    chainId: '57',
  });
  expect(() =>
    snapshotLedgerMessage('é'.repeat(MAX_LEDGER_MESSAGE_BYTES / 2))
  ).toThrow();
  const circular: any = {};
  circular.self = circular;
  expect(() => snapshotLedgerMessage(circular)).toThrow();
});

it('dispatches only explicitly allowed semantic methods', async () => {
  const getAddress = jest.fn(async () => ({ address: 'public' }));
  const host: any = { evm: { getAddress } };
  await expect(
    invokeLedgerHost(host, 'evm.getAddress', { accountIndex: 3 }, portAuthority)
  ).resolves.toEqual({ address: 'public' });
  expect(getAddress).toHaveBeenCalledWith({ accountIndex: 3 });
  for (const method of [
    'evm.constructor',
    '__proto__.getAddress',
    'disconnect',
    'utxo.sendApdu',
  ])
    await expect(
      invokeLedgerHost(host, method, {}, portAuthority)
    ).rejects.toMatchObject({
      code: 'LEDGER_INVALID_REQUEST',
    });
});

it('passes local Port ownership explicitly only to the PSBT signer', async () => {
  const signPsbt = jest.fn(async () => ({
    fingerprint: '01020304',
    signatures: [],
  }));
  const host: any = { utxo: { signPsbt } };
  const request = { psbtBase64: 'fixture' };
  await expect(
    invokeLedgerHost(host, 'utxo.signPsbt', request, portAuthority)
  ).resolves.toEqual({
    fingerprint: '01020304',
    signatures: [],
  });
  expect(signPsbt).toHaveBeenCalledWith(request, portAuthority);
});
