import { KeyringAccountType } from 'types/network';
import { getRecentAcknowledgedInputOutpoints } from 'utils/utxoAcknowledgedInputs';

import reducer, {
  setAccountTransactions,
  setSingleTransactionToState,
} from './index';
import { TransactionsType } from './types';

const chainId = 5700;
const txid = '11'.repeat(32);
const acknowledged = {
  acknowledgedAt: 1000,
  accountXpub: 'scoped-test-xpub',
  networkUrl: 'https://blockbook.test',
  outpoints: [`${'22'.repeat(32)}:0`],
};
const transaction = (fields: any = {}) => ({
  txid,
  blockTime: 1,
  confirmations: 0,
  blockHeight: 0,
  blockHash: '',
  fees: '1',
  hex: '',
  value: '1',
  valueIn: '2',
  version: 2,
  vin: [],
  vout: [],
  ...fields,
});
const rows = (state: ReturnType<typeof reducer>) =>
  state.accountTransactions.HDAccount[0].syscoin[chainId];
const initial = () => reducer(undefined, { type: 'test/init' });
const insert = (
  state: ReturnType<typeof reducer>,
  incoming: any,
  localAcknowledgedInputs?: typeof acknowledged
) =>
  reducer(
    state,
    setSingleTransactionToState({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      chainId,
      networkType: TransactionsType.Syscoin,
      transaction: incoming,
      localAcknowledgedInputs,
    })
  );

describe('compact local UTXO acknowledgement history', () => {
  it('accepts local metadata only from the explicit ACK action field', () => {
    const untrusted = insert(
      initial(),
      transaction({ localAcknowledgedInputs: acknowledged })
    );
    expect(rows(untrusted)[0]).not.toHaveProperty('localAcknowledgedInputs');
    const local = insert(initial(), transaction(), acknowledged);
    expect(rows(local)[0].localAcknowledgedInputs).toEqual(acknowledged);
    expect(rows(local)[0].hex).toBe('');
    expect(rows(local)[0].vin).toEqual([]);
    expect(rows(local)[0].vout).toEqual([]);
  });

  it('preserves the local fence through single confirmed summary replacements', () => {
    const local = insert(initial(), transaction(), acknowledged);
    const refreshed = insert(
      local,
      transaction({
        confirmations: 1,
        blockHeight: 2,
        localAcknowledgedInputs: { ...acknowledged, outpoints: [] },
      })
    );
    expect(rows(refreshed)[0].confirmations).toBe(1);
    expect(rows(refreshed)[0].localAcknowledgedInputs).toEqual(acknowledged);
  });

  it('preserves existing metadata on history refresh but strips invented markers', () => {
    const local = insert(initial(), transaction(), acknowledged);
    const refreshed = reducer(
      local,
      setAccountTransactions({
        accountId: 0,
        accountType: KeyringAccountType.HDAccount,
        chainId,
        networkType: TransactionsType.Syscoin,
        transactions: [
          transaction({ confirmations: 1 }),
          transaction({
            txid: '33'.repeat(32),
            localAcknowledgedInputs: acknowledged,
          }),
        ],
      })
    );
    expect(rows(refreshed)[0].localAcknowledgedInputs).toEqual(acknowledged);
    expect(rows(refreshed)[1]).not.toHaveProperty('localAcknowledgedInputs');
  });

  it('can attach an ACK after a same-confirmation row was already observed', () => {
    const observed = insert(initial(), transaction());
    const local = insert(observed, transaction(), acknowledged);
    expect(rows(local)).toHaveLength(1);
    expect(rows(local)[0].localAcknowledgedInputs).toEqual(acknowledged);
  });

  it.each([
    ['native', {}],
    [
      'SPT',
      {
        version: 128,
        tokenType: 'SPTAssetAllocationSend',
        tokenTransfers: [
          {
            type: 'SPT',
            standard: 'SPT',
            contract: '123456',
            assetGuid: '123456',
            symbol: 'SYSX',
            decimals: 8,
            value: '100000000',
          },
        ],
        accountAssetTransfers: [
          {
            assetGuid: '123456',
            symbol: 'SYSX',
            decimals: 8,
            value: '100000000',
          },
        ],
      },
    ],
  ])(
    'attaches an ACK without overwriting an already indexed rich %s row',
    (_kind, assetFields) => {
      const indexed = transaction({
        blockTime: 123,
        fees: '226',
        hex: '0200000001',
        value: '6547335',
        valueIn: '6547561',
        vin: [
          {
            txid: '22'.repeat(32),
            vout: 0,
            addresses: ['owned-input'],
            value: '6547561',
            isOwn: true,
          },
        ],
        vout: [
          {
            n: 0,
            addresses: ['recipient'],
            value: '6547335',
            isOwn: false,
          },
        ],
        direction: 'sent',
        addressValueIn: '6547561',
        addressValueOut: '0',
        ...assetFields,
      });
      const observed = insert(initial(), indexed);
      const local = insert(
        observed,
        transaction({ fees: '0', value: '0', valueIn: '0' }),
        acknowledged
      );

      expect(rows(local)).toHaveLength(1);
      expect(rows(local)[0]).toEqual({
        ...indexed,
        localAcknowledgedInputs: acknowledged,
      });
      expect(rows(observed)[0]).toEqual(indexed);
    }
  );

  it('attaches an ACK without downgrading an already mined row', () => {
    const mined = transaction({
      confirmations: 3,
      blockHeight: 42,
      blockHash: '33'.repeat(32),
      blockTime: 123,
      fees: '226',
      value: '6547335',
      valueIn: '6547561',
      vin: [{ txid: '22'.repeat(32), vout: 0, value: '6547561' }],
      vout: [{ n: 0, value: '6547335' }],
    });
    const observed = insert(initial(), mined);
    const local = insert(
      observed,
      transaction({ fees: '0', value: '0', valueIn: '0' }),
      acknowledged
    );

    expect(rows(local)[0]).toEqual({
      ...mined,
      localAcknowledgedInputs: acknowledged,
    });
  });

  it('retains only compact public metadata through ordinary JSON persistence', () => {
    const local = insert(initial(), transaction(), acknowledged);
    const restored = JSON.parse(JSON.stringify(local));
    expect(
      getRecentAcknowledgedInputOutpoints(
        restored.accountTransactions.HDAccount[0].syscoin,
        {
          accountXpub: acknowledged.accountXpub,
          networkUrl: acknowledged.networkUrl,
          chainId,
        },
        1001
      )
    ).toEqual(new Set(acknowledged.outpoints));
  });
});
