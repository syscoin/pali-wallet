jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: {} }) },
}));
const mockController = {
  dapp: { isConnected: jest.fn(), getAccount: jest.fn(), get: jest.fn() },
};
jest.mock('scripts/Background', () => ({
  getController: () => mockController,
}));
jest.mock('./method-handlers', () => ({ clearProviderCache: jest.fn() }));

import { getMethodConfig } from './method-registry';
import { popupOptimizationMiddleware } from './request-pipeline';

const origin = 'https://connected.example';
const address = '0x1111111111111111111111111111111111111111';
const privateUrl =
  'https://private-rpc.example/v3/private-api-token?key=private-query-token';
const publicAccount = {
  address,
  xpub: 'approved-public-xpub',
  id: 1,
  label: 'Account 2',
  slip44: 57,
  balances: { syscoin: '3.5', ethereum: 0 },
  isImported: true,
  isLedgerWallet: false,
  isTrezorWallet: false,
  isSmartAccount: false,
};
const context = (method: string, params?: unknown[]) =>
  ({
    methodConfig: getMethodConfig(method),
    originalRequest: { method, params, host: origin },
  } as any);

beforeEach(() => {
  jest.clearAllMocks();
  mockController.dapp.isConnected.mockReturnValue(true);
  mockController.dapp.get.mockReturnValue({
    accountId: 1,
    accountType: 'Imported',
  });
  mockController.dapp.getAccount.mockReturnValue({
    ...publicAccount,
    xprv: 'encrypted-private-key',
    balances: {
      ...publicAccount.balances,
      [privateUrl]: { endpoint: privateUrl },
    },
    nativeBalanceCache: {
      [JSON.stringify(['ethereum', 1, privateUrl])]: { balance: '1' },
    },
    smartAccount: {
      descriptor: { rpcUrl: privateUrl },
      localSigner: 'internal-storage-reference',
    },
    unknownStorage: { nested: { apiUrl: privateUrl } },
  });
});

it.each([
  ['ENABLE', undefined],
  [
    'wallet_changeAccount',
    [{ currentAccountId: 1, currentAccountType: 'Imported' }],
  ],
])(
  'projects the connected %s shortcut without nested private account data',
  async (method, params) => {
    const next = jest.fn();
    const result = await popupOptimizationMiddleware(
      context(method as string, params as unknown[]),
      next
    );
    expect(result).toEqual(publicAccount);
    expect(next).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /private-api-token|private-query-token|encrypted-private-key|internal-storage-reference|nativeBalanceCache/
    );
  }
);

it('keeps first-time connection in the existing approval path', async () => {
  mockController.dapp.isConnected.mockReturnValue(false);
  const next = jest.fn(async () => 'connection approval');
  expect(await popupOptimizationMiddleware(context('ENABLE'), next)).toBe(
    'connection approval'
  );
  expect(next).toHaveBeenCalledTimes(1);
});
