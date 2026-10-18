jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { notifyTransaction: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));

import store from 'state/store';
import vaultReducer from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from 'utils/evmTransactionContext';
import {
  getWalletNavigationScope,
  IWalletNavigationScope,
} from 'utils/navigationState';

import EthAccountController from './account/evm';
import MainController from './MainController';

const ADDRESS = `0x${'11'.repeat(20)}`;
const OTHER_ADDRESS = `0x${'22'.repeat(20)}`;
const TOKEN = `0x${'33'.repeat(20)}`;
const TYPE = KeyringAccountType.HDAccount;
const preview: any = {
  symbol: 'REVIEW',
  name: 'Synthetic token',
  contractAddress: TOKEN,
  chainId: 5700,
  decimals: 6,
  balance: 12,
  tokenStandard: 'ERC-20',
};
let state: any;
let wallet: MainController;
let expected: IWalletNavigationScope;
let ethSave: jest.SpyInstance;
let persistence: jest.Mock;

const change = (field: string) => {
  // The real reducer freezes committed state. A later UI/controller action
  // replaces it rather than mutating the snapshot used by the admission check.
  state = JSON.parse(JSON.stringify(state));
  if (field === 'account') state.vault.activeAccount.id = 1;
  if (field === 'account type')
    state.vault.activeAccount.type = KeyringAccountType.Imported;
  if (field === 'address')
    state.vault.accounts[TYPE][0].address = OTHER_ADDRESS;
  if (field === 'xpub')
    state.vault.accounts[TYPE][0].xpub = 'replacement-public-key';
  if (field === 'network') state.vault.activeNetwork.chainId = 1;
  if (field === 'RPC') state.vault.activeNetwork.url = 'https://other.invalid/';
  if (field === 'API')
    state.vault.activeNetwork.apiUrl = 'https://other-api.invalid/';
  if (field === 'kind') state.vault.activeNetwork.kind = INetworkType.Syscoin;
  if (field === 'mode') state.vault.isBitcoinBased = true;
  if (field === 'slip44') state.vaultGlobal.activeSlip44 = 57;
};

beforeEach(() => {
  const initial = vaultReducer(undefined, { type: '@@init' });
  state = {
    vault: {
      ...initial,
      isBitcoinBased: false,
      activeAccount: { id: 0, type: TYPE },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 5700,
        url: 'https://rpc.invalid/',
        apiUrl: 'https://api.invalid/',
        slip44: 60,
      },
      accounts: {
        ...initial.accounts,
        [TYPE]: {
          0: { id: 0, address: ADDRESS, xpub: 'original-public-key' },
          1: { id: 1, address: OTHER_ADDRESS, xpub: 'other-public-key' },
        },
        [KeyringAccountType.Imported]: {
          0: { id: 0, address: OTHER_ADDRESS, xpub: 'imported-public-key' },
        },
      },
      accountAssets: {
        ...initial.accountAssets,
        [TYPE]: {
          0: { ethereum: [], syscoin: [] },
          1: { ethereum: [], syscoin: [] },
        },
        [KeyringAccountType.Imported]: { 0: { ethereum: [], syscoin: [] } },
      },
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  jest.spyOn(store, 'getState').mockImplementation(() => state);
  jest.spyOn(store, 'dispatch').mockImplementation((action: any) => {
    state = { ...state, vault: vaultReducer(state.vault, action) };
    return action;
  });
  wallet = Object.create(MainController.prototype);
  wallet.account = {
    eth: EthAccountController(),
    sys: { saveTokenInfo: jest.fn() } as any,
  };
  ethSave = jest.spyOn(wallet.account.eth, 'saveTokenInfo');
  persistence = jest.fn(async () => undefined);
  (wallet as any).saveWalletState = persistence;
  expected = getWalletNavigationScope();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
});
afterEach(() => jest.restoreAllMocks());

it.each([undefined, null, {}, { account: 'invalid', network: 'invalid' }])(
  'rejects absent or malformed watch-asset approval scope %j without a mutation',
  async (scope) => {
    await expect(
      wallet.handleWatchAsset(preview, scope as IWalletNavigationScope)
    ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    expect(ethSave).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(persistence).not.toHaveBeenCalled();
  }
);

it.each([
  'account',
  'account type',
  'address',
  'xpub',
  'network',
  'RPC',
  'API',
  'kind',
  'slip44',
])(
  'rejects an old approval after a delivered %s change before saving',
  async (field) => {
    change(field);
    await expect(wallet.handleWatchAsset(preview, expected)).rejects.toThrow(
      EVM_TRANSACTION_CONTEXT_CHANGED
    );
    expect(ethSave).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(persistence).not.toHaveBeenCalled();
  }
);

it('rejects Bitcoin mode even with an otherwise matching scope', async () => {
  change('mode');
  await expect(wallet.handleWatchAsset(preview, expected)).rejects.toThrow(
    'Watch asset is not supported on Bitcoin networks'
  );
  expect(ethSave).not.toHaveBeenCalled();
  expect(store.dispatch).not.toHaveBeenCalled();
  expect(persistence).not.toHaveBeenCalled();
});

it('adds the reviewed token to the exact approved account and chain before persistence', async () => {
  await expect(wallet.handleWatchAsset(preview, expected)).resolves.toBe(true);
  expect(ethSave).toHaveBeenCalledTimes(1);
  expect(state.vault.accountAssets[TYPE][0].ethereum).toEqual([
    expect.objectContaining({
      contractAddress: TOKEN,
      tokenSymbol: 'REVIEW',
      decimals: 6,
      balance: 12,
      chainId: 5700,
      id: `${TOKEN}-5700`,
    }),
  ]);
  expect(state.vault.accountAssets[TYPE][1].ethereum).toEqual([]);
  expect(persistence).toHaveBeenCalledWith('add-token', true, true);
});

it.each(['account', 'network'])(
  'preserves the successful original ACK when %s changes during persistence',
  async (field) => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    persistence.mockImplementationOnce(() => {
      entered();
      return pending;
    });
    const saving = wallet.handleWatchAsset(preview, expected);
    await started;
    change(field);
    finish();
    await expect(saving).resolves.toBe(true);
    expect(ethSave).toHaveBeenCalledTimes(1);
    expect(store.dispatch).toHaveBeenCalledTimes(1);
    expect(state.vault.accountAssets[TYPE][0].ethereum).toEqual([
      expect.objectContaining({ chainId: 5700, contractAddress: TOKEN }),
    ]);
    expect(state.vault.accountAssets[TYPE][1].ethereum).toEqual([]);
  }
);
