let mockState: any;
const mockDispatch = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => mockDispatch(action),
  },
  saveMainState: jest.fn(async () => true),
  persistMainStateStrict: jest.fn(async () => undefined),
}));
jest.mock('../notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock('./message-handler/provider-cache', () => ({
  clearProviderCache: jest.fn(),
}));

import dappReducer from 'state/dapp';
import { INetworkType, KeyringAccountType } from 'types/network';

import DAppController from './DAppController';

const host = 'https://selection.invalid';
const address = `0x${'1'.repeat(40)}`;
let controller: ReturnType<typeof DAppController>;
const context = () => ({
  address,
  xpub: 'public-account-identity',
  network: { ...mockState.vault.activeNetwork },
});
const grant = (expected = context()) =>
  (controller.requestPermissions as any)(
    host,
    1,
    KeyringAccountType.HDAccount,
    expected
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    dapp: { dapps: {} },
    vault: {
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 1,
        url: 'https://rpc.invalid',
        slip44: 60,
      },
      isBitcoinBased: false,
      accounts: {
        HDAccount: {
          0: { id: 0, address: `0x${'2'.repeat(40)}` },
          1: { id: 1, address, xpub: 'public-account-identity' },
        },
      },
    },
  };
  mockDispatch.mockImplementation((action) => {
    mockState = { ...mockState, dapp: dappReducer(mockState.dapp, action) };
  });
  (chrome.runtime as any).id = 'pali';
  (chrome as any).tabs = { query: jest.fn((_query, reply) => reply([])) };
  (chrome as any).scripting = { executeScript: jest.fn(async () => []) };
  controller = DAppController(() => true);
});

it('grants a live selected identity and tolerates unrelated balance updates', () => {
  const expected = context();
  mockState.vault.accounts.HDAccount[1].balances = { ethereum: 7 };
  expect(grant(expected)[0].caveats[0].value).toEqual([address]);
  expect(controller.getAccount(host).address).toBe(address);
});

it.each(['missing', 'wrong-family', 'wrong-smart-chain', 'wrong-utxo-slip44'])(
  'refuses %s before changing an existing permission',
  (change) => {
    controller.connect({
      host,
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      chain: INetworkType.Ethereum,
      chainId: 1,
      date: 1,
    });
    const previous = controller.get(host);
    if (change === 'missing') delete mockState.vault.accounts.HDAccount[1];
    if (change === 'wrong-family')
      mockState.vault.accounts.HDAccount[1].address = 'sys1publicaddress';
    let type = KeyringAccountType.HDAccount;
    if (change === 'wrong-smart-chain') {
      type = KeyringAccountType.SmartAccount;
      mockState.vault.accounts.SmartAccount = {
        1: { id: 1, address, smartAccount: { chainId: 2 } },
      };
    }
    if (change === 'wrong-utxo-slip44') {
      mockState.vault.activeNetwork = {
        kind: INetworkType.Syscoin,
        chainId: 57,
        url: 'https://blockbook.invalid',
        slip44: 57,
      };
      mockState.vault.isBitcoinBased = true;
      mockState.vault.accounts.HDAccount[1] = {
        id: 1,
        address: 'bc1publicaddress',
        slip44: 0,
      };
    }
    mockDispatch.mockClear();
    (chrome.tabs.query as jest.Mock).mockClear();
    expect(() => controller.requestPermissions(host, 1, type)).toThrow();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(controller.get(host)).toEqual(previous);
  }
);

it.each(['address', 'xpub', 'kind', 'chainId', 'url', 'slip44'])(
  'refuses stale %s sent from the approval before any mutation',
  (field) => {
    const expected = context();
    if (field === 'address' || field === 'xpub')
      mockState.vault.accounts.HDAccount[1][field] =
        field === 'address' ? `0x${'3'.repeat(40)}` : 'changed-xpub';
    else mockState.vault.activeNetwork[field] = `changed-${field}`;
    expect(() => grant(expected)).toThrow();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(controller.isConnected(host)).toBe(false);
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  }
);

it.each(['missing', 'identity', 'network'])(
  'refuses a %s account-change approval before session or grant mutation',
  async (change) => {
    const expected = context();
    if (change === 'missing') delete mockState.vault.accounts.HDAccount[1];
    if (change === 'identity')
      mockState.vault.accounts.HDAccount[1].xpub = 'replacement-xpub';
    if (change === 'network')
      mockState.vault.activeNetwork.url = 'https://other.invalid';
    await expect(
      controller.changeAccount(host, 1, KeyringAccountType.HDAccount, expected)
    ).rejects.toThrow();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(controller.isConnected(host)).toBe(false);
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  }
);
