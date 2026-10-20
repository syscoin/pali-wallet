jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn() },
  DEVICE_EVENT: 'device-event',
}));
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-keyring'),
  CustomJsonRpcProvider: jest.fn(() => mockReceiptProvider),
}));

import { Interface } from 'ethers/abi';
import http from 'http';
import https from 'https';

import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot, setAccountAssets } from 'state/vault';
import vaultCache from 'state/vaultCache';
import {
  setActiveSlip44,
  setIsSwitchingAccount,
  setNetworkStatus,
} from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';

import EthAccountController from './account/evm';
import AssetsManager from './assets';
import EvmAssetsController from './assets/evm';
import { ReceiptBalanceRefresh } from './balances/ReceiptBalanceRefresh';
import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';

const TOKEN = `0x${'33'.repeat(20)}`;
const OTHER = `0x${'44'.repeat(20)}`;
const UNKNOWN = `0x${'55'.repeat(20)}`;
const ADDRESS = `0x${'11'.repeat(20)}`;
const TYPE = KeyringAccountType.HDAccount;
const CONTEXT_CHANGED = 'Token balance refresh context changed';
const abi = new Interface([
  'function supportsInterface(bytes4) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function balanceOf(address,uint256) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);
const originalChrome = global.chrome;
const clone = <T>(value: T): T => structuredClone(value);
let wallet: any;
let records: Record<string, any>;
let holdNextBalance: boolean;
let releaseBalance: () => void;
let enteredBalance: Promise<void>;
let signalBalance: () => void;
let chainHeight: number;
let normalPollRejectTarget: boolean;
let mockReceiptProvider: any;
let balanceReads: Array<{ blockTag: unknown; height: number; raw: string }>;

const tokens = () => store.getState().vault.accountAssets[TYPE][0].ethereum;
const storedTokens = async () =>
  (await loadSlip44State(60)).accountAssets[TYPE][0].ethereum;
const remove = () =>
  wallet.deleteTokenInfo(TOKEN, 5700, undefined, getWalletNavigationScope());
const importFresh = async (address = TOKEN) => {
  chainHeight = 12;
  const preview = await wallet.getTokenDetailsWithMarketData(address, ADDRESS);
  expect(preview).toMatchObject({
    balance: 99,
    symbol: 'ASSET',
    decimals: 6,
    isNft: false,
  });
  // Match the normal ImportToken mapping after the real SDK metadata lookup.
  await wallet.saveTokenInfo(
    { ...preview, tokenSymbol: preview.symbol },
    getWalletNavigationScope()
  );
};
const incomingReceipt = (contractAddress = TOKEN) =>
  wallet.refreshBalancesAfterReceipt({
    from: OTHER,
    to: ADDRESS,
    contractAddress,
    blockNumber: 10,
    chainId: 5700,
  });

beforeEach(async () => {
  jest.useFakeTimers();
  const deny = () => {
    throw new Error('Token membership tests must remain offline');
  };
  jest.spyOn(http, 'request').mockImplementation(deny);
  jest.spyOn(https, 'request').mockImplementation(deny);
  jest.spyOn(http, 'get').mockImplementation(deny);
  jest.spyOn(https, 'get').mockImplementation(deny);
  jest.spyOn(globalThis, 'fetch').mockImplementation(deny);
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  const groups = () =>
    Object.fromEntries(
      Object.values(KeyringAccountType).map((type) => [type, {}])
    );
  const accounts = groups();
  const accountAssets = groups();
  accounts[TYPE] = {
    0: { id: 0, address: ADDRESS, xpub: 'public-synthetic-a', label: 'A' },
  };
  accountAssets[TYPE] = { 0: { ethereum: [], syscoin: [] } };
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      accounts,
      accountAssets,
      accountTransactions: groups(),
      isBitcoinBased: false,
      activeAccount: { id: 0, type: TYPE },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 5700,
        slip44: 60,
        url: 'https://synthetic.invalid',
        currency: 'sys',
        label: 'Synthetic',
      },
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(setNetworkStatus('idle'));
  store.dispatch(setIsSwitchingAccount(false));
  records = {};
  global.chrome = {
    runtime: { id: 'synthetic-asset-reimport' },
    storage: {
      local: {
        get: (keys: string[], callback: (value: any) => void) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            )
          ),
        set: (items: any, callback: () => void) => {
          Object.assign(records, clone(items));
          callback();
        },
      },
    },
  } as any;
  await persistCommittedWalletState(true);
  holdNextBalance = false;
  normalPollRejectTarget = false;
  chainHeight = 11;
  balanceReads = [];
  enteredBalance = new Promise<void>((resolve) => {
    signalBalance = resolve;
  });
  const provider = {
    getCode: async (address: string) =>
      [TOKEN, OTHER].includes(address.toLowerCase()) ? '0x6000' : '0x',
    getNetwork: async () => ({ chainId: BigInt(5700) }),
    call: async (tx: any) => {
      const parsed = abi.parseTransaction({ data: tx.data })!;
      if (parsed.name === 'supportsInterface')
        return abi.encodeFunctionResult(parsed.fragment, [false]);
      if (parsed.name === 'symbol')
        return abi.encodeFunctionResult(parsed.fragment, ['ASSET']);
      if (parsed.name === 'decimals')
        return abi.encodeFunctionResult(parsed.fragment, [6]);
      if (parsed.name === 'balanceOf') {
        if (normalPollRejectTarget && tx.to.toLowerCase() === TOKEN)
          throw new Error('Synthetic normal-poll target read unavailable');
        const height =
          typeof tx.blockTag === 'number' ? tx.blockTag : chainHeight;
        const raw = BigInt(
          parsed.args.length === 2
            ? String(parsed.args[1]) === '7'
              ? 17
              : 28
            : normalPollRejectTarget && tx.to.toLowerCase() === OTHER
            ? 26000000
            : height <= 11
            ? 7000000
            : 99000000
        );
        balanceReads.push({
          blockTag: tx.blockTag ?? 'latest',
          height,
          raw: raw.toString(),
        });
        if (holdNextBalance) {
          holdNextBalance = false;
          signalBalance();
          const held = await new Promise<bigint>((resolve) => {
            // Release the captured block snapshot, never a caller-chosen result.
            releaseBalance = () => resolve(raw);
          });
          return abi.encodeFunctionResult(parsed.fragment, [held]);
        }
        return abi.encodeFunctionResult(parsed.fragment, [raw]);
      }
      throw new Error('Unexpected synthetic contract read');
    },
  };
  const keyring = { ethereumTransaction: { web3Provider: provider } };
  mockReceiptProvider = {
    ...provider,
    send: async () => `0x${chainHeight.toString(16)}`,
    destroy: jest.fn(),
  };
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    getActiveKeyring: () => keyring,
    isUnlocked: () => true,
    resetAutoLockTimer: jest.fn(),
    account: { eth: EthAccountController() },
    evmAssetsController: EvmAssetsController(),
    assetsManager: AssetsManager(),
    assetUpdateRequestId: 0,
    cancellablePromises: new CancellablePromises(),
    receiptBalanceRefresh: new ReceiptBalanceRefresh(),
  });
  const metadata = await wallet.getTokenDetailsWithMarketData(TOKEN, ADDRESS);
  await wallet.saveTokenInfo(
    { ...metadata, tokenSymbol: metadata.symbol, balance: 5 },
    getWalletNavigationScope()
  );
  balanceReads = [];
});

afterEach(() => {
  wallet.receiptBalanceRefresh.cancel();
  jest.clearAllTimers();
  jest.useRealTimers();
  vaultCache.clearCache();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
});

describe.each(['preflight', 'receipt'] as const)(
  '%s token read membership',
  (kind) => {
    const startRead = async () => {
      holdNextBalance = true;
      const promise =
        kind === 'preflight'
          ? wallet.refreshActiveEvmTokenBalance(TOKEN)
          : undefined;
      if (kind === 'receipt') {
        incomingReceipt();
        await jest.advanceTimersByTimeAsync(100);
      }
      await enteredBalance;
      return { promise };
    };
    const finishRead = async (
      read: { promise?: Promise<unknown> },
      replaced = false
    ) => {
      const completed =
        replaced && kind === 'preflight'
          ? expect(read.promise).rejects.toThrow(CONTEXT_CHANGED)
          : read.promise;
      releaseBalance();
      await completed;
      await jest.advanceTimersByTimeAsync(0);
    };

    it('updates an untouched target with the captured block balance', async () => {
      const pending = await startRead();
      await finishRead(pending);
      expect(tokens()[0]).toMatchObject({ balance: 7, rawBalance: '7000000' });
    });

    it('preserves target identity through an unrelated durable import', async () => {
      const original = tokens()[0];
      const pending = await startRead();
      await importFresh(OTHER);
      expect(tokens().find((token) => token.contractAddress === TOKEN)).toBe(
        original
      );
      await finishRead(pending);
      expect(
        tokens().find((token) => token.contractAddress === TOKEN)?.balance
      ).toBe(7);
      expect(
        tokens().find((token) => token.contractAddress === OTHER)?.balance
      ).toBe(99);
    });

    it('does not resurrect a durably deleted target', async () => {
      const pending = await startRead();
      await remove();
      await finishRead(pending, true);
      expect(tokens()).toEqual([]);
      expect(await storedTokens()).toEqual([]);
    });

    it('preserves a newer same-key same-metadata durable import', async () => {
      const original = tokens()[0];
      const pending = await startRead();
      await remove();
      await importFresh();
      const metadata = (token: any) => {
        const result = { ...token };
        delete result.balance;
        delete result.rawBalance;
        return result;
      };
      expect(metadata(tokens()[0])).toEqual(metadata(original));
      expect(tokens()[0]).not.toBe(original);
      expect(tokens()[0].balance).toBe(99);
      expect((await storedTokens())[0].balance).toBe(99);
      expect(balanceReads[0]).toMatchObject({ height: 11, raw: '7000000' });
      expect(
        balanceReads
          .slice(1)
          .every((read) => read.height === 12 && read.raw === '99000000')
      ).toBe(true);
      await finishRead(pending, true);
      expect(tokens()[0].balance).toBe(99);
      expect((await storedTokens())[0].balance).toBe(99);
    });

    it('preserves a newer target balance and name update', async () => {
      const pending = await startRead();
      store.dispatch(
        setAccountAssets({
          accountId: 0,
          accountType: TYPE,
          property: 'ethereum',
          value: tokens().map((token) => ({
            ...token,
            balance: 55,
            rawBalance: '55000000',
            name: 'Newer name',
          })),
        })
      );
      await persistCommittedWalletState(true);
      await finishRead(pending, true);
      expect(tokens()[0]).toMatchObject({
        balance: 55,
        rawBalance: '55000000',
        name: 'Newer name',
      });
      expect((await storedTokens())[0]).toMatchObject({
        balance: 55,
        name: 'Newer name',
      });
    });
  }
);

it('does not read a replaced token from an old queued receipt job', async () => {
  incomingReceipt();
  await remove();
  await importFresh();
  const readsAfterImport = balanceReads.length;
  await jest.advanceTimersByTimeAsync(100);
  expect(balanceReads).toHaveLength(readsAfterImport);
  expect(tokens()[0].balance).toBe(99);
});

it('retains a failed normal-poll row so an in-flight receipt can update it', async () => {
  await importFresh(OTHER);
  const original = tokens().find((token) => token.contractAddress === TOKEN);
  chainHeight = 11;
  holdNextBalance = true;
  incomingReceipt();
  await jest.advanceTimersByTimeAsync(100);
  await enteredBalance;
  normalPollRejectTarget = true;
  const poll = wallet.updateAssetsFromCurrentAccount({
    activeAccount: store.getState().vault.activeAccount,
    activeNetwork: store.getState().vault.activeNetwork,
    isBitcoinBased: false,
    isPolling: true,
  });
  await jest.advanceTimersByTimeAsync(100);
  await poll;
  expect(tokens().find((token) => token.contractAddress === TOKEN)).toBe(
    original
  );
  expect(
    tokens().find((token) => token.contractAddress === OTHER)?.balance
  ).toBe(26);
  releaseBalance();
  await jest.advanceTimersByTimeAsync(0);
  expect(
    tokens().find((token) => token.contractAddress === TOKEN)?.balance
  ).toBe(7);
  expect(
    tokens().find((token) => token.contractAddress === OTHER)?.balance
  ).toBe(26);
});

it('does not read unrelated NFT or fungible rows for an unknown receipt token', async () => {
  await wallet.saveTokenInfo(
    {
      contractAddress: OTHER,
      chainId: 5700,
      isNft: true,
      tokenStandard: 'ERC-721',
      decimals: 0,
      tokenSymbol: 'NFT',
      balance: 1,
    },
    getWalletNavigationScope()
  );
  const before = tokens();
  incomingReceipt(UNKNOWN);
  await jest.advanceTimersByTimeAsync(100);
  expect(balanceReads).toEqual([]);
  expect(tokens()).toBe(before);
});

it('refreshes an admitted ERC721 collection without changing an unrelated row', async () => {
  await wallet.saveTokenInfo(
    {
      contractAddress: OTHER,
      chainId: 5700,
      isNft: true,
      tokenStandard: 'ERC-721',
      decimals: 0,
      tokenSymbol: 'NFT',
      balance: 1,
    },
    getWalletNavigationScope()
  );
  const unchanged = tokens()[0];
  incomingReceipt(OTHER);
  await jest.advanceTimersByTimeAsync(100);
  expect(tokens()[0]).toBe(unchanged);
  expect(tokens()[1]).toMatchObject({
    balance: 7000000,
    rawBalance: '7000000',
  });
  expect(balanceReads).toHaveLength(1);
});

it('refreshes both admitted ERC1155 IDs while preserving their separate balances', async () => {
  await remove();
  for (const tokenId of ['0x07', '8']) {
    await wallet.saveTokenInfo(
      {
        contractAddress: TOKEN,
        chainId: 5700,
        isNft: true,
        tokenStandard: 'ERC-1155',
        tokenId,
        decimals: 0,
        tokenSymbol: 'NFT',
        balance: 1,
      },
      getWalletNavigationScope()
    );
  }
  incomingReceipt();
  await jest.advanceTimersByTimeAsync(100);
  expect(tokens()).toEqual([
    expect.objectContaining({ tokenId: '7', balance: 17, rawBalance: '17' }),
    expect.objectContaining({ tokenId: '8', balance: 28, rawBalance: '28' }),
  ]);
  expect(balanceReads).toHaveLength(2);
});

it.each(['preflight', 'receipt'] as const)(
  '%s updates only its captured row if an unsupported duplicate object is present',
  async (kind) => {
    const captured = tokens()[0];
    // Production admission rejects duplicate keys; even malformed restored
    // state must not broaden a read's write authority to another row object.
    const duplicate = { ...captured, name: 'Duplicate object', balance: 55 };
    store.dispatch(
      setAccountAssets({
        accountId: 0,
        accountType: TYPE,
        property: 'ethereum',
        value: [captured, duplicate],
      })
    );
    if (kind === 'preflight') await wallet.refreshActiveEvmTokenBalance(TOKEN);
    else {
      incomingReceipt();
      await jest.advanceTimersByTimeAsync(100);
    }
    expect(tokens()[0]).toMatchObject({ balance: 7, rawBalance: '7000000' });
    expect(tokens()[1]).toBe(duplicate);
    expect(tokens()[1].balance).toBe(55);
    expect(balanceReads).toHaveLength(1);
  }
);
