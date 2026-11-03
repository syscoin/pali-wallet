/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import en from 'assets/locales/en.json';
import SysAccountController from 'scripts/Background/controllers/account/syscoin';
import SysAssetsController from 'scripts/Background/controllers/assets/syscoin';
import vault, { createAccount, setNetworkChange } from 'state/vault';
import vaultGlobal, { setActiveSlip44 } from 'state/vaultGlobal';
import { initialActiveHdAccountState, KeyringAccountType } from 'types/network';
import { ITokenSysProps } from 'types/tokens';
import { getSyscoinUTXOTestnetNetwork } from 'utils/defaultNetworks';

import { AddToken } from './AddToken';

let mockStore: any;
let mockRows: any[];
let mockAssets: ReturnType<typeof SysAssetsController>;
const mockRead = jest.fn();
const mockMetadata = jest.fn();
const mockSave = jest.fn();
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
// Only public metadata/account I/O is replaced. All three actual asset
// balance producers and the ordinary AddToken/list components remain real.
jest.mock('@sidhujag/sysweb3-utils', () => ({
  getAsset: (...args: any[]) => mockMetadata(...args),
  cleanTokenSymbol: (value: string) => value,
}));
jest.mock(
  'scripts/Background/controllers/utils/fetchBackendAccountWrapper',
  () => ({
    fetchBackendAccountCached: (...args: any[]) => mockRead(...args),
  })
);
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { symbol?: string; token?: string }) => {
      if (key === 'tokens.importNamedToken')
        return `Import ${values?.symbol} token`;
      if (key === 'tokens.hasBeenAddedToYourWallet')
        return jest
          .requireActual('assets/locales/en.json')
          .tokens.hasBeenAddedToYourWallet.replace(
            '{{token}}',
            values?.token || ''
          );
      return key;
    },
  }),
}));
jest.mock('components/Icon/Icon', () => ({
  TbFileImport: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
  FiDownload: () => null,
  RiShareForward2Line: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  ...jest.requireActual('utils/navigationState'),
}));
const GUID = '765432';
const NETWORK = {
  ...getSyscoinUTXOTestnetNetwork(),
  url: 'https://blockbook.synthetic.invalid/',
};
const PUBLIC_ACCOUNT = {
  ...initialActiveHdAccountState,
  id: 0,
  label: 'Disposable public account',
  address: 'tsys1qmk2wr58dse5esyw8xcrsp7k5r77zj2xzvhqhkl',
  xpub: 'tpubDF93avGi4A5M9SVXQ45xy1hJ5j7dEBkA4M9jTwt74wurbFoCfRSHoDshkoLaUQmobjYGSakehWisjK6CXHeB3fXwtCtPmGnrKnvEU6u8NwV',
};
const metadata = {
  assetGuid: GUID,
  symbol: 'PENDINGSPT',
  decimals: 2,
  assetType: 'ERC20',
  maxSupply: '9223372036854775807',
  totalSupply: '9223372036854775807',
  metaData: '',
};
const token = (balance: string, unconfirmedBalance?: string) => ({
  assetGuid: GUID,
  symbol: metadata.symbol,
  decimals: metadata.decimals,
  balance,
  ...(unconfirmedBalance !== undefined ? { unconfirmedBalance } : {}),
  totalReceived: balance,
  totalSent: '0',
  transfers: 1,
  type: 'SPTAllocated',
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockStore = configureStore({ reducer: { vault, vaultGlobal } });
  mockStore.dispatch(setActiveSlip44(1));
  mockStore.dispatch(setNetworkChange({ activeNetwork: NETWORK }));
  mockStore.dispatch(
    createAccount({
      accountType: KeyringAccountType.HDAccount,
      account: PUBLIC_ACCOUNT,
    })
  );
  mockRead.mockImplementation(async (url, identifier, options, isXpub) => {
    expect(url).toBe(NETWORK.url);
    expect(identifier).toBe(PUBLIC_ACCOUNT.xpub);
    expect(isXpub).toBe(true);
    expect([
      'details=tokenBalances&tokens=nonzero',
      'details=tokenBalances&tokens=used',
    ]).toContain(options);
    return { tokensAsset: mockRows };
  });
  mockMetadata.mockImplementation(async (url, guid) => {
    expect(url).toBe(NETWORK.url);
    expect(guid).toBe(GUID);
    return metadata;
  });
  mockAssets = SysAssetsController();
  mockSave.mockImplementation(async (saved: ITokenSysProps) => {
    // The durable storage boundary is substituted. The actual addition
    // producer and Redux publication still demonstrate what gets persisted;
    // this is not a claim to test MainController authentication/durability.
    const account = SysAccountController(() => {
      throw new Error('No SDK keyring/signer is available');
    });
    const action = await account.prepareTokenAddition(saved);
    mockStore.dispatch(action());
  });
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'getUserOwnedTokens')
      return mockAssets.getUserOwnedTokens(PUBLIC_ACCOUNT.xpub);
    if (method === 'validateSPTOnly')
      return mockAssets.validateSPTOnly(args[0], args[1], NETWORK.url);
    if (method === 'saveTokenInfo') return mockSave(args[0]);
    throw new Error(`Unexpected controller method ${method}`);
  });
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

test.each([
  {
    name: 'healthy confirmed-only holding',
    rows: [token('10000', '0')],
    expected: '100.0',
    label: '100',
  },
  {
    name: 'healthy absent optional delta across two public rows',
    rows: [token('1250'), token('500')],
    expected: '17.5',
    label: '17.5',
  },
  {
    name: 'healthy not-yet-owned valid asset',
    rows: [],
    expected: '0',
    label: '0',
  },
  {
    name: 'pending incoming transfer',
    rows: [token('10000', '2500')],
    expected: '125.0',
    label: '125',
  },
  {
    name: 'pending outgoing transfer',
    rows: [token('10000', '-7500')],
    expected: '25.0',
    label: '25',
  },
  {
    name: 'signed deltas remain exact across matching rows above Number precision',
    rows: [token('9007199254740991', '-991'), token('25', '2')],
    expected: '90071992547400.27',
    label: '9.01e13',
  },
])(
  'manual import balance matches the same account snapshot: $name',
  async ({ rows, expected, label }) => {
    mockRows = rows;
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
    fireEvent.change(screen.getByLabelText('tokens.assetGuid'), {
      target: { value: GUID },
    });
    await act(async () => jest.advanceTimersByTimeAsync(500));
    const button = screen.getByRole('button', {
      name: 'Import PENDINGSPT token',
    });
    const preview = button
      .closest('li')!
      .querySelector('span.text-brand-white.font-medium')!.textContent;
    await act(async () => fireEvent.click(button));
    expect(mockSave).toHaveBeenCalledTimes(1);
    const saved = mockSave.mock.calls[0][0];
    const stored =
      mockStore.getState().vault.accountAssets.HDAccount[0].syscoin[0];
    const owned = await mockAssets.getUserOwnedTokens(PUBLIC_ACCOUNT.xpub);
    const refreshed = await mockAssets.getSysAssetsByXpub(
      PUBLIC_ACCOUNT.xpub,
      NETWORK.url,
      NETWORK.chainId,
      [stored]
    );
    await waitFor(() => {
      const success = screen.getByText(
        en.tokens.hasBeenAddedToYourWallet.replace('{{token}}', 'PENDINGSPT'),
        { exact: true }
      );
      expect(success).toBeVisible();
      expect(success.closest('[role="status"]')).not.toBeNull();
    });
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(
      mockEmitter.mock.calls.every(([[, method]]) =>
        ['getUserOwnedTokens', 'validateSPTOnly', 'saveTokenInfo'].includes(
          method
        )
      )
    ).toBe(true);
    expect({
      preview,
      manualSaved: saved.balance,
      stored: stored.balance,
      owned: owned[0]?.balance ?? '0',
      afterNormalRefresh: refreshed[0].balance,
    }).toEqual({
      preview: label,
      manualSaved: expected,
      stored: expected,
      owned: expected,
      afterNormalRefresh: expected,
    });
  }
);
