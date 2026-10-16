const getStateMock = jest.fn();
const getControllerMock = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => getStateMock() },
}));
jest.mock('scripts/Background', () => ({
  getController: () => getControllerMock(),
}));
import { SysProvider } from './SysProvider';

describe('SysProvider account privacy', () => {
  const connectedTx = { txid: 'connected' };
  beforeEach(() => {
    getStateMock.mockReturnValue({
      vault: {
        activeAccount: { type: 'HDAccount', id: 0 },
        activeNetwork: { chainId: 57 },
        accountTransactions: {
          HDAccount: {
            0: { syscoin: { 57: [{ txid: 'unrelated' }] } },
            1: { syscoin: { 57: [connectedTx] } },
          },
        },
      },
    });
    getControllerMock.mockReturnValue({
      dapp: {
        getAccount: () => ({ id: 1, xpub: 'private-history-xpub' }),
        get: () => ({ accountType: 'HDAccount', accountId: 1 }),
      },
      wallet: { isUnlocked: () => true },
    });
  });

  it('returns only the connected account history and transaction details', () => {
    const provider = SysProvider('https://connected.test');
    expect(provider.getTransactions()).toEqual([connectedTx]);
    expect(provider.transaction(['connected'])).toEqual(connectedTx);
    expect(provider.transaction(['unrelated'])).toBeNull();
  });

  it('strips local acknowledgement provenance from both public history methods without changing stored or public transaction data', () => {
    const publicTransaction = {
      txid: 'connected',
      fees: '226',
      value: '100000',
      valueIn: '100226',
      confirmations: 0,
      vin: [{ txid: 'parent', vout: 0, value: '100226' }],
      vout: [{ n: 0, value: '100000', addresses: ['public-recipient'] }],
      tokenType: 'SPTAssetAllocationSend',
      accountAssetTransfers: [
        { assetGuid: '123456', symbol: 'SYSX', value: '10000000' },
      ],
      direction: 'sent',
      addressValueIn: '100226',
      addressValueOut: '0',
    };
    const stored = {
      ...publicTransaction,
      localAcknowledgedInputs: {
        accountXpub: 'internal-account-xpub',
        acknowledgedAt: 1800000000000,
        networkUrl:
          'https://fixture-user:fixture-password@private-rpc.invalid/key',
        outpoints: [`${'12'.repeat(32)}:0`],
      },
    };
    getStateMock().vault.accountTransactions.HDAccount[1].syscoin[57] = [
      stored,
    ];
    const before = JSON.stringify(stored);
    const provider = SysProvider('https://connected.test');
    const history = provider.getTransactions();
    const detail = provider.transaction(['connected']);

    expect(history).toEqual([publicTransaction]);
    expect(detail).toEqual(publicTransaction);
    expect(history[0]).not.toBe(stored);
    expect(detail).not.toBe(stored);
    expect(history[0]).not.toHaveProperty('localAcknowledgedInputs');
    expect(detail).not.toHaveProperty('localAcknowledgedInputs');
    expect(JSON.stringify({ history, detail })).not.toContain('private-rpc');
    expect(JSON.stringify({ history, detail })).not.toContain(
      'internal-account-xpub'
    );
    expect(JSON.stringify(stored)).toBe(before);
    expect(stored.localAcknowledgedInputs.outpoints).toEqual([
      `${'12'.repeat(32)}:0`,
    ]);
    expect(provider.transaction(['unrelated'])).toBeNull();
  });

  it('hides accounts, public keys and history while locked', () => {
    getControllerMock().wallet.isUnlocked = () => false;
    const provider = SysProvider('https://connected.test');
    expect(provider.getAccount()).toBeNull();
    expect(provider.getPublicKey()).toBeNull();
    expect(provider.getTransactions()).toEqual([]);
    expect(provider.transaction(['connected'])).toBeNull();
  });
});
