/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { DetailsView } from 'pages/Home/Panel/components/Details';
import { verifyERC1155OwnershipHelper } from 'scripts/Background/controllers/assets/nft-utils';
import vaultReducer from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { Interface } from 'utils/ethersV6Compat';

import { AddToken } from './AddToken';

let mockStore: any;
let mockRawBalance: string;
let mockMode: 'custom' | 'owned';
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: mockAlert,
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: mockAlert,
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === 'nftDetails.owned'
        ? jest.requireActual('../../assets/locales/en.json').nftDetails.owned
        : key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  FiDownload: () => null,
  RiShareForward2Line: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
  FiExternalLink: () => null,
  RiFileCopyLine: () => null,
  ExternalLinkSvg: () => null,
  Icon: () => null,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  Button: jest.requireActual('components/Button/Button').Button,
  Icon: () => null,
}));
jest.mock('utils/index', () => ({ ...jest.requireActual('utils/format') }));
jest.mock('pages/Home/Panel/components/TransactionDetails', () => ({
  TransactionDetails: () => null,
}));

const CONTRACT = `0x${'33'.repeat(20)}`;
const OWNER = `0x${'11'.repeat(20)}`;
const abi = new Interface([
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
]);
const runner = {
  call: async (transaction: { data: string }) => {
    const decoded = abi.parseTransaction(transaction)!;
    if (decoded.name === 'balanceOf')
      return abi.encodeFunctionResult('balanceOf', [
        decoded.args[1].toString() === '7' ? mockRawBalance : '0',
      ]);
    return abi.encodeFunctionResult('balanceOfBatch', [
      Array.from(decoded.args[1], (id: any) =>
        id.toString() === '7' ? mockRawBalance : '0'
      ),
    ]);
  },
};
const metadata = {
  id: `${CONTRACT}-1`,
  contractAddress: CONTRACT,
  chainId: 1,
  symbol: 'SAMPLE',
  name: 'Sample NFT',
  decimals: 0,
  balance: 0,
  tokenStandard: 'ERC-1155',
  isNft: true,
};
const mount = () =>
  render(
    <Provider store={mockStore}>
      <MemoryRouter
        initialEntries={[`/tokens/add?tab=${mockMode}`]}
        future={{
          ['v7_startTransition']: true,
          ['v7_relativeSplatPath']: true,
        }}
      >
        <Routes>
          <Route path="/tokens/add" element={<AddToken />} />
          <Route path="/home/details" element={<DetailsView />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(crypto, 'getRandomValues').mockImplementation((array: any) => {
    array.fill(0);
    array[31] = 42;
    return array;
  });
  const initial = vaultReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: {
      vault: vaultReducer,
      vaultGlobal: vaultGlobalReducer,
      price: (state = { fiat: { asset: 'usd' } }) => state,
    },
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
  mockEmitter.mockImplementation(async ([, method]: string[], args: any[]) => {
    if (method === 'getUserOwnedTokens')
      return mockMode === 'owned'
        ? [
            {
              ...metadata,
              chainId: undefined,
              id: `${CONTRACT}-1-7`,
              tokenId: '7',
              balance: Number(mockRawBalance),
              rawBalance: mockRawBalance,
            },
          ]
        : [];
    if (method === 'getTokenDetailsWithMarketData') return null;
    if (method === 'validateNftContract') return metadata;
    if (method === 'verifyERC1155Ownership')
      return verifyERC1155OwnershipHelper(
        args[0],
        args[1],
        args[2],
        runner as any
      );
    if (method === 'getOnlyMarketData') return null;
    throw new Error(`Unexpected method ${method}`);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each([
  { mode: 'custom', raw: '42', expected: '42 NFTs' },
  { mode: 'custom', raw: '0', expected: '0 NFTs' },
  { mode: 'custom', raw: '1', expected: '1 NFT' },
  { mode: 'custom', raw: '9007199254740992', expected: '9.01e15 NFTs' },
  { mode: 'custom', raw: '9007199254740993', expected: '9.01e15 NFTs' },
  { mode: 'owned', raw: '9007199254740992', expected: '9.01e15 NFTs' },
  { mode: 'owned', raw: '9007199254740993', expected: '9.01e15 NFTs' },
] as const)(
  'retains the verified $mode ERC1155 quantity $raw in normal View Details',
  async ({ mode, raw, expected }) => {
    mockMode = mode;
    mockRawBalance = raw;
    mount();
    if (mode === 'custom') {
      fireEvent.change(screen.getByLabelText('settings.contractAddress'), {
        target: { value: CONTRACT },
      });
      await act(async () => jest.advanceTimersByTimeAsync(500));
      fireEvent.change(screen.getByLabelText('send.tokenId'), {
        target: { value: '7' },
      });
    }
    await act(async () => jest.advanceTimersByTimeAsync(0));
    const details = screen.getByRole('button', {
      name: 'tokens.viewTokenDetails',
    });
    fireEvent.click(details);
    await act(async () => jest.advanceTimersByTimeAsync(0));
    expect(screen.getByText('Owned')).toBeVisible();
    const amount = screen.getByText(expected);
    expect(amount).toBeVisible();
    if (BigInt(raw) > BigInt(Number.MAX_SAFE_INTEGER))
      expect(amount).toHaveAttribute('title', raw);
    expect(
      mockEmitter.mock.calls.some(([[, method]]) => method === 'saveTokenInfo')
    ).toBe(false);
  }
);
