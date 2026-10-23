/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Provider } from 'react-redux';

import type SysAccountController from 'scripts/Background/controllers/account/syscoin';
import vault, {
  createAccount,
  setAccountAssets,
  setAccountPropertyByIdAndType,
  setNetworkChange,
} from 'state/vault';
import vaultGlobal, { setActiveSlip44 } from 'state/vaultGlobal';
import { initialActiveHdAccountState, KeyringAccountType } from 'types/network';
import type { ITokenSysProps } from 'types/tokens';
import { getSyscoinUTXOTestnetNetwork } from 'utils/defaultNetworks';
import { getWalletNavigationScope } from 'utils/navigationState';

import { SendSys } from './SendSys';

let mockStore: any;
let mockLocation: any;
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockSave = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: mockAlert, navigate: mockNavigate }),
}));
jest.mock('components/Icon/Icon', () => ({
  PaliWhiteSmallIconSvg: () => null,
  ArrowDownSvg: () => null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Fee: () => null,
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('jdenticon', () => ({ toSvg: () => '<svg></svg>' }));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  saveNavigationState: (...args: any[]) => mockSave(...args),
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  ...jest.requireActual('utils/navigationState'),
  ...jest.requireActual('utils/removeScientificNotation'),
  isNFT: jest.requireActual('utils/isNft').isNFT,
  getAssetBalance: jest.requireActual('utils/transactions').getAssetBalance,
  MINIMUM_FEE: 0.00000001,
}));
jest.mock('utils/validations', () => ({
  isValidSYSAddress: () => Promise.resolve(true),
}));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));

const NETWORK = {
  ...getSyscoinUTXOTestnetNetwork(),
  url: 'https://blockbook.synthetic.invalid/',
};
const ACCOUNT = {
  ...initialActiveHdAccountState,
  id: 0,
  label: 'SPT availability fixture',
  address: 'tsys1qmk2wr58dse5esyw8xcrsp7k5r77zj2xzvhqhkl',
  xpub: 'tpubDF93avGi4A5M9SVXQ45xy1hJ5j7dEBkA4M9jTwt74wurbFoCfRSHoDshkoLaUQmobjYGSakehWisjK6CXHeB3fXwtCtPmGnrKnvEU6u8NwV',
};
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});
beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/app.html');
  mockLocation = { pathname: '/send/sys', state: null };
  mockSave.mockResolvedValue(undefined);
  mockStore = configureStore({ reducer: { vault, vaultGlobal } });
  mockStore.dispatch(setActiveSlip44(1));
  mockStore.dispatch(setNetworkChange({ activeNetwork: NETWORK }));
  mockStore.dispatch(
    createAccount({
      accountType: KeyringAccountType.HDAccount,
      account: ACCOUNT,
    })
  );
  mockStore.dispatch(
    setAccountPropertyByIdAndType({
      id: ACCOUNT.id,
      type: KeyringAccountType.HDAccount,
      property: 'balances',
      value: { syscoin: '1.25', ethereum: '0' },
    })
  );
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getRecommendedFee') return 0.00000001;
    if (method === 'refreshActiveAccountBalances') return undefined;
    if (method === 'getEstimateSysTransactionFee')
      return { fee: 0.00000001, psbt: 'synthetic-unsigned-psbt' };
    throw new Error(`Unexpected controller operation: ${method}`);
  });
});
afterEach(() => {
  cleanup();
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(
    mockEmitter.mock.calls.every(([[, method]]) =>
      [
        'getRecommendedFee',
        'refreshActiveAccountBalances',
        'getEstimateSysTransactionFee',
      ].includes(method)
    )
  ).toBe(true);
});

// Real account import/reducer records, SendSys, AntD validation, Headless UI
// selection and native keyboard events. Only the unsigned quote is inert.
const importAsset = async (balance?: unknown) => {
  const createController = jest.requireActual(
    'scripts/Background/controllers/account/syscoin'
  ).default as typeof SysAccountController;
  const account = createController(() => {
    throw new Error('No keyring/signing operation is allowed');
  });
  const token: ITokenSysProps = {
    assetGuid: '123',
    symbol: 'SPT',
    decimals: 2,
    ...(balance !== undefined ? { balance: balance as number | string } : {}),
  };
  const mutation = await account.prepareTokenAddition(token);
  mockStore.dispatch(mutation());
  return mockStore.getState().vault.accountAssets.HDAccount[0].syscoin[0];
};
const mount = async () => {
  const user = userEvent.setup();
  await act(async () =>
    render(
      <Provider store={mockStore}>
        <SendSys />
      </Provider>
    )
  );
  return user;
};
const amount = () =>
  screen.getByPlaceholderText('send.amount') as HTMLInputElement;
const max = () => screen.getByRole('button', { name: 'send.max' });
const next = () => screen.getByRole('button', { name: 'buttons.next' });
const estimates = () =>
  mockEmitter.mock.calls.filter(
    ([[, method]]) => method === 'getEstimateSysTransactionFee'
  );
const confirmations = () =>
  mockNavigate.mock.calls.filter(([route]) => route === '/send/confirm');
const selectAsset = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-haspopup') === 'menu')!
  );
  await user.click(
    screen.getByRole('menuitem', { name: 'SPT tokens.assetGuid: 123 SPT' })
  );
};
const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(
    screen.getByPlaceholderText('send.receiver'),
    'synthetic-recipient'
  );
  await user.type(amount(), '0.5');
};
const refreshBalance = async (balance: string | undefined) => {
  const current =
    mockStore.getState().vault.accountAssets.HDAccount[0].syscoin[0];
  await act(async () => {
    mockStore.dispatch(
      setAccountAssets({
        accountId: ACCOUNT.id,
        accountType: KeyringAccountType.HDAccount,
        property: 'syscoin',
        value: [{ ...current, balance }],
      })
    );
  });
};
const saved = () => mockSave.mock.calls.at(-1)?.[2];

it.each([undefined, null, '', ' ', NaN, Infinity, 'broken'])(
  'keeps an unknown balance %p selectable without replacing a manual amount with zero',
  async (balance) => {
    await importAsset(balance);
    const user = await mount();
    await fill(user);
    await selectAsset(user);
    expect(
      screen.getByText('components.yourBalance').parentElement
    ).toHaveTextContent('settings.unavailable');
    expect(max()).toBeDisabled();
    await user.click(max());
    expect(amount()).toHaveValue(0.5);
    await user.click(next());
    await waitFor(() =>
      expect(
        screen.getAllByText('settings.unavailable').length
      ).toBeGreaterThan(1)
    );
    await user.click(amount());
    await user.keyboard('{Enter}');
    expect(estimates()).toHaveLength(0);
    expect(confirmations()).toHaveLength(0);
    await waitFor(() =>
      expect(saved()).toMatchObject({
        isMaxSend: false,
        selectedAsset: { assetGuid: '123' },
        formValues: { amount: '0.5' },
      })
    );
  }
);

it('rechecks the retained manual amount when missing becomes known zero and then positive', async () => {
  await importAsset();
  const user = await mount();
  await fill(user);
  await selectAsset(user);
  await user.click(next());
  await waitFor(() =>
    expect(screen.getAllByText('settings.unavailable').length).toBeGreaterThan(
      1
    )
  );
  await refreshBalance('0');
  await waitFor(() =>
    expect(screen.queryByText('settings.unavailable')).toBeNull()
  );
  expect(max()).toBeEnabled();
  expect(amount()).toHaveValue(0.5);
  expect(screen.getByText('send.insufficientFunds')).toBeVisible();
  expect(estimates()).toHaveLength(0);
  await refreshBalance('2.5');
  await waitFor(() =>
    expect(screen.queryByText('send.insufficientFunds')).toBeNull()
  );
  expect(amount()).toHaveValue(0.5);
  await user.click(next());
  await waitFor(() => expect(confirmations()).toHaveLength(1));
  expect(estimates()).toHaveLength(1);
  expect(estimates()[0][1][0]).toMatchObject({
    amount: '0.00000050',
    token: { guid: '123', symbol: 'SPT' },
  });
  expect(confirmations()[0][1].state.tx.amount).toBe('0.5');
});

it('does not restore asset MAX from an unknown draft or overwrite its amount when balance arrives', async () => {
  const token = await importAsset();
  mockLocation.state = {
    walletScope: getWalletNavigationScope(),
    selectedAsset: token,
    isMaxSend: true,
    formValues: { receiver: 'synthetic-recipient', amount: '0.5' },
  };
  await mount();
  expect(amount()).toHaveValue(0.5);
  expect(max()).toBeDisabled();
  await waitFor(() => expect(saved()?.isMaxSend).toBe(false));
  await refreshBalance('2.5');
  await waitFor(() => expect(max()).toBeEnabled());
  expect(amount()).toHaveValue(0.5);
  expect(saved()?.isMaxSend).toBe(false);
});

it('keeps native MAX and known token MAX behavior, then refuses a lost token balance', async () => {
  await importAsset('2.5');
  const user = await mount();
  expect(max()).toBeEnabled();
  await user.click(max());
  expect(amount()).toHaveValue(1.25);
  await selectAsset(user);
  await user.click(max());
  expect(amount()).toHaveValue(2.5);
  await refreshBalance(undefined);
  expect(max()).toBeDisabled();
  expect(amount()).toHaveValue(2.5);
  await waitFor(() => expect(saved()?.isMaxSend).toBe(false));
  expect(estimates()).toHaveLength(0);
});
