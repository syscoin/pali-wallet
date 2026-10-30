/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { AddToken } from './AddToken';

const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
let mockState: any;
let mockRows: any[];
let mockFirstSave: Promise<void>;
let mockSaveCount = 0;

// Only the public discovery reply and durable-save transport are substituted.
// AddToken, both import parents, their admission refs, the shared list, native
// IconButton, and navigation-context producers remain actual production code.
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { symbol?: string; token?: string }) => {
      if (key === 'tokens.importNamedToken')
        return `Import ${values?.symbol} token`;
      if (key === 'tokens.viewTokenDetails')
        return `View ${values?.symbol} details`;
      if (key === 'tokens.hasBeenAddedToYourWallet')
        return `${values?.token} has been added to your wallet`;
      return key;
    },
    i18n: { language: 'en' },
  }),
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
jest.mock('components/Icon/Icon', () => ({
  TbFileImport: () => null,
  FiDownload: () => null,
  RiShareForward2Line: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  ...jest.requireActual('utils/navigationState'),
}));

const CONTRACTS = [`0x${'33'.repeat(20)}`, `0x${'44'.repeat(20)}`];
const GUIDS = ['123457', '765432'];
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const saves = () =>
  mockEmitter.mock.calls.filter(([[, method]]) => method === 'saveTokenInfo');
const importButton = (symbol: string) =>
  screen.getByRole('button', { name: `Import ${symbol} token` });
const detailsButton = (symbol: string) =>
  screen.getByRole('button', { name: `View ${symbol} details` });
const Details = () => {
  const location = useLocation();
  return (
    <output data-testid="details-state">
      {JSON.stringify(location.state)}
    </output>
  );
};

const start = async (utxo: boolean) => {
  const family = utxo ? 'SPT' : 'EVM';
  mockRows = [0, 1].map((index) => ({
    symbol: `${index === 0 ? 'FIRST' : 'SECOND'}${family}`,
    name: `${index === 0 ? 'First' : 'Second'} disposable ${family} token`,
    balance: '3',
    decimals: utxo ? 8 : 18,
    ...(utxo
      ? { assetGuid: GUIDS[index], type: 'SPTAllocated' }
      : {
          id: `${CONTRACTS[index]}-1`,
          contractAddress: CONTRACTS[index],
          tokenStandard: 'ERC-20',
          isNft: false,
          image: 'https://assets.synthetic.invalid/disposable-token.png',
        }),
  }));
  mockState = {
    vault: {
      isBitcoinBased: utxo,
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: {
            address: `0x${'11'.repeat(20)}`,
            xpub: 'disposable-public-xpub',
          },
        },
      },
      activeNetwork: {
        kind: utxo ? 'syscoin' : 'ethereum',
        chainId: utxo ? 5700 : 1,
        slip44: utxo ? 1 : 60,
        url: 'https://rpc.synthetic.invalid',
        apiUrl: 'https://explorer.synthetic.invalid/api',
      },
      accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [] } } },
    },
    vaultGlobal: { activeSlip44: utxo ? 1 : 60 },
  };
  render(
    <MemoryRouter
      initialEntries={['/tokens/add?tab=owned']}
      future={{
        ['v7_startTransition']: true,
        ['v7_relativeSplatPath']: true,
      }}
    >
      <Routes>
        <Route path="/tokens/add" element={<AddToken />} />
        <Route path="/home/details" element={<Details />} />
      </Routes>
    </MemoryRouter>
  );
  const [first, second] = mockRows;
  await screen.findByRole('button', { name: `Import ${second.symbol} token` });
  expect(importButton(first.symbol)).toBeEnabled();
  expect(importButton(second.symbol)).toBeEnabled();
  expect(mockEmitter.mock.calls[0]).toEqual([
    ['wallet', 'getUserOwnedTokens'],
    [mockState.vault.accounts.HDAccount[0].address],
  ]);
  return { first, second, user: userEvent.setup() };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveCount = 0;
  mockEmitter.mockImplementation(([, method]) => {
    if (method === 'getUserOwnedTokens') return Promise.resolve(mockRows);
    if (method === 'saveTokenInfo') {
      mockSaveCount += 1;
      return mockSaveCount === 1 ? mockFirstSave : Promise.resolve();
    }
    throw new Error(`Unexpected controller method: ${method}`);
  });
});
afterEach(cleanup);

describe.each([false, true])(
  'ordinary owned-token import progress (UTXO %s)',
  (utxo) => {
    it('disables another row while the parent serializes a pending import', async () => {
      const held = deferred();
      mockFirstSave = held.promise;
      const { first, second, user } = await start(utxo);
      try {
        await user.click(importButton(first.symbol));
        await waitFor(() => expect(saves()).toHaveLength(1));
        expect(importButton(first.symbol)).toBeDisabled();
        // Challenge the actual parent's admission, not a stubbed onImport. On
        // the old UI this enabled click is swallowed before its error handler.
        await user.click(importButton(second.symbol));
        await act(async () => undefined);
        expect(saves()).toHaveLength(1);
        expect(mockAlert.error).not.toHaveBeenCalled();
        expect(mockAlert.success).not.toHaveBeenCalled();
        expect(importButton(second.symbol)).toBeDisabled();
        expect(importButton(second.symbol)).toHaveClass('cursor-not-allowed');
        expect(importButton(second.symbol)).not.toHaveClass(
          'hover:bg-brand-royalblue/20'
        );
        expect(
          importButton(first.symbol)
            .closest('li')!
            .querySelectorAll('.animate-spin')
        ).toHaveLength(1);
        expect(
          importButton(second.symbol)
            .closest('li')!
            .querySelectorAll('.animate-spin')
        ).toHaveLength(0);
      } finally {
        await act(async () => held.resolve());
      }
    });

    it('completes the first save and accepts the second row after pending work ends', async () => {
      const held = deferred();
      mockFirstSave = held.promise;
      const { first, second, user } = await start(utxo);
      await user.click(importButton(first.symbol));
      await waitFor(() => expect(saves()).toHaveLength(1));
      await act(async () => held.resolve());
      expect(importButton(first.symbol)).toBeDisabled();
      expect(importButton(second.symbol)).toBeEnabled();
      if (utxo) {
        expect(
          screen
            .getByText(`${first.symbol} has been added to your wallet`)
            .closest('[role="status"]')
        ).toBeInTheDocument();
        expect(mockAlert.success).not.toHaveBeenCalled();
      } else {
        expect(mockAlert.success).toHaveBeenCalledWith(
          `${first.symbol} has been added to your wallet`
        );
      }
      await user.click(importButton(second.symbol));
      await waitFor(() => expect(saves()).toHaveLength(2));
      const identifiers = saves().map(([, [token]]) =>
        utxo ? token.assetGuid : token.contractAddress
      );
      expect(identifiers).toEqual(utxo ? GUIDS : CONTRACTS);
      expect(importButton(second.symbol)).toBeDisabled();
      if (utxo) {
        expect(
          screen.getByText(`${second.symbol} has been added to your wallet`)
        ).toBeVisible();
        expect(mockAlert.success).not.toHaveBeenCalled();
      } else {
        expect(mockAlert.success).toHaveBeenCalledTimes(2);
      }
      expect(mockAlert.error).not.toHaveBeenCalled();
    });

    it('keeps the other token details keyboard-accessible during a pending save', async () => {
      const held = deferred();
      mockFirstSave = held.promise;
      const { first, second, user } = await start(utxo);
      try {
        await user.click(importButton(first.symbol));
        await waitFor(() => expect(saves()).toHaveLength(1));
        const details = detailsButton(second.symbol);
        expect(details).toBeEnabled();
        for (
          let tabs = 0;
          tabs < 8 && document.activeElement !== details;
          tabs += 1
        )
          await user.tab();
        expect(details).toHaveFocus();
        await user.keyboard('{Enter}');
        const state = JSON.parse(
          (await screen.findByTestId('details-state')).textContent!
        );
        expect(state).toEqual(
          expect.objectContaining({
            symbol: second.symbol,
            isImportPreview: true,
            ...(utxo
              ? { assetGuid: GUIDS[1] }
              : { contractAddress: CONTRACTS[1] }),
            returnContext: expect.objectContaining({
              returnRoute: '/tokens/add?tab=owned',
            }),
          })
        );
        expect(saves()).toHaveLength(1);
        expect(mockAlert.error).not.toHaveBeenCalled();
      } finally {
        await act(async () => held.resolve());
      }
    });
  }
);
