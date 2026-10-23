/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import EvmAssetsController from 'scripts/Background/controllers/assets/evm';
import vaultReducer, {
  createAccount,
  setActiveAccount,
  setActiveNetwork,
} from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { Interface } from 'utils/ethersV6Compat';

import { AddToken } from './AddToken';

let mockStore: any;
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
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
        : values?.balance === undefined
        ? key
        : `${key}:${values.balance}`,
    i18n: { language: 'en' },
  }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
// Presentational glyphs preserve the real component's title/class props; the
// app, native fields, shared list and read/verification decisions remain real.
jest.mock('components/Icon/Icon', () => ({
  FiDownload: () => null,
  RiShareForward2Line: () => null,
  LoadingOutlined: (props: any) => <span {...props} />,
  CheckCircleOutlined: (props: any) => <span {...props} />,
  CloseCircleOutlined: (props: any) => <span {...props} />,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: jest.requireActual('components/IconButton').IconButton,
}));
jest.mock('utils/index', () => ({ ...jest.requireActual('utils/format') }));

const OWNER = `0x${'11'.repeat(20)}`;
const CONTRACT = `0x${'33'.repeat(20)}`;
const abi = new Interface([
  'function supportsInterface(bytes4) view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
]);
const originalFetch = globalThis.fetch;
let failOwnershipReads: boolean;
let rawQuantity: string;
let rpcCalls: string[];
let actualOwnershipResults: unknown[];
let unexpectedFetches: number;
let heldBatch: { promise: Promise<void>; resolve: () => void } | null;
const runner = {
  getCode: async () => '0x6000',
  call: async (transaction: { data: string; to?: string }) => {
    expect(transaction.to?.toLowerCase()).toBe(CONTRACT);
    const decoded = abi.parseTransaction(transaction)!;
    if (decoded.name === 'supportsInterface')
      return abi.encodeFunctionResult('supportsInterface', [
        decoded.args[0] === '0xd9b67a26',
      ]);
    if (decoded.name === 'name')
      return abi.encodeFunctionResult('name', ['Recovery collection']);
    if (decoded.name === 'symbol')
      return abi.encodeFunctionResult('symbol', ['RECOVER']);
    rpcCalls.push(decoded.name);
    if (failOwnershipReads)
      throw new Error('Synthetic public RPC read failure');
    const quantity = rawQuantity;
    if (decoded.name === 'balanceOf')
      return abi.encodeFunctionResult('balanceOf', [
        decoded.args[1].toString() === '42' ? '0' : rawQuantity,
      ]);
    expect(decoded.name).toBe('balanceOfBatch');
    if (heldBatch) {
      const read = heldBatch;
      heldBatch = null;
      await read.promise;
    }
    return abi.encodeFunctionResult('balanceOfBatch', [
      Array.from(decoded.args[1], () => quantity),
    ]);
  },
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(crypto, 'getRandomValues').mockImplementation((bytes: any) => {
    bytes.fill(0);
    bytes[31] = 42;
    return bytes;
  });
  failOwnershipReads = false;
  rawQuantity = '3';
  rpcCalls = [];
  actualOwnershipResults = [];
  heldBatch = null;
  unexpectedFetches = 0;
  globalThis.fetch = jest.fn(async () => {
    unexpectedFetches += 1;
    throw new Error('This proof requires no HTTP fetch');
  }) as typeof fetch;
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
          chainId: 31337,
          slip44: 60,
          url: 'https://rpc.synthetic.invalid',
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
  const controller = EvmAssetsController();
  // MainController's source-verified delegates append the current provider.
  // Execute the real asset controller, Contract and ownership helper here;
  // MainController itself is not executed by this bounded UI proof.
  mockEmitter.mockImplementation(async ([family, method], args) => {
    expect(family).toBe('wallet');
    if (
      ![
        'getTokenDetailsWithMarketData',
        'validateNftContract',
        'validateERC20Only',
        'verifyERC1155Ownership',
        'getOnlyMarketData',
      ].includes(method)
    )
      throw new Error(`Unexpected controller action: ${method}`);
    const invoke = controller[method as keyof typeof controller] as any;
    const result = await invoke(
      ...args,
      ...(method === 'getOnlyMarketData' ? [] : [runner])
    );
    if (method === 'verifyERC1155Ownership')
      actualOwnershipResults.push(result);
    return result;
  });
});

afterEach(() => {
  cleanup();
  expect(unexpectedFetches).toBe(0);
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'saveTokenInfo')
  ).toHaveLength(0);
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (originalFetch) globalThis.fetch = originalFetch;
  else Reflect.deleteProperty(globalThis, 'fetch');
});

const mount = async () => {
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
  expect(screen.getByLabelText('send.tokenId')).toBeVisible();
};
const edit = async (id: string) => {
  fireEvent.change(screen.getByLabelText('send.tokenId'), {
    target: { value: id },
  });
  await act(async () => jest.advanceTimersByTimeAsync(0));
};
const importButton = () =>
  screen.queryByRole('button', { name: 'Import RECOVER token' });
const ownershipCalls = () =>
  mockEmitter.mock.calls.filter(
    ([[, method]]) => method === 'verifyERC1155Ownership'
  );
const holdBatch = () => {
  let resolve!: () => void;
  heldBatch = {
    promise: new Promise<void>((finish) => {
      resolve = finish;
    }),
    resolve: () => resolve(),
  };
  return heldBatch;
};
const failId = async () => {
  await mount();
  failOwnershipReads = true;
  await edit('7');
  expect(importButton()).toBeNull();
};
const retry = () => screen.getByRole('button', { name: 'receive.retry' });

it('retains a healthy positive verified quantity through the actual read pipeline', async () => {
  await mount();
  await edit('7');
  expect(actualOwnershipResults).toEqual([
    [{ tokenId: '7', balance: 3, rawBalance: '3', verified: true }],
  ]);
  expect(importButton()).toBeEnabled();
  expect(screen.getByTitle('tokens.balanceForTokenId:3')).toBeVisible();
});

it('retains healthy verified zero as an importable watch quantity', async () => {
  rawQuantity = '0';
  await mount();
  await edit('0');
  expect(actualOwnershipResults).toEqual([
    [{ tokenId: '0', balance: 0, rawBalance: '0', verified: true }],
  ]);
  expect(importButton()).toBeEnabled();
  expect(
    screen.getByTitle('tokens.balanceForTokenId:0 tokens.verifyTokenExists')
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
});

it('keeps genuinely malformed uint256 input invalid and unavailable for import', async () => {
  await mount();
  await edit('not-a-uint256');
  expect(importButton()).toBeNull();
  expect(screen.getByTitle('send.invalidTokenId')).toBeVisible();
  expect(rpcCalls).toEqual([]);
  expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
});

it('does not call a valid ID invalid after actual batch and individual read failure', async () => {
  await mount();
  failOwnershipReads = true;
  await edit('7');
  expect(actualOwnershipResults).toEqual([
    [{ tokenId: '7', balance: 0, verified: false }],
  ]);
  expect(rpcCalls).toEqual(['balanceOf', 'balanceOfBatch', 'balanceOf']);
  expect(importButton()).toBeNull();
  expect(screen.queryByTitle('send.invalidTokenId')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('send.unableToLoad');
});

it('offers visible same-ID recovery after an unavailable ownership read', async () => {
  await mount();
  failOwnershipReads = true;
  await edit('7');
  expect(actualOwnershipResults).toEqual([
    [{ tokenId: '7', balance: 0, verified: false }],
  ]);
  expect(importButton()).toBeNull();
  expect(screen.getByRole('button', { name: 'receive.retry' })).toBeVisible();
});

it('retries the unchanged valid ID through the actual helper and restores exact quantity', async () => {
  await failId();
  failOwnershipReads = false;
  rawQuantity = '900719925474099312345';
  await act(async () => fireEvent.click(retry()));
  expect(ownershipCalls()).toHaveLength(2);
  expect(ownershipCalls()[1][1][2]).toEqual(['7']);
  expect(actualOwnershipResults[1]).toEqual([
    {
      tokenId: '7',
      balance: Number.MAX_SAFE_INTEGER,
      rawBalance: rawQuantity,
      verified: true,
    },
  ]);
  expect(screen.getByLabelText('send.tokenId')).toHaveValue('7');
  expect(
    screen.getByTitle(`tokens.balanceForTokenId:${rawQuantity}`)
  ).toBeVisible();
  expect(importButton()).toBeEnabled();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
});

it('coalesces repeated Retry activation while its actual public read is held', async () => {
  await failId();
  failOwnershipReads = false;
  const read = holdBatch();
  const button = retry();
  await act(async () => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(ownershipCalls()).toHaveLength(2);
  expect(importButton()).toBeNull();
  expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => read.resolve());
  expect(importButton()).toBeEnabled();
});

it('keeps a second failed attempt unavailable, without automatic retry or an import', async () => {
  await failId();
  await act(async () => fireEvent.click(retry()));
  expect(ownershipCalls()).toHaveLength(2);
  expect(screen.getByRole('alert')).toHaveTextContent('send.unableToLoad');
  expect(screen.queryByTitle('send.invalidTokenId')).toBeNull();
  expect(importButton()).toBeNull();
  await act(async () => jest.advanceTimersByTimeAsync(10000));
  expect(ownershipCalls()).toHaveLength(2);
});

it('retires a held Retry read after the user edits the ID', async () => {
  await failId();
  failOwnershipReads = false;
  rawQuantity = '99';
  const read = holdBatch();
  await act(async () => fireEvent.click(retry()));
  rawQuantity = '5';
  await edit('8');
  expect(screen.getByTitle('tokens.balanceForTokenId:5')).toBeVisible();
  await act(async () => read.resolve());
  expect(screen.getByTitle('tokens.balanceForTokenId:5')).toBeVisible();
  expect(screen.queryByTitle('tokens.balanceForTokenId:99')).toBeNull();
});

it.each(['account', 'network'] as const)(
  'retires a held Retry after a real keyed parent %s change',
  async (change) => {
    await failId();
    failOwnershipReads = false;
    const read = holdBatch();
    await act(async () => fireEvent.click(retry()));
    await act(async () => {
      if (change === 'account') {
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
      } else {
        mockStore.dispatch(
          setActiveNetwork({
            ...mockStore.getState().vault.activeNetwork,
            chainId: 31338,
          })
        );
      }
    });
    expect(screen.getByLabelText('settings.contractAddress')).toHaveValue('');
    await act(async () => read.resolve());
    expect(importButton()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
  }
);

it('can recover today by an actual edit after the read transport recovers', async () => {
  await mount();
  failOwnershipReads = true;
  await edit('7');
  expect(importButton()).toBeNull();
  failOwnershipReads = false;
  rawQuantity = '5';
  await edit('8');
  expect(actualOwnershipResults).toHaveLength(2);
  expect(actualOwnershipResults[1]).toEqual([
    { tokenId: '8', balance: 5, rawBalance: '5', verified: true },
  ]);
  expect(importButton()).toBeEnabled();
});
