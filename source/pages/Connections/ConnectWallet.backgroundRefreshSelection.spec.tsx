/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import { useControllerStateSync } from 'hooks/useControllerStateSync';
import { isHotPathOnlyChange } from 'scripts/Background/handlers/handleStateChanges';
import store from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';

import { ConnectWallet } from './ConnectWallet';

const mockEmitter = jest.fn();
const mockCopy = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
let mockDapp: any;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => ({
    host: 'https://bridge.syscoin.org',
    chain: 'ethereum',
    chainId: 1,
    eventName: 'connect',
  }),
  useUtils: () => ({
    alert: mockAlert,
    useCopyClipboard: () => [null, mockCopy],
  }),
}));
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: () => null,
}));
jest.mock('components/AccountIdenticon', () => ({
  AccountIdenticon: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <span>Loading</span>,
}));
jest.mock('components/index', () => ({
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  Button: jest.requireActual('components/Button/Button').Button,
  Icon: ({ name }: any) => <span aria-hidden="true" data-icon={name} />,
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Dialog/Dialog', () => ({
  DialogPrimitive: () => null,
  CenterPanel: ({ children }: any) => children,
  DialogActions: ({ children }: any) => children,
  DialogBody: ({ children }: any) => children,
  DialogFooter: ({ children }: any) => children,
  DialogHeader: () => null,
  DialogActionButton: () => null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/TokenIcon', () => ({
  getAccountReviewTokens: () => [],
  TokenIconStack: () => null,
}));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));

const initial = store.getState();
const originalChrome = global.chrome;
const listeners = new Set<(message: any) => unknown>();
const network = {
  kind: INetworkType.Ethereum,
  chainId: 1,
  slip44: 60,
  label: 'Ethereum',
  currency: 'eth',
  url: 'https://rpc.synthetic.invalid',
};
const account = (id: number, label: string, digit: string) => ({
  id,
  label,
  address: `0x${digit.repeat(40)}`,
  balances: { ethereum: 1, syscoin: -1 },
});
const row = (label: string) =>
  screen
    .getByText(label, { selector: 'p' })
    .closest('[role="button"]') as HTMLElement;
const isSelected = (label: string) =>
  row(label).classList.contains('shadow-md');
const confirm = () => screen.getByRole('button', { name: 'buttons.confirm' });
const cancel = () => screen.getByRole('button', { name: 'buttons.cancel' });
const lookupCalls = () =>
  mockEmitter.mock.calls.filter(([methods]) => methods[1] === 'get');
const mutationCalls = () =>
  mockEmitter.mock.calls.filter(([methods]) => methods[1] !== 'get');
const snapshot = () => JSON.parse(JSON.stringify(store.getState()));
const App = () => {
  // Keep the real receiver and Redux rehydration path. Only presentation and
  // the controller transport boundary above are synthetic in this suite.
  useControllerStateSync(true);
  return <ConnectWallet />;
};

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  mockDapp = null;
  global.chrome = {
    ...originalChrome,
    runtime: {
      ...originalChrome.runtime,
      onMessage: {
        addListener: (listener: (message: any) => unknown) =>
          listeners.add(listener),
        removeListener: (listener: (message: any) => unknown) =>
          listeners.delete(listener),
      },
    },
  } as any;
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'get') return mockDapp;
    throw Error(`Unexpected mutation: ${method}`);
  });
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  store.dispatch(setActiveSlip44(60));
  store.dispatch(
    restoreVaultSnapshot({
      ...initial.vault,
      accounts: {
        ...initial.vault.accounts,
        HDAccount: {
          0: account(0, 'Alpha', '1'),
          1: account(1, 'Beta', '2'),
        },
      },
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: { ...network },
      isBitcoinBased: false,
    } as any)
  );
});

afterEach(() => {
  cleanup();
  expect(listeners.size).toBe(0);
  global.chrome = originalChrome;
  jest.restoreAllMocks();
});

async function chooseBeta(method: 'pointer' | 'keyboard' = 'pointer') {
  const user = userEvent.setup();
  render(
    <Provider store={store}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </Provider>
  );
  await screen.findByText('Beta', { selector: 'p' });
  expect(isSelected('Alpha')).toBe(true);
  if (method === 'pointer') {
    await user.click(row('Beta'));
  } else {
    screen
      .getByRole('searchbox', { name: 'connections.searchAccounts' })
      .focus();
    await user.tab();
    expect(row('Alpha')).toHaveFocus();
    // The copy-address control remains a separate native keyboard stop.
    await user.tab();
    await user.tab();
    expect(row('Beta')).toHaveFocus();
    await user.keyboard('{Enter}');
  }
  expect(isSelected('Beta')).toBe(true);
  expect(lookupCalls()).toHaveLength(1);
  expect(mutationCalls()).toEqual([]);
  return user;
}

async function deliver(message: any) {
  await act(async () => {
    expect(listeners.size).toBe(1);
    for (const listener of listeners) expect(listener(message)).toBe(true);
  });
}

async function deliverPriceSnapshot() {
  const previous = store.getState();
  const incoming = snapshot();
  incoming.price.fiat = { asset: 'eur', price: 2 };
  // Price updates use full background delivery, not the healthy balance patch.
  expect(isHotPathOnlyChange(previous, incoming, false)).toBe(false);
  expect(incoming.vault.activeNetwork).toEqual(previous.vault.activeNetwork);
  expect(incoming.vault.activeNetwork).not.toBe(previous.vault.activeNetwork);
  await deliver({ type: 'CONTROLLER_STATE_CHANGE', data: incoming });
  expect(store.getState().price.fiat).toEqual({ asset: 'eur', price: 2 });
  expect(store.getState().vault.activeNetwork).toEqual(network);
  expect(store.getState().vault.activeNetwork).not.toBe(
    previous.vault.activeNetwork
  );
  await screen.findByText('Beta', { selector: 'p' });
}

it('keeps the selected account on a targeted balance delivery', async () => {
  await chooseBeta();
  await deliver({
    type: 'CONTROLLER_ACCOUNT_BALANCE_CHANGE',
    data: {
      id: 0,
      type: KeyringAccountType.HDAccount,
      balances: { ethereum: 2, syscoin: -1 },
    },
  });
  expect(store.getState().vault.accounts.HDAccount[0].balances.ethereum).toBe(
    2
  );
  expect(isSelected('Beta')).toBe(true);
  expect(lookupCalls()).toHaveLength(1);
  expect(mutationCalls()).toEqual([]);
});

it.each(['pointer', 'keyboard'] as const)(
  'preserves %s selection across an unrelated full price snapshot and Cancel',
  async (method) => {
    const user = await chooseBeta(method);
    const previousDapps = store.getState().dapp;
    await deliverPriceSnapshot();
    expect(isSelected('Beta')).toBe(true);
    expect(isSelected('Alpha')).toBe(false);
    expect(lookupCalls()).toHaveLength(1);
    expect(mutationCalls()).toEqual([]);
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
    await user.click(cancel());
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(mutationCalls()).toEqual([]);
    expect(store.getState().dapp).toEqual(previousDapps);
  }
);

it('retains the reviewed account in exact controller arguments after the refresh', async () => {
  const user = await chooseBeta();
  await deliverPriceSnapshot();
  expect(isSelected('Beta')).toBe(true);
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'get') return null;
    if (method === 'setAccount' || method === 'connect') return undefined;
    throw Error(`Unexpected method ${method}`);
  });
  await user.click(confirm());
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(mutationCalls()).toEqual([
    [
      ['wallet', 'setAccount'],
      [1, KeyringAccountType.HDAccount, true, account(1, 'Beta', '2').address],
    ],
    [
      ['dapp', 'connect'],
      [
        {
          host: 'https://bridge.syscoin.org',
          chain: 'ethereum',
          chainId: 1,
          accountId: 1,
          accountType: KeyringAccountType.HDAccount,
          date: expect.any(Number),
        },
        {
          address: account(1, 'Beta', '2').address,
          xpub: undefined,
          network: {
            kind: INetworkType.Ethereum,
            chainId: 1,
            url: network.url,
            slip44: 60,
          },
        },
      ],
    ],
  ]);
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'connect.https://bridge.syscoin.org',
    null
  );
});

it('does not restore an existing grant over a newer user selection on full refresh', async () => {
  mockDapp = {
    host: 'https://bridge.syscoin.org',
    chain: INetworkType.Ethereum,
    chainId: 1,
    accountId: 0,
    accountType: KeyringAccountType.HDAccount,
  };
  await chooseBeta();
  await deliverPriceSnapshot();
  expect(isSelected('Beta')).toBe(true);
  expect(isSelected('Alpha')).toBe(false);
  expect(lookupCalls()).toHaveLength(1);
  expect(mutationCalls()).toEqual([]);
});

it.each(['chainId', 'url', 'slip44', 'kind'] as const)(
  'reinitializes selection when the actual network %s changes',
  async (field) => {
    await chooseBeta();
    const incoming = snapshot();
    if (field === 'chainId') incoming.vault.activeNetwork.chainId = 11155111;
    if (field === 'url')
      incoming.vault.activeNetwork.url = 'https://other-rpc.synthetic.invalid';
    if (field === 'slip44') incoming.vault.activeNetwork.slip44 = 57;
    if (field === 'kind') {
      incoming.vault.activeNetwork.kind = INetworkType.Syscoin;
      incoming.vault.activeNetwork.slip44 = 57;
      incoming.vault.isBitcoinBased = true;
      incoming.vaultGlobal.activeSlip44 = 57;
      for (const entry of Object.values(
        incoming.vault.accounts.HDAccount
      ) as any[]) {
        entry.address = `sys1qsynthetic${entry.id}`;
        entry.slip44 = 57;
      }
    }
    await deliver({ type: 'CONTROLLER_STATE_CHANGE', data: incoming });
    await waitFor(() => expect(lookupCalls()).toHaveLength(2));
    await screen.findByText('Beta', { selector: 'p' });
    expect(isSelected('Alpha')).toBe(true);
    expect(isSelected('Beta')).toBe(false);
    expect(mutationCalls()).toEqual([]);
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  }
);

it.each(['removed', 'incompatible'] as const)(
  'cannot grant an account that became %s in a background account delivery',
  async (state) => {
    const user = await chooseBeta();
    const accounts = snapshot().vault.accounts;
    if (state === 'removed') delete accounts.HDAccount[1];
    else accounts.HDAccount[1].address = 'sys1qsynthetic-incompatible';
    await deliver({ type: 'CONTROLLER_ACCOUNTS_CHANGE', data: accounts });
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    // The stale selection is neither presented nor actionable.
    expect(confirm()).toBeDisabled();
    expect(
      screen.getByText('connections.selectAccountToConnect')
    ).toBeInTheDocument();
    await user.click(confirm());
    expect(mutationCalls()).toEqual([]);
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
    await user.click(row('Alpha'));
    expect(isSelected('Alpha')).toBe(true);
    expect(confirm()).toBeEnabled();
    expect(
      screen.queryByText('connections.selectAccountToConnect')
    ).not.toBeInTheDocument();
    await user.click(cancel());
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(mutationCalls()).toEqual([]);
  }
);
