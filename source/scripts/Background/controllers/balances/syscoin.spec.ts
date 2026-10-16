const fetchBackendAccountCachedMock = jest.fn();

jest.mock('../utils/fetchBackendAccountWrapper', () => ({
  fetchBackendAccountCached: (...args: any[]) =>
    fetchBackendAccountCachedMock(...args),
}));

import { parseUnits } from 'utils/ethersV6Compat';

import SyscoinBalanceController from './syscoin';

describe('native Syscoin available balance', () => {
  const account = { xpub: 'vpub-account', address: 'tsys-account' } as any;
  const networkUrl = 'https://blockbook.example';
  const readBalance = () =>
    SyscoinBalanceController().getSysBalanceForAccount(account, networkUrl);

  beforeEach(() => {
    fetchBackendAccountCachedMock.mockReset();
  });

  it.each([
    null,
    undefined,
    {},
    [],
    { error: 'backend unavailable' },
    { error: 'backend unavailable', balance: '100000' },
  ])('rejects an unavailable or error account summary %p', async (summary) => {
    fetchBackendAccountCachedMock.mockResolvedValue(summary);
    await expect(readBalance()).rejects.toThrow(
      /native balance|balance summary/i
    );
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    null,
    '',
    'invalid',
    'NaN',
    'Infinity',
    '1.5',
    '-1',
    true,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects an invalid confirmed atomic balance %p', async (balance) => {
    fetchBackendAccountCachedMock.mockResolvedValue({
      balance,
      unconfirmedBalance: '0',
      unconfirmedTxs: 0,
    });
    await expect(readBalance()).rejects.toThrow(
      'Confirmed native balance is unavailable or invalid'
    );
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
  });

  it.each(['0', 0])(
    'accepts an explicit confirmed zero %p',
    async (balance) => {
      fetchBackendAccountCachedMock.mockResolvedValue({
        balance,
        unconfirmedTxs: 0,
      });
      await expect(readBalance()).resolves.toBe('0');
      expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects an array-shaped confirmed value instead of coercing it to an integer', async () => {
    fetchBackendAccountCachedMock.mockResolvedValue({
      balance: ['100000'],
      unconfirmedTxs: 0,
    });
    await expect(readBalance()).rejects.toThrow(
      'Confirmed native balance is unavailable or invalid'
    );
  });

  it.each([-1, 'invalid', 1.5, true, Number.MAX_SAFE_INTEGER + 1])(
    'rejects a malformed pending transaction count %p',
    async (unconfirmedTxs) => {
      fetchBackendAccountCachedMock.mockResolvedValue({
        balance: '100000',
        unconfirmedTxs,
      });
      await expect(readBalance()).rejects.toThrow(
        'Pending native transaction count is unavailable or invalid'
      );
      expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each([2, '2'])(
    'requires a pending delta when transaction count is %p',
    async (unconfirmedTxs) => {
      fetchBackendAccountCachedMock.mockResolvedValue({
        balance: '100000',
        unconfirmedTxs,
      });
      await expect(readBalance()).rejects.toThrow(
        'Pending native balance delta is unavailable or invalid'
      );
    }
  );

  it.each([
    ['9889168', '-113407', '0.09775761'],
    ['9889168', '113407', '0.10002575'],
    ['9889168', '0', '0.09889168'],
    ['9889168', '-9889168', '0'],
    ['9889168', '-9889169', '0'],
    ['100000000', '-60000000', '0.4'],
    ['9007199254740993', '-1', '90071992.54740992'],
    ['9007199254740992', '1', '90071992.54740993'],
    ['1', '0', '0.00000001'],
  ])(
    'combines confirmed %s and signed pending %s exactly as %s',
    async (balance, unconfirmedBalance, expected) => {
      fetchBackendAccountCachedMock.mockResolvedValue({
        balance,
        unconfirmedBalance,
      });

      await expect(readBalance()).resolves.toBe(expected);
      expect(fetchBackendAccountCachedMock).toHaveBeenCalledWith(
        networkUrl,
        account.xpub,
        'details=tokenBalances&tokens=nonzero',
        true
      );
    }
  );

  it('keeps pending self-transfer fees deducted across confirmation transitions', async () => {
    fetchBackendAccountCachedMock
      .mockResolvedValueOnce({ balance: '9889168', unconfirmedBalance: '0' })
      .mockResolvedValueOnce({
        balance: '9889168',
        unconfirmedBalance: '-113407',
      })
      .mockResolvedValueOnce({ balance: '9775761', unconfirmedBalance: '0' });

    await expect(readBalance()).resolves.toBe('0.09889168');
    await expect(readBalance()).resolves.toBe('0.09775761');
    await expect(readBalance()).resolves.toBe('0.09775761');
  });

  it('funds corrected MAX and manual sends through the installed unsigned builder', async () => {
    const BN = jest.requireActual('bn.js');
    const bitcoin = jest.requireActual('bitcoinjs-lib');
    const builder = jest.requireActual('syscointx-js');
    const network = builder.utils.syscoinNetworks.testnet;
    // Deterministic script destination only; no key generation or signing.
    const address = bitcoin.payments.p2wpkh({
      hash: Buffer.alloc(20),
      network,
    }).address;
    const prepare = (amount: string, isMax: boolean) =>
      builder.createTransaction(
        { rbf: true },
        {
          utxos: [
            {
              txId: '0'.repeat(64),
              vout: 0,
              type: 'BECH32',
              address,
              value: new BN('9775761'),
            },
          ],
          assets: new Map(),
        },
        address,
        [
          {
            address,
            value: new BN(amount),
            ...(isMax ? { subtractFeeFrom: true } : {}),
          },
        ],
        new BN(2)
      );
    const staleMax = prepare('9889168', true);
    expect(staleMax.error).toBe('INSUFFICIENT_FUNDS');
    expect(staleMax.shortfall.toString()).toBe('113407');

    fetchBackendAccountCachedMock.mockResolvedValue({
      balance: '9889168',
      unconfirmedBalance: '-113407',
    });
    const available = parseUnits(await readBalance(), 8).toString();
    const max = prepare(available, true);
    expect(max.success).toBe(true);
    expect(max.fee.toString()).toBe('226');
    expect(max.outputs[0].value.toString()).toBe('9775535');

    const manual = prepare('9000000', false);
    expect(manual.success).toBe(true);
    expect(manual.fee.toString()).toBe('294');
    expect(manual.outputs[0].value.toString()).toBe('9000000');
  });

  it('requests mempool-aware tokenBalances rather than the basic confirmed-only contract', async () => {
    fetchBackendAccountCachedMock.mockImplementation(
      async (_url, _account, details) => ({
        balance: '9775331',
        unconfirmedTxs: 3,
        ...(details === 'details=tokenBalances&tokens=nonzero'
          ? { unconfirmedBalance: '-3227770' }
          : {}),
      })
    );
    await expect(readBalance()).resolves.toBe('0.06547561');
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledWith(
      networkUrl,
      account.xpub,
      'details=tokenBalances&tokens=nonzero',
      true
    );
  });

  it('keeps all four signed pending-delta generations exact without counting spent ancestors', async () => {
    let pendingCount = 3;
    for (const [delta, expected] of [
      ['-3227770', '0.06547561'],
      ['-3227996', '0.06547335'],
      ['-3228222', '0.06547109'],
      ['-3228448', '0.06546883'],
    ]) {
      fetchBackendAccountCachedMock.mockResolvedValueOnce({
        balance: '9775331',
        unconfirmedBalance: delta,
        unconfirmedTxs: pendingCount++,
      });
      await expect(readBalance()).resolves.toBe(expected);
    }
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(4);
  });

  it('reads an explicit signed pending delta in one account-summary request', async () => {
    fetchBackendAccountCachedMock.mockResolvedValue({
      balance: '9452561',
      unconfirmedBalance: '-1108',
      unconfirmedTxs: 4,
    });
    await expect(readBalance()).resolves.toBe('0.09451453');
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
  });

  it('keeps confirmed-only summary reads fast when there are no pending transactions', async () => {
    fetchBackendAccountCachedMock.mockResolvedValue({
      balance: '9452561',
      unconfirmedTxs: 0,
    });
    await expect(readBalance()).resolves.toBe('0.09452561');
    expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    null,
    '',
    'invalid',
    'NaN',
    'Infinity',
    '1.5',
    '-1.5',
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    'refuses a pending summary with missing or malformed atomic delta %s',
    async (unconfirmedBalance) => {
      fetchBackendAccountCachedMock.mockResolvedValue({
        balance: '9775331',
        unconfirmedTxs: 4,
        unconfirmedBalance,
      });
      await expect(readBalance()).rejects.toThrow(
        'Pending native balance delta is unavailable or invalid'
      );
      expect(fetchBackendAccountCachedMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each([undefined, null, '', 'invalid', 'NaN', 'Infinity', '1.5'])(
    'treats an invalid atomic pending balance %s as zero',
    async (unconfirmedBalance) => {
      fetchBackendAccountCachedMock.mockResolvedValue({
        balance: '9889168',
        unconfirmedBalance,
      });
      await expect(readBalance()).resolves.toBe('0.09889168');
    }
  );
});
