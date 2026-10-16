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
        'details=basic&pageSize=0',
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
