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
jest.mock('utils/ethersV6Compat', () => ({
  ...jest.requireActual('utils/ethersV6Compat'),
  Contract: jest.fn(),
}));

import store from 'state/store';
import * as storeModule from 'state/store';
import vaultReducer from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { Contract } from 'utils/ethersV6Compat';
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
let persistence: jest.SpyInstance;

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
  (wallet as any).walletSessionGeneration = 0;
  (wallet as any).walletStateGeneration = 0;
  const keyring = { ethereumTransaction: { web3Provider: {} } };
  (wallet as any).getActiveKeyring = () => keyring;
  (wallet as any).resetAutoLockTimer = jest.fn();
  wallet.isUnlocked = jest.fn(() => true);
  wallet.account = {
    eth: EthAccountController(),
    sys: { prepareTokenAddition: jest.fn() } as any,
  };
  ethSave = jest.spyOn(wallet.account.eth, 'prepareTokenAddition');
  persistence = jest
    .spyOn(storeModule, 'persistAssetMutation')
    .mockImplementation(async (prepare, assertCurrent) => {
      assertCurrent();
      store.dispatch(prepare());
    });
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

describe('watchAsset ERC1155 metadata and token identity', () => {
  let metadata: jest.SpyInstance;
  let balanceOf: jest.Mock;
  const requested = (tokenId: any) => ({
    address: TOKEN,
    symbol: 'DAPP',
    decimals: 18,
    tokenId,
  });
  const read = (tokenId: any = '0x07') =>
    wallet.getAssetInfo(requested(tokenId), 'ERC1155', expected);

  beforeEach(() => {
    metadata = jest
      .spyOn(wallet, 'getTokenDetailsWithMarketData')
      .mockResolvedValue({
        ...preview,
        decimals: 0,
        isNft: true,
        tokenStandard: 'ERC-1155',
        balance: 999,
      });
    balanceOf = jest.fn().mockResolvedValue(BigInt('9007199254740993'));
    (Contract as jest.Mock).mockImplementation(() => ({ balanceOf }));
  });

  it('previews and saves the normalized ID with its exact per-ID units', async () => {
    const result = await read();
    expect(balanceOf).toHaveBeenCalledWith(ADDRESS, '7');
    expect(result).toMatchObject({
      tokenId: '7',
      rawBalance: '9007199254740993',
      decimals: 0,
      tokenStandard: 'ERC-1155',
      id: `${TOKEN}-5700-7`,
    });
    await expect(wallet.handleWatchAsset(result, expected)).resolves.toBe(true);
    expect(state.vault.accountAssets[TYPE][0].ethereum).toEqual([
      expect.objectContaining({
        tokenId: '7',
        rawBalance: '9007199254740993',
        id: `${TOKEN}-5700-7`,
      }),
    ]);
  });

  it.each([
    undefined,
    null,
    '',
    '-1',
    '1.5',
    {},
    [],
    Number.MAX_SAFE_INTEGER + 1,
    `0x1${'0'.repeat(64)}`,
  ])(
    'rejects invalid ERC1155 ID %j before metadata or persistence',
    async (tokenId) => {
      await expect(
        wallet.getAssetInfo(requested(tokenId), 'ERC1155', expected)
      ).rejects.toThrow('Invalid token id');
      expect(metadata).not.toHaveBeenCalled();
      expect(balanceOf).not.toHaveBeenCalled();
      expect(persistence).not.toHaveBeenCalled();
    }
  );

  it.each(['0', `0x${'f'.repeat(64)}`])(
    'accepts uint256 boundary ID %s without rounding',
    async (tokenId) => {
      balanceOf.mockResolvedValue(BigInt(0));
      const result = await read(tokenId);
      expect(result.tokenId).toBe(BigInt(tokenId).toString());
      expect(result.rawBalance).toBe('0');
      expect(result.balance).toBe(0);
    }
  );

  it('rejects a changed scope during a delayed per-ID read', async () => {
    let finish!: (balance: bigint) => void;
    balanceOf.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const pending = read();
    const rejected = expect(pending).rejects.toThrow(
      EVM_TRANSACTION_CONTEXT_CHANGED
    );
    await Promise.resolve();
    change('RPC');
    finish(BigInt(1));
    await rejected;
    expect(persistence).not.toHaveBeenCalled();
  });

  it('does not invent zero owned units when the per-ID read fails', async () => {
    balanceOf.mockRejectedValue(new Error('Synthetic balance lookup failed'));
    await expect(read()).rejects.toThrow('Synthetic balance lookup failed');
    expect(persistence).not.toHaveBeenCalled();
  });

  it.each(['-1', `0x1${'0'.repeat(64)}`])(
    'rejects an invalid per-ID balance %s',
    async (balance) => {
      balanceOf.mockResolvedValue(balance);
      await expect(read()).rejects.toThrow('Invalid token id');
      expect(persistence).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['ERC-20', 'ERC20'],
    ['ERC-721', 'ERC721'],
  ] as const)(
    'preserves the %s metadata path without ERC1155 balance reads',
    async (tokenStandard, assetType) => {
      metadata.mockResolvedValue({ ...preview, tokenStandard });
      const result = await wallet.getAssetInfo(
        { address: TOKEN, symbol: 'DAPP', decimals: 18 },
        assetType,
        expected
      );
      expect(result.symbol).toBe('REVIEW');
      expect(result.tokenStandard).toBe(tokenStandard);
      expect(balanceOf).not.toHaveBeenCalled();
      await expect(wallet.handleWatchAsset(result, expected)).resolves.toBe(
        true
      );
    }
  );

  it.each([
    ['ERC20', 'ERC-721'],
    ['ERC20', 'ERC-1155'],
    ['ERC721', 'ERC-20'],
    ['ERC721', 'ERC-1155'],
    ['ERC1155', 'ERC-20'],
    ['ERC1155', 'ERC-721'],
  ] as const)(
    'rejects requested %s when metadata discovers %s',
    async (assetType, tokenStandard) => {
      metadata.mockResolvedValue({ ...preview, tokenStandard });
      await expect(
        wallet.getAssetInfo(requested('7'), assetType, expected)
      ).rejects.toThrow('Asset type does not match token contract');
      expect(balanceOf).not.toHaveBeenCalled();
      expect(persistence).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, null, {}, { account: 'wrong', network: 'wrong' }])(
    'rejects missing or stale metadata scope %j before reads',
    async (scope) => {
      await expect(
        wallet.getAssetInfo(requested('7'), 'ERC1155', scope as any)
      ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
      expect(metadata).not.toHaveBeenCalled();
      expect(balanceOf).not.toHaveBeenCalled();
    }
  );

  it('rejects a malformed reviewed ERC1155 ID before token preparation', async () => {
    await expect(
      wallet.handleWatchAsset(
        { ...preview, tokenStandard: 'ERC-1155', tokenId: '-1' } as any,
        expected
      )
    ).rejects.toThrow('Invalid token id');
    expect(ethSave).not.toHaveBeenCalled();
    expect(persistence).not.toHaveBeenCalled();
  });
});

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

it('publishes the reviewed token to the exact approved account and chain through persistence', async () => {
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
  expect(persistence).toHaveBeenCalledWith(
    expect.any(Function),
    expect.any(Function),
    expect.any(Function)
  );
});

it.each(['account', 'network'])(
  'refuses an unpublished approval when %s changes during persistence',
  async (field) => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    persistence.mockImplementationOnce(async (prepare, assertCurrent) => {
      entered();
      await pending;
      assertCurrent();
      store.dispatch(prepare());
    });
    const saving = wallet.handleWatchAsset(preview, expected);
    const rejected = expect(saving).rejects.toThrow('Asset context changed');
    await started;
    change(field);
    finish();
    await rejected;
    expect(ethSave).toHaveBeenCalledTimes(1);
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(state.vault.accountAssets[TYPE][0].ethereum).toEqual([]);
    expect(state.vault.accountAssets[TYPE][1].ethereum).toEqual([]);
  }
);
