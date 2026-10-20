/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import { AddToken } from 'pages/Tokens/AddToken';
import EthAccountController from 'scripts/Background/controllers/account/evm';
import { verifyERC1155OwnershipHelper } from 'scripts/Background/controllers/assets/nft-utils';
import vaultReducer, { setAccountAssets } from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { Interface } from 'utils/ethersV6Compat';

let mockStore: any;
let mockAccount: ReturnType<typeof EthAccountController>;
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
const originalFetch = globalThis.fetch;
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      key === 'tokens.importNamedToken'
        ? `Import ${values?.symbol} token`
        : key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  FiDownload: () => null,
  RiShareForward2Line: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('utils/index', () => ({ ...jest.requireActual('utils/format') }));

const CONTRACT = `0x${'33'.repeat(20)}`;
const OWNER = `0x${'11'.repeat(20)}`;
const MAX_ID = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();
const abi = new Interface([
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
]);
const calls: string[] = [];
const runner = {
  call: async (transaction: { data: string }) => {
    const decoded = abi.parseTransaction(transaction)!;
    if (decoded.name === 'balanceOf') {
      const id = decoded.args[1].toString();
      calls.push(id);
      return abi.encodeFunctionResult('balanceOf', [
        id === '1' || id === '2' ? 2 : 0,
      ]);
    }
    const ids = Array.from(decoded.args[1], (id: any) => id.toString());
    calls.push(...ids);
    return abi.encodeFunctionResult('balanceOfBatch', [
      ids.map((id) => (id === '1' || id === '2' ? 2 : 0)),
    ]);
  },
};
const assets = () =>
  mockStore.getState().vault.accountAssets.HDAccount[0].ethereum;
const button = () =>
  screen.getByRole('button', {
    name: 'Import SAMPLE token',
  }) as HTMLButtonElement;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  calls.length = 0;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: () => {
      throw new Error('Offline proof');
    },
  });
  jest.spyOn(crypto, 'getRandomValues').mockImplementation((array: any) => {
    array.fill(0);
    array[31] = 42;
    return array;
  });
  const initial = vaultReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...initial,
        isBitcoinBased: false,
        activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
        activeNetwork: {
          kind: INetworkType.Ethereum,
          chainId: 1,
          slip44: 60,
          url: 'https://rpc.synthetic.invalid',
          apiUrl: 'https://explorer.synthetic.invalid/api',
        },
        accounts: {
          ...initial.accounts,
          HDAccount: { 0: { id: 0, address: OWNER } },
        },
        accountAssets: {
          ...initial.accountAssets,
          HDAccount: { 0: { ethereum: [], syscoin: [] } },
        },
      } as any,
      vaultGlobal: {
        ...vaultGlobalReducer(undefined, { type: 'test/init' }),
        activeSlip44: 60,
      },
    },
  });
  mockAccount = EthAccountController();
  mockEmitter.mockImplementation(async ([, method]: string[], args: any[]) => {
    if (method === 'getUserOwnedTokens') return [];
    if (method === 'getTokenDetailsWithMarketData')
      return {
        contractAddress: CONTRACT,
        symbol: 'SAMPLE',
        name: 'Sample NFT',
        decimals: 0,
        tokenStandard: 'ERC-1155',
        isNft: true,
        balance: 0,
        image: 'https://image.synthetic.invalid/nft.png',
      };
    if (method === 'verifyERC1155Ownership')
      return verifyERC1155OwnershipHelper(
        args[0],
        args[1],
        args[2],
        runner as any
      );
    if (method === 'saveTokenInfo') {
      const prepare = await mockAccount.prepareTokenAddition(args[0]);
      mockStore.dispatch(prepare());
      return;
    }
    throw new Error(`Unexpected method ${method}`);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  if (originalFetch) globalThis.fetch = originalFetch;
  else Reflect.deleteProperty(globalThis, 'fetch');
});

it.each([
  { first: '1', second: '01', expectedCount: 1 },
  { first: '1', second: '0x01', expectedCount: 1 },
  { first: '0', second: '000', expectedCount: 1 },
  { first: '0', second: '0x00', expectedCount: 1 },
  { first: MAX_ID, second: `0x${'f'.repeat(64)}`, expectedCount: 1 },
  { first: '1', second: '2', expectedCount: 2 },
])(
  'uses numeric token identity for custom import $first followed by $second',
  async ({ first, second, expectedCount }) => {
    render(
      <Provider store={mockStore}>
        <MemoryRouter
          initialEntries={['/tokens/add?tab=custom']}
          future={{
            ['v7_startTransition']: true,
            ['v7_relativeSplatPath']: true,
          }}
        >
          <AddToken />
        </MemoryRouter>
      </Provider>
    );
    fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
      target: { value: CONTRACT },
    });
    await act(async () => jest.advanceTimersByTimeAsync(500));
    fireEvent.change(screen.getByLabelText('send.tokenId'), {
      target: { value: first },
    });
    await act(async () => jest.advanceTimersByTimeAsync(0));
    expect(button().disabled).toBe(false);
    await act(async () => fireEvent.click(button()));
    expect(assets()).toHaveLength(1);
    expect(button().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('send.tokenId'), {
      target: { value: second },
    });
    await act(async () => jest.advanceTimersByTimeAsync(0));
    expect(screen.getByLabelText('send.tokenId')).toHaveValue(second);
    if (!button().disabled) await act(async () => fireEvent.click(button()));
    expect(calls).toContain(BigInt(second).toString());
    expect(assets()).toHaveLength(expectedCount);
    expect(assets()[0].tokenId).toBe(BigInt(first).toString());
  }
);

it.each(['0001', '0x01', '0X01', '0000', '0x00', MAX_ID])(
  'canonicalizes a valid ID at the account-controller boundary: %s',
  async (tokenId) => {
    const token = {
      contractAddress: CONTRACT,
      chainId: 1,
      tokenSymbol: 'SAMPLE',
      decimals: 0,
      balance: 2,
      tokenStandard: 'ERC-1155',
      isNft: true,
      tokenId,
    };
    const prepare = await mockAccount.prepareTokenAddition(token as any);
    mockStore.dispatch(prepare());
    expect(assets()[0].tokenId).toBe(BigInt(tokenId).toString());
    expect(assets()[0].id).toBe(`${CONTRACT}-1-${BigInt(tokenId)}`);
    expect(token.tokenId).toBe(tokenId);
  }
);

it.each([
  '-1',
  '1.5',
  '1e3',
  '',
  undefined,
  (BigInt(1) << BigInt(256)).toString(),
])(
  'rejects invalid NFT ID %s before generating an account mutation',
  async (tokenId) => {
    await expect(
      mockAccount.prepareTokenAddition({
        contractAddress: CONTRACT,
        chainId: 1,
        tokenSymbol: 'SAMPLE',
        decimals: 0,
        balance: 2,
        tokenStandard: 'ERC-1155',
        isNft: true,
        tokenId,
      } as any)
    ).rejects.toThrow();
    expect(assets()).toEqual([]);
  }
);

it('compares an existing valid alias without rewriting it or hiding another chain or contract', async () => {
  const make = (tokenId: string, chainId = 1, contractAddress = CONTRACT) => ({
    contractAddress,
    chainId,
    tokenSymbol: 'SAMPLE',
    decimals: 0,
    balance: 2,
    tokenStandard: 'ERC-1155',
    isNft: true,
    tokenId,
  });
  const existing = make('0001');
  mockStore.dispatch(
    setAccountAssets({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      property: 'ethereum',
      value: [existing],
    })
  );
  const duplicate = await mockAccount.prepareTokenAddition(make('0x01') as any);
  expect(() => duplicate()).toThrow('already exists');
  expect(assets()).toEqual([existing]);
  expect(assets()[0].tokenId).toBe('0001');
  const otherContract = `0x${'44'.repeat(20)}`;
  const prepareOther = await mockAccount.prepareTokenAddition(
    make('1', 1, otherContract) as any
  );
  mockStore.dispatch(prepareOther());
  const prepareDistinct = await mockAccount.prepareTokenAddition(
    make('2') as any
  );
  mockStore.dispatch(prepareDistinct());
  expect(assets()).toHaveLength(3);
  expect(assets()[0]).toEqual(existing);
  mockStore.dispatch(
    setAccountAssets({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      property: 'ethereum',
      value: [make('01', 2)],
    })
  );
  const prepareChain = await mockAccount.prepareTokenAddition(make('1') as any);
  mockStore.dispatch(prepareChain());
  expect(assets()).toHaveLength(2);
  expect(assets()[0].chainId).toBe(2);
  expect(assets()[1].id).toBe(`${CONTRACT}-1-1`);
});

it('keeps a canonically equivalent saved alias disabled in the actual custom import list', async () => {
  const existing = {
    contractAddress: CONTRACT,
    chainId: 1,
    tokenSymbol: 'SAMPLE',
    decimals: 0,
    balance: 2,
    tokenStandard: 'ERC-1155',
    isNft: true,
    tokenId: '0001',
  };
  mockStore.dispatch(
    setAccountAssets({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      property: 'ethereum',
      value: [existing as any],
    })
  );
  render(
    <Provider store={mockStore}>
      <MemoryRouter initialEntries={['/tokens/add?tab=custom']}>
        <AddToken />
      </MemoryRouter>
    </Provider>
  );
  fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
    target: { value: CONTRACT },
  });
  await act(async () => jest.advanceTimersByTimeAsync(500));
  fireEvent.change(screen.getByLabelText('send.tokenId'), {
    target: { value: '0x01' },
  });
  await act(async () => jest.advanceTimersByTimeAsync(0));
  expect(button()).toBeDisabled();
  expect(assets()).toEqual([existing]);
  expect(screen.getByLabelText('send.tokenId')).toHaveValue('0x01');
});

it('imports a valid owned alias canonically without letting an invalid ID hide the valid row', async () => {
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, args) =>
    path[1] === 'getUserOwnedTokens'
      ? Promise.resolve([
          {
            id: `${CONTRACT}-1-0001`,
            contractAddress: CONTRACT,
            tokenId: '0001',
            symbol: 'SAMPLE',
            name: 'Sample NFT',
            decimals: 0,
            balance: 2,
            rawBalance: '2',
            tokenStandard: 'ERC-1155',
            image: 'https://image.synthetic.invalid/nft.png',
          },
          {
            id: `${CONTRACT}-1-invalid`,
            contractAddress: CONTRACT,
            tokenId: (BigInt(1) << BigInt(256)).toString(),
            symbol: 'INVALID',
            name: 'Invalid ID',
            decimals: 0,
            balance: 2,
            tokenStandard: 'ERC-1155',
          },
        ])
      : original(path, args)
  );
  render(
    <Provider store={mockStore}>
      <MemoryRouter initialEntries={['/tokens/add?tab=owned']}>
        <AddToken />
      </MemoryRouter>
    </Provider>
  );
  await act(async () => jest.advanceTimersByTimeAsync(0));
  expect(
    screen.queryByRole('button', { name: 'Import INVALID token' })
  ).toBeNull();
  expect(button()).toBeEnabled();
  await act(async () => fireEvent.click(button()));
  expect(assets()).toHaveLength(1);
  expect(assets()[0]).toMatchObject({
    tokenId: '1',
    id: `${CONTRACT}-1-1`,
    rawBalance: '2',
  });
});
