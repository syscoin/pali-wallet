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

  it('hides accounts, public keys and history while locked', () => {
    getControllerMock().wallet.isUnlocked = () => false;
    const provider = SysProvider('https://connected.test');
    expect(provider.getAccount()).toBeNull();
    expect(provider.getPublicKey()).toBeNull();
    expect(provider.getTransactions()).toEqual([]);
    expect(provider.transaction(['connected'])).toBeNull();
  });
});
