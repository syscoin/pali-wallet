/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import { AddToken } from 'pages/Tokens/AddToken';
import EthAccountController from 'scripts/Background/controllers/account/evm';
import EvmAssetsController from 'scripts/Background/controllers/assets/evm';
import { verifyERC1155OwnershipHelper } from 'scripts/Background/controllers/assets/nft-utils';
import vaultReducer, { createAccount, setActiveAccount } from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { Interface } from 'utils/ethersV6Compat';

let mockStore: any;
let mockAccount: ReturnType<typeof EthAccountController>;
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
const originalFetch = globalThis.fetch;
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
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
jest.mock('components/TokenIcon', () => ({
  TokenIcon: ({ className }: any) => (
    <span data-testid="token-icon" className={className} />
  ),
}));
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
const abi = new Interface([
  'function supportsInterface(bytes4) view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
]);
const calls: string[] = [];
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let logoGate: ReturnType<typeof deferred>;
let market: ReturnType<typeof EvmAssetsController>;
const runner = {
  getCode: async () => '0x6000',
  call: async (transaction: { data: string }) => {
    const decoded = abi.parseTransaction(transaction)!;
    if (decoded.name === 'supportsInterface')
      return abi.encodeFunctionResult('supportsInterface', [
        decoded.args[0] === '0xd9b67a26',
      ]);
    if (decoded.name === 'name')
      return abi.encodeFunctionResult('name', ['Sample NFT']);
    if (decoded.name === 'symbol')
      return abi.encodeFunctionResult('symbol', ['SAMPLE']);
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
  logoGate = deferred();
  jest.clearAllMocks();
  calls.length = 0;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => '{"error":"No market data"}',
        json: async () => ({ error: 'No market data' }),
      } as Response)
      .mockImplementation(() => logoGate.promise),
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
          coingeckoPlatformId: 'ethereum',
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
  market = EvmAssetsController();
  mockEmitter.mockImplementation(async ([, method]: string[], args: any[]) => {
    if (method === 'getUserOwnedTokens') return [];
    if (method === 'getTokenDetailsWithMarketData')
      return market.getTokenDetailsWithMarketData(
        args[0],
        args[1],
        runner as any
      );
    if (method === 'verifyERC1155Ownership')
      return verifyERC1155OwnershipHelper(
        args[0],
        args[1],
        args[2],
        runner as any
      );
    if (method === 'getOnlyMarketData')
      return market.getOnlyMarketData(args[0]);
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

const mount = (tab = 'custom') =>
  render(
    <Provider store={mockStore}>
      <MemoryRouter initialEntries={[`/tokens/add?tab=${tab}`]}>
        <AddToken />
      </MemoryRouter>
    </Provider>
  );
const editId = async (value: string) => {
  fireEvent.change(screen.getByLabelText('send.tokenId'), {
    target: { value },
  });
  await act(async () => jest.advanceTimersByTimeAsync(0));
};
const finishLogo = async () =>
  act(async () =>
    logoGate.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'sample-nft',
        symbol: 'sample',
        image: { large: 'https://image.synthetic.invalid/nft.png' },
      }),
    } as Response)
  );

it.each([
  { change: 'unchanged', expected: 1 },
  { change: 'different ID', expected: 0 },
  { change: 'blank ID', expected: 0 },
  { change: 'ABA ID', expected: 0 },
  { change: 'different contract', expected: 0 },
])(
  'keeps an awaited custom NFT import bound to its selection: $change',
  async ({ change, expected }) => {
    mount();
    fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
      target: { value: CONTRACT },
    });
    await act(async () => jest.advanceTimersByTimeAsync(500));
    await editId('1');
    expect(button()).toBeEnabled();
    await act(async () => fireEvent.click(button()));
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getOnlyMarketData'],
      [CONTRACT]
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(assets()).toHaveLength(0);
    if (
      change === 'different ID' ||
      change === 'blank ID' ||
      change === 'ABA ID'
    ) {
      const next = change === 'blank ID' ? '' : '2';
      expect(screen.getByLabelText('send.tokenId')).toBeEnabled();
      await editId(next);
      expect(screen.getByLabelText('send.tokenId')).toHaveValue(next);
      if (change === 'ABA ID') await editId('1');
    } else if (change === 'different contract') {
      fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
        target: { value: '0x' + '44'.repeat(20) },
      });
      await act(async () => jest.advanceTimersByTimeAsync(0));
    }
    await finishLogo();
    if (change === 'ABA ID')
      expect(screen.getByTestId('token-icon')).not.toHaveClass('opacity-50');
    expect(assets()).toHaveLength(expected);
    if (expected) {
      expect(assets()[0]).toMatchObject({
        tokenId: '1',
        rawBalance: '2',
        chainId: 1,
        id: `${CONTRACT}-1-1`,
      });
      expect(mockAlert.success).toHaveBeenCalledTimes(1);
    } else {
      expect(mockAlert.success).not.toHaveBeenCalled();
      const currentId =
        change === 'ABA ID' || change === 'different contract' ? '1' : '2';
      if (change === 'different contract') {
        fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
          target: { value: CONTRACT },
        });
        await act(async () => jest.advanceTimersByTimeAsync(500));
      }
      if (change === 'blank ID' || change === 'different contract')
        await editId(currentId);
      expect(screen.getByTestId('token-icon')).not.toHaveClass('opacity-50');
      expect(button()).toBeEnabled();
      await act(async () => fireEvent.click(button()));
      expect(assets()).toHaveLength(1);
      expect(assets()[0]).toMatchObject({
        tokenId: currentId,
        rawBalance: '2',
        chainId: 1,
        id: `${CONTRACT}-1-${currentId}`,
      });
      expect(mockAlert.success).toHaveBeenCalledTimes(1);
    }
    expect(mockStore.getState().vault.activeAccount).toEqual({
      type: KeyringAccountType.HDAccount,
      id: 0,
    });
  }
);

it('retains an ordinary owned ERC1155 import through the same delayed logo read', async () => {
  const previous = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, args) =>
    path[1] === 'getUserOwnedTokens'
      ? market.getUserOwnedTokens(args[0])
      : previous(path, args)
  );
  globalThis.fetch = jest.fn(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'explorer.synthetic.invalid') {
      expect(url.searchParams.get('action')).toBe('tokenlist');
      expect(url.searchParams.get('address')).toBe(OWNER);
      return {
        ok: true,
        json: async () => ({
          status: '1',
          result: [
            {
              contractAddress: CONTRACT,
              symbol: 'SAMPLE',
              name: 'Sample NFT',
              type: 'ERC-1155',
              id: '1',
              decimals: '0',
              balance: '2',
            },
          ],
        }),
      } as Response;
    }
    expect(url.hostname).toBe('api.coingecko.com');
    return logoGate.promise;
  }) as typeof fetch;
  mount('owned');
  await act(async () => jest.advanceTimersByTimeAsync(0));
  expect(button()).toBeEnabled();
  await act(async () => fireEvent.click(button()));
  expect(assets()).toHaveLength(0);
  await finishLogo();
  expect(assets()).toHaveLength(1);
  expect(assets()[0]).toMatchObject({
    tokenId: '1',
    rawBalance: '2',
    chainId: 1,
    id: `${CONTRACT}-1-1`,
  });
  expect(mockAlert.success).toHaveBeenCalledTimes(1);
});

it('does not let a retired account import clear the current operation indicator', async () => {
  mount();
  fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
    target: { value: CONTRACT },
  });
  await act(async () => jest.advanceTimersByTimeAsync(500));
  await editId('1');
  await act(async () => fireEvent.click(button()));
  expect(screen.getByTestId('token-icon')).toHaveClass('opacity-50');

  const nextContract = `0x${'44'.repeat(20)}`;
  const nextLogo = deferred();
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => '{"error":"No market data"}',
    } as Response)
    .mockImplementation(() => nextLogo.promise);
  await act(async () => {
    mockStore.dispatch(
      createAccount({
        accountType: KeyringAccountType.HDAccount,
        account: {
          ...mockStore.getState().vault.accounts.HDAccount[0],
          id: 1,
          address: `0x${'22'.repeat(20)}`,
        },
      })
    );
    mockStore.dispatch(
      setActiveAccount({ type: KeyringAccountType.HDAccount, id: 1 })
    );
  });
  expect(screen.getByLabelText('settings.contractAddress')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
    target: { value: nextContract },
  });
  await act(async () => jest.advanceTimersByTimeAsync(500));
  await editId('2');
  await act(async () => fireEvent.click(button()));
  expect(screen.getByTestId('token-icon')).toHaveClass('opacity-50');
  await finishLogo();
  expect(assets()).toHaveLength(0);
  expect(
    mockStore.getState().vault.accountAssets.HDAccount[1].ethereum
  ).toHaveLength(0);
  expect(screen.getByTestId('token-icon')).toHaveClass('opacity-50');
  expect(button()).toBeDisabled();
  expect(mockAlert.success).not.toHaveBeenCalled();

  await act(async () =>
    nextLogo.resolve({
      ok: true,
      json: async () => ({
        id: 'current-nft',
        symbol: 'sample',
        image: { large: 'https://image.synthetic.invalid/current.png' },
      }),
    } as Response)
  );
  expect(assets()).toHaveLength(0);
  expect(
    mockStore.getState().vault.accountAssets.HDAccount[1].ethereum
  ).toEqual([
    expect.objectContaining({
      tokenId: '2',
      rawBalance: '2',
      chainId: 1,
      id: `${nextContract}-1-2`,
    }),
  ]);
  expect(screen.getByTestId('token-icon')).not.toHaveClass('opacity-50');
  expect(mockAlert.success).toHaveBeenCalledTimes(1);
});
