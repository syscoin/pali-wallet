import axios from 'axios';

import { KeyringAccountType } from 'types/network';

import EthAccountController from './evm';
import { getAccountAssets } from './getAccountAssets';
import SysAccountController from './syscoin';

let mockState: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const TYPE = KeyringAccountType.HDAccount;
const selected = { id: 0, type: TYPE };
const CONTRACT = `0x${'11'.repeat(20)}`;
const evm = (chainId = 1, tokenId?: string) => ({
  contractAddress: CONTRACT,
  tokenSymbol: 'PUBLIC',
  balance: 1,
  decimals: 0,
  chainId,
  tokenStandard: tokenId === undefined ? 'ERC-20' : 'ERC-1155',
  tokenId,
});
const spt = (chainId = 1, assetGuid = '123456') => ({
  assetGuid,
  symbol: 'PUBLIC',
  balance: 1,
  decimals: 0,
  chainId,
});
const empty = () => ({ ethereum: [], syscoin: [] });
const fixture = () => ({
  activeAccount: { ...selected },
  activeNetwork: { chainId: 1 },
  accountAssets: { [TYPE]: { 0: empty(), 1: empty() } },
});
const controllers = [
  {
    family: 'ethereum',
    label: 'Ethereum',
    token: evm(),
    create: () => EthAccountController(),
    remove: (controller: any) => controller.prepareTokenRemoval(CONTRACT, 1),
    absent: "Token doesn't exist on specified network!",
  },
  {
    family: 'syscoin',
    label: 'Syscoin',
    token: spt(),
    create: () =>
      SysAccountController(() => {
        throw new Error('No keyring call expected');
      }),
    remove: (controller: any) => controller.prepareTokenRemoval('123456'),
    absent: "Token doesn't exist on this network!",
  },
];
const invalidContainers = [
  { name: 'root', value: undefined, error: 'Account assets not initialized' },
  {
    name: 'namespace',
    value: {},
    error: `Account type '${TYPE}' not found in accountAssets`,
  },
  {
    name: 'account',
    value: { [TYPE]: {} },
    error: `Account ID '0' not found for account type '${TYPE}'`,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockState = { vault: fixture() };
  jest
    .mocked(axios.get)
    .mockRejectedValue(new Error('Unexpected metadata read'));
});

it('validates the supplied snapshot without reading the current global store', () => {
  const original = mockState.vault.accountAssets;
  mockState.vault.accountAssets = undefined;
  expect(getAccountAssets(original, selected)).toBe(original[TYPE][0]);
});

describe.each(controllers)('$label asset container boundaries', (scenario) => {
  it.each(invalidContainers)(
    'preserves the ordered $name admission error',
    async ({ value, error }) => {
      mockState.vault.accountAssets = value;
      await expect(
        scenario.create().prepareTokenAddition(scenario.token as any)
      ).rejects.toThrow(error);
      expect(axios.get).not.toHaveBeenCalled();
    }
  );

  it.each(invalidContainers)(
    'preserves the ordered $name error at removal execution',
    ({ value, error }) => {
      const remove = scenario.remove(scenario.create());
      mockState.vault.accountAssets = value;
      expect(remove).toThrow(error);
    }
  );

  it('retains its family-specific error after the three container checks', async () => {
    mockState.vault.accountAssets[TYPE][0] = {};
    const message = `${scenario.label} assets array not initialized`;
    await expect(
      scenario.create().prepareTokenAddition(scenario.token as any)
    ).rejects.toThrow(message);
    expect(scenario.remove(scenario.create())).toThrow(message);
  });

  it('accepts an empty family for addition and retains the absent-token removal error', async () => {
    const controller = scenario.create();
    const add = await controller.prepareTokenAddition(scenario.token as any);
    const action = add();
    expect(action.payload.accountId).toBe(0);
    expect(action.payload.property).toBe(scenario.family);
    expect(action.payload.value).toHaveLength(1);
    expect(scenario.remove(controller)).toThrow(scenario.absent);
  });

  it('keeps the late addition single family error rather than replaying admission checks', async () => {
    const add = await scenario
      .create()
      .prepareTokenAddition(scenario.token as any);
    mockState.vault.accountAssets = undefined;
    expect(add).toThrow(`${scenario.label} assets array not initialized`);
  });

  it('captures the selected account but merges the latest target list at addition execution', async () => {
    const add = await scenario
      .create()
      .prepareTokenAddition(scenario.token as any);
    const concurrent = scenario.family === 'ethereum' ? evm(2) : spt(2);
    mockState.vault.accountAssets[TYPE][0][scenario.family] = [concurrent];
    mockState.vault.activeAccount = { id: 1, type: TYPE };
    const action = add();
    expect(action.payload.accountId).toBe(0);
    expect(action.payload.value).toHaveLength(2);
    expect(action.payload.value[0]).toBe(concurrent);
    expect(mockState.vault.accountAssets[TYPE][1][scenario.family]).toEqual([]);
  });

  it('defers removal validation and reads the latest captured-account list', () => {
    const controller = scenario.create();
    mockState.vault.accountAssets = undefined;
    const remove = scenario.remove(controller);
    const survivor = scenario.family === 'ethereum' ? evm(2) : spt(2);
    mockState.vault.accountAssets = { [TYPE]: { 0: empty(), 1: empty() } };
    mockState.vault.accountAssets[TYPE][0][scenario.family] = [
      scenario.token,
      survivor,
    ];
    mockState.vault.activeAccount = { id: 1, type: TYPE };
    const action = remove();
    expect(action.payload.accountId).toBe(0);
    expect(action.payload.value).toEqual([survivor]);
  });
});

it.each([undefined, ''])(
  'keeps EVM whole-contract removal semantics for tokenId %s',
  (tokenId) => {
    const otherContract = {
      ...evm(1, '1'),
      contractAddress: `0x${'22'.repeat(20)}`,
    };
    mockState.vault.accountAssets[TYPE][0].ethereum = [
      evm(1, '1'),
      evm(1, '2'),
      evm(2, '1'),
      otherContract,
    ];
    const remove = EthAccountController().prepareTokenRemoval(
      CONTRACT.toUpperCase(),
      1,
      tokenId
    );
    expect(remove().payload.value).toEqual([evm(2, '1'), otherContract]);
  }
);

it('keeps exact EVM tokenId removal and does not canonicalize stored aliases', () => {
  mockState.vault.accountAssets[TYPE][0].ethereum = [
    evm(1, '0'),
    evm(1, '00'),
    evm(1, '1'),
    evm(2, '0'),
  ];
  const remove = EthAccountController().prepareTokenRemoval(CONTRACT, 1, '0');
  expect(remove().payload.value).toEqual([
    evm(1, '00'),
    evm(1, '1'),
    evm(2, '0'),
  ]);
});

it('validates SPT admission before metadata IO and later uses the latest captured target', async () => {
  let finish!: (value: any) => void;
  jest.mocked(axios.get).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const preparing = SysAccountController(() => {
    throw new Error('No keyring call expected');
  }).prepareTokenAddition({
    ...spt(),
    description: 'https://ipfs.io/ipfs/public-metadata',
  } as any);
  expect(axios.get).toHaveBeenCalledTimes(1);
  const survivor = spt(2);
  mockState.vault.activeAccount = { id: 1, type: TYPE };
  mockState.vault.accountAssets[TYPE][0].syscoin = [survivor];
  finish({ data: { image: 'https://image.synthetic.invalid/public.png' } });
  const add = await preparing;
  const action = add();
  expect(action.payload.accountId).toBe(0);
  expect(action.payload.value[0]).toBe(survivor);
  expect(action.payload.value[1]).toMatchObject({
    assetGuid: '123456',
    chainId: 1,
    image: 'https://image.synthetic.invalid/public.png',
  });
});
