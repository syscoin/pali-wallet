import { createUtxoActivityParticipantProjection } from './utxoActivityParticipants';

const legacyRecipient = 't3KCn5Vnmu49zQ967TmLc1uxVMzumyMyaAx';
const legacySender = 't1JWm9xJLM9qcJyPgLfg1bHbZDUd4PKpqXb';
const testnetSender = 'tmAMWUnnjjpM7TDb81PykSxGJpThsw453ND';
const badChecksum = 't1JWm9xJLM9qcJyPgLfg1bHbZDUd4PKpqXa';

it('preserves exact legacy participants on the registered network in compact and full activity', () => {
  const projection = createUtxoActivityParticipantProjection({
    chainId: 133,
    slip44: 133,
  });
  const from = [legacySender, testnetSender, badChecksum, legacySender];
  const to = [legacyRecipient, 'provider label'];
  const expected = { from: [legacySender], to: [legacyRecipient] };
  expect(projection.compact({ from, to })).toEqual(expected);
  const full = projection.full({
    txid: 'a'.repeat(64),
    blockHash: 'b'.repeat(64),
    blockHeight: 10,
    blockTime: 1,
    confirmations: 1,
    fees: '1',
    hex: '',
    value: '1',
    valueIn: '2',
    version: 2,
    vin: [
      {
        addresses: from,
        n: 0,
        txid: 'c'.repeat(64),
        value: 2,
        vout: 0,
        sequence: 0,
        isAddress: true,
      },
    ],
    vout: [
      { addresses: to, hex: '', n: 0, value: 1, isAddress: true, spent: false },
    ],
  });
  expect(full.vin[0].addresses).toEqual(expected.from);
  expect(full.vout[0].addresses).toEqual(expected.to);
});
