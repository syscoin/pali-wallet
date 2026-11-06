import { configureStore } from '@reduxjs/toolkit';

import SysAccountController from '../account/syscoin';
import vault, { createAccount, setNetworkChange } from 'state/vault';
import { initialActiveHdAccountState, KeyringAccountType } from 'types/network';
import { ITokenSysProps } from 'types/tokens';
import { getSyscoinUTXOTestnetNetwork } from 'utils/defaultNetworks';

import SysAssetsController from './syscoin';

let mockStore: any;
const mockMetadata = jest.fn();
const mockInventory = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('@sidhujag/sysweb3-utils', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-utils'),
  getAsset: (...args: any[]) => mockMetadata(...args),
}));
jest.mock('../utils/fetchBackendAccountWrapper', () => ({
  fetchBackendAccountCached: (...args: any[]) => mockInventory(...args),
}));

const NETWORK = {
  ...getSyscoinUTXOTestnetNetwork(),
  url: 'https://blockbook.synthetic.invalid/',
};
const ACCOUNT = {
  ...initialActiveHdAccountState,
  id: 0,
  label: 'Public balance availability fixture',
  address: 'tsys1qpublic',
  xpub: 'vpub-public-balance-availability',
};
const GUID = '123';
const metadata = {
  assetGuid: GUID,
  symbol: 'BALANCE',
  decimals: 2,
  maxSupply: '10000000000000000000',
  totalSupply: '1000000',
  metaData: 'Public token description',
};
const holding = {
  assetGuid: GUID,
  symbol: 'BALANCE',
  decimals: 2,
  balance: '2500',
  unconfirmedBalance: '0',
  totalReceived: '2500',
  totalSent: '0',
  transfers: 1,
};
const completeSummary = {
  address: ACCOUNT.xpub,
  balance: '0',
  unconfirmedBalance: '0',
  txs: 0,
  unconfirmedTxs: 0,
};
let controller: ReturnType<typeof SysAssetsController>;
const validate = () =>
  controller.validateSPTOnly(GUID, ACCOUNT.xpub, NETWORK.url);
const added = (): ITokenSysProps[] =>
  mockStore.getState().vault.accountAssets.HDAccount[0].syscoin;
const add = async (token: ITokenSysProps) => {
  const prepare = await SysAccountController(() => {
    throw new Error('No keyring or signing operation is allowed');
  }).prepareTokenAddition(token);
  const action = prepare();
  expect(action.payload).toMatchObject({
    accountId: ACCOUNT.id,
    accountType: KeyringAccountType.HDAccount,
    property: 'syscoin',
  });
  mockStore.dispatch(action);
  return added()[0];
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  mockStore = configureStore({ reducer: { vault } });
  mockStore.dispatch(setNetworkChange({ activeNetwork: NETWORK }));
  mockStore.dispatch(
    createAccount({
      accountType: KeyringAccountType.HDAccount,
      account: ACCOUNT,
    })
  );
  mockMetadata.mockResolvedValue({ ...metadata });
  mockInventory.mockResolvedValue({
    address: ACCOUNT.xpub,
    tokensAsset: [{ ...holding }],
  });
  controller = SysAssetsController();
});
afterEach(() => jest.restoreAllMocks());

it('discovery rejects a partial inventory and preserves an exact retried balance', async () => {
  mockInventory.mockResolvedValueOnce({
    address: ACCOUNT.xpub,
    tokensAsset: [{ ...holding, balance: undefined }],
  });
  await expect(controller.getUserOwnedTokens(ACCOUNT.xpub)).rejects.toThrow(
    'SPT token inventory is unavailable or invalid'
  );
  mockInventory.mockResolvedValue({
    address: ACCOUNT.xpub,
    tokensAsset: [
      { ...holding, balance: '9007199254740993', unconfirmedBalance: '-1' },
      { ...holding, balance: '5', unconfirmedBalance: '0' },
    ],
  });
  await expect(
    controller.getUserOwnedTokens(ACCOUNT.xpub)
  ).resolves.toMatchObject([
    { assetGuid: GUID, balance: '90071992547409.97', utxoCount: 2 },
  ]);
});

it.each([
  null,
  undefined,
  [],
  'unavailable',
  {},
  { addressOrXpub: ACCOUNT.xpub, tokensAsset: [{ ...holding }] },
  {
    address: 'other-account',
    addressOrXpub: ACCOUNT.xpub,
    tokensAsset: [{ ...holding }],
  },
  {
    ...completeSummary,
    addressOrXpub: 'other-account',
    tokensAsset: [{ ...holding }],
  },
  { tokensAsset: [] },
  { ...completeSummary, address: 'other-account', tokensAsset: [] },
  { error: 'Backend unavailable' },
  { error: 'Backend unavailable', tokensAsset: [] },
  { message: 'Backend unavailable' },
  { balance: '0' },
  { ...completeSummary, txs: undefined },
  { ...completeSummary, unconfirmedBalance: undefined },
  { ...completeSummary, unconfirmedTxs: -1 },
  { ...completeSummary, tokensAsset: null },
  { ...completeSummary, tokensAsset: {} },
  { ...completeSummary, tokensAsset: [null] },
  { ...completeSummary, tokensAsset: [{ balance: '0' }] },
  { ...completeSummary, tokensAsset: [{ ...holding, balance: undefined }] },
  { ...completeSummary, tokensAsset: [{ ...holding, balance: '25.00' }] },
  {
    ...completeSummary,
    tokensAsset: [{ ...holding, balance: Number.MAX_SAFE_INTEGER + 1 }],
  },
  {
    ...completeSummary,
    tokensAsset: [{ ...holding, balance: '9'.repeat(79) }],
  },
  {
    ...completeSummary,
    tokensAsset: [{ ...holding, unconfirmedBalance: null }],
  },
  {
    ...completeSummary,
    tokensAsset: [{ ...holding, unconfirmedBalance: '-1.5' }],
  },
  { ...completeSummary, tokensAsset: [{ ...holding, totalSent: '-1' }] },
  { ...completeSummary, tokensAsset: [{ ...holding, transfers: 1.5 }] },
  { ...completeSummary, tokensAsset: [{ ...holding, decimals: -1 }] },
  { ...completeSummary, tokensAsset: [{ ...holding, decimals: 3 }] },
  {
    ...completeSummary,
    tokensAsset: [{ ...holding }, { ...holding, decimals: 3 }],
  },
  {
    ...completeSummary,
    tokensAsset: [
      { ...holding },
      { ...holding, assetGuid: '456', balance: 'unavailable' },
    ],
  },
])(
  'preserves valid manual metadata import but omits unknown balance for %p',
  async (reply) => {
    mockInventory.mockResolvedValue(reply);
    const token = await validate();
    expect(token).toMatchObject({
      assetGuid: GUID,
      symbol: metadata.symbol,
      name: metadata.symbol,
      decimals: metadata.decimals,
      description: metadata.metaData,
      chainId: NETWORK.chainId,
      type: 'SPTAllocated',
    });
    expect(token).not.toHaveProperty('balance');
    const saved = await add(token!);
    expect(saved).not.toHaveProperty('balance');
    expect(JSON.parse(JSON.stringify(saved))).not.toHaveProperty('balance');
    expect(saved).toMatchObject({ assetGuid: GUID, chainId: NETWORK.chainId });
    expect(mockMetadata).toHaveBeenCalledWith(NETWORK.url, GUID);
    expect(mockInventory).toHaveBeenCalledWith(
      NETWORK.url,
      ACCOUNT.xpub,
      'details=tokenBalances&tokens=nonzero',
      true
    );
  }
);

it('keeps manual metadata import available when the inventory request rejects', async () => {
  mockInventory.mockRejectedValue(new Error('Synthetic transport failure'));
  const token = await validate();
  expect(token).toMatchObject({ assetGuid: GUID, symbol: metadata.symbol });
  expect(token).not.toHaveProperty('balance');
  expect(await add(token!)).not.toHaveProperty('balance');
});

it('does not clear an imported balance or cache empty discovery from a partial response', async () => {
  const imported = await add((await validate())!);
  expect(imported.balance).toBe('25.0');

  mockInventory.mockResolvedValue({ address: ACCOUNT.xpub, tokensAsset: [] });
  await expect(controller.getUserOwnedTokens(ACCOUNT.xpub)).rejects.toThrow(
    'SPT token inventory is unavailable or invalid'
  );
  for (const inventory of [
    { address: ACCOUNT.xpub, tokensAsset: [] },
    { address: ACCOUNT.xpub, tokensAsset: [{ ...holding, assetGuid: '456' }] },
  ]) {
    mockInventory.mockResolvedValue(inventory);
    await expect(
      controller.getSysAssetsByXpub(
        ACCOUNT.xpub,
        NETWORK.url,
        NETWORK.chainId,
        [imported]
      )
    ).rejects.toThrow('SPT token inventory is unavailable or invalid');
    expect(added()[0].balance).toBe('25.0');
  }

  mockInventory.mockResolvedValue({ ...completeSummary, tokensAsset: [] });
  await expect(controller.getUserOwnedTokens(ACCOUNT.xpub)).resolves.toEqual(
    []
  );
});

it.each([
  { inventory: { ...completeSummary, tokensAsset: [] }, balance: '0' },
  {
    inventory: { address: ACCOUNT.xpub, tokensAsset: [{ ...holding }] },
    balance: '25.0',
  },
])(
  'refreshes an imported unknown balance to known $balance without changing metadata',
  async ({ inventory, balance }) => {
    mockInventory.mockResolvedValue(null);
    const imported = await add((await validate())!);
    expect(imported).not.toHaveProperty('balance');
    await expect(
      controller.getSysAssetsByXpub(
        ACCOUNT.xpub,
        NETWORK.url,
        NETWORK.chainId,
        added()
      )
    ).rejects.toThrow('SPT token inventory is unavailable or invalid');
    expect(added()[0]).not.toHaveProperty('balance');

    mockInventory.mockResolvedValue(inventory);
    const refreshed = await controller.getSysAssetsByXpub(
      ACCOUNT.xpub,
      NETWORK.url,
      NETWORK.chainId,
      added()
    );
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({
      assetGuid: GUID,
      chainId: NETWORK.chainId,
      description: metadata.metaData,
      balance,
    });
    expect(imported).not.toHaveProperty('balance');
  }
);

it.each([
  { ...completeSummary, tokensAsset: [] },
  completeSummary,
  { ...completeSummary, tokensAsset: [{ ...holding, assetGuid: '456' }] },
])(
  'retains an explicit known zero for a complete empty holding: %p',
  async (reply) => {
    mockInventory.mockResolvedValue(reply);
    const token = await validate();
    expect(token).toHaveProperty('balance', '0');
    expect(await add(token!)).toHaveProperty('balance', '0');
  }
);

it.each([
  { rows: [{ ...holding }], balance: '25.0' },
  { rows: [{ ...holding, unconfirmedBalance: '-300' }], balance: '22.0' },
  {
    rows: [
      { ...holding, unconfirmedBalance: '-300' },
      { ...holding, balance: '500', unconfirmedBalance: '50' },
    ],
    balance: '27.5',
  },
  {
    rows: [{ ...holding, balance: '9007199254740993123' }],
    balance: '90071992547409931.23',
  },
  { rows: [{ ...holding, unconfirmedBalance: undefined }], balance: '25.0' },
])(
  'retains exact confirmed plus signed pending balance $balance',
  async ({ rows, balance }) => {
    mockInventory.mockResolvedValue({
      address: ACCOUNT.xpub,
      tokensAsset: rows,
    });
    const token = await validate();
    expect(token).toHaveProperty('balance', balance);
    expect(await add(token!)).toHaveProperty('balance', balance);
  }
);

it('keeps exact zero-decimal holdings and signed pending changes', async () => {
  mockMetadata.mockResolvedValue({ ...metadata, decimals: 0 });
  mockInventory.mockResolvedValue({
    address: ACCOUNT.xpub,
    tokensAsset: [
      { ...holding, decimals: 0, balance: '2', unconfirmedBalance: '-1' },
    ],
  });
  const token = await validate();
  expect(token).toHaveProperty('balance', '1');
  expect(await add(token!)).toHaveProperty('balance', '1');
});

it.each([0, '0', '25.0'])(
  'retains an explicitly supplied balance %p through account addition',
  async (balance) => {
    expect(await add({ ...metadata, balance })).toHaveProperty(
      'balance',
      balance
    );
  }
);

it('omits an explicitly undefined input balance rather than manufacturing zero', async () => {
  const token = { ...metadata, balance: undefined };
  expect(await add(token)).not.toHaveProperty('balance');
  expect(token).toHaveProperty('balance', undefined);
});

it('does not turn missing metadata into an importable token', async () => {
  mockMetadata.mockResolvedValue(null);
  expect(await validate()).toBeNull();
  expect(mockInventory).not.toHaveBeenCalled();
  expect(added()).toEqual([]);
});
