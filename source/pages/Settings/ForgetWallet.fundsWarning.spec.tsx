/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import vault, {
  createAccount,
  setAccountBalanceForNetwork,
  setActiveAccount,
  setNetworkChange,
} from 'state/vault';
import {
  initialActiveHdAccountState,
  INetwork,
  KeyringAccountType,
} from 'types/network';
import { SYSCOIN_NEVM_TESTNET_NETWORK_5700 } from 'utils/constants';
import { getSyscoinUTXOTestnetNetwork } from 'utils/defaultNetworks';

import ForgetWallet from './ForgetWallet';

const mockEmitter = jest.fn(() => {
  throw new Error('Funds disclosure must not authenticate or retrieve secrets');
});
const mockNavigate = jest.fn();
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/index', () => ({
  Button: ({
    children,
    loading: _loading,
    variant: _variant,
    ...props
  }: React.ComponentProps<'button'> & {
    loading?: boolean;
    variant?: string;
  }) => {
    void _loading;
    void _variant;
    return <button {...props}>{children}</button>;
  },
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  PageActionFooter: ({
    children,
    className,
    error,
    includeInFlow,
  }: {
    children: React.ReactNode;
    className?: string;
    error?: string;
    includeInFlow?: boolean;
  }) => (
    <footer className={className} data-include-in-flow={String(includeInFlow)}>
      {children}
      {error}
    </footer>
  ),
  // Deliberately inert: none of these disclosure tests validates a password,
  // reveals a seed or submits the destructive Forget action.
  ValidatedPasswordInput: () => (
    <input type="password" aria-label="Unused password input" />
  ),
  SeedPhraseDisplay: ({
    seedPhrase,
    isEnabled,
  }: {
    isEnabled: boolean;
    seedPhrase: string;
  }) => {
    if (seedPhrase || isEnabled)
      throw new Error('Funds disclosure must not reveal a secret');
    return <div aria-label="Inactive empty seed display" />;
  },
}));

// Public-only derivations from the existing public tpub fixture. No private
// key, seed, password, SDK signer or physical-device transport is present.
const PUBLIC_ACCOUNTS = [
  {
    xpub: 'tpubDF93avGi4A5M9SVXQ45xy1hJ5j7dEBkA4M9jTwt74wurbFoCfRSHoDshkoLaUQmobjYGSakehWisjK6CXHeB3fXwtCtPmGnrKnvEU6u8NwV',
    utxo: 'tsys1qmk2wr58dse5esyw8xcrsp7k5r77zj2xzvhqhkl',
    evm: '0x42d8597713f7bA7151E0B9045dBB1b4DA107754a',
  },
  {
    xpub: 'tpubDF93avGi4A5MBxSELqWwvbg4VAM4tLFGQPFsDGCxTguaRj57pvFTcfNchU7SMQAXZok5VtrL8Tg4oZ9ajxKUsZVJrfNRzxuofktDPvMKZY9',
    utxo: 'tsys1q0jyr2az2sd6ksqkmjtutdvn546dme8lyhjp5hg',
    evm: '0x7D9075B041Cdb13E15aDA2E16a60890FCeE8DF6a',
  },
];
const UTXO_NETWORK = getSyscoinUTXOTestnetNetwork();
const EVM_NETWORK = SYSCOIN_NEVM_TESTNET_NETWORK_5700;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;

beforeAll(() => {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});
afterEach(() => {
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
  cleanup();
  jest.clearAllMocks();
});

function fixture(network: INetwork) {
  const store = configureStore({ reducer: { vault } });
  store.dispatch(setNetworkChange({ activeNetwork: network }));
  const add = (id: number, type = KeyringAccountType.HDAccount) => {
    const metadata =
      PUBLIC_ACCOUNTS[type === KeyringAccountType.HDAccount ? id : 1];
    const address =
      network.kind === UTXO_NETWORK.kind ? metadata.utxo : metadata.evm;
    store.dispatch(
      createAccount({
        accountType: type,
        account: {
          ...initialActiveHdAccountState,
          id,
          label: `Public ${type} ${id}`,
          address,
          xpub: type === KeyringAccountType.Imported ? address : metadata.xpub,
          isImported: type === KeyringAccountType.Imported,
        },
      })
    );
    // These are the actual create/select actions published by
    // persistAccountCreation after durable account creation/import.
    store.dispatch(setActiveAccount({ id, type }));
  };
  const balance = (
    value: number,
    id: number,
    type = KeyringAccountType.HDAccount,
    ownerNetwork = network
  ) => {
    store.dispatch(
      setAccountBalanceForNetwork({
        balance: value,
        id,
        type,
        network: ownerNetwork,
      })
    );
  };
  const open = () => {
    render(
      <Provider store={store}>
        <MemoryRouter
          initialEntries={['/settings/forget-wallet']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <ForgetWallet />
        </MemoryRouter>
      </Provider>
    );
    expect(
      screen.getByRole('button', { name: 'buttons.forget' })
    ).toBeDisabled();
  };
  return { add, balance, open, store };
}

describe.each([
  ['UTXO', UTXO_NETWORK],
  ['EVM', EVM_NETWORK],
] as const)('Forget Wallet known-funds warning on %s', (_family, network) => {
  test('preserves the warning for a funded selected account', () => {
    const { add, balance, open } = fixture(network);
    add(0);
    balance(1, 0);
    open();
    const warning = screen.getByText('forgetWalletPage.stillHaveFunds');
    expect(screen.queryByText('start.eraseFundsWarning')).toBeNull();
    const forget = screen.getByRole('button', { name: 'buttons.forget' });
    const footer = forget.closest('footer');
    expect(footer).toHaveClass('funded-forget-footer');
    expect(footer).toHaveAttribute('data-include-in-flow', 'true');
    expect(
      warning.compareDocumentPosition(footer!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test('does not claim funds when all known accounts have zero balance', () => {
    const { add, balance, open } = fixture(network);
    add(0);
    balance(0, 0);
    add(1);
    balance(0, 1);
    open();
    expect(screen.queryByText('forgetWalletPage.stillHaveFunds')).toBeNull();
    const warning = screen.getByText('start.eraseFundsWarning');
    expect(screen.queryByLabelText('Inactive empty seed display')).toBeNull();
    const footer = screen
      .getByRole('button', { name: 'buttons.forget' })
      .closest('footer');
    expect(footer).toHaveClass('funded-forget-footer');
    expect(footer).toHaveAttribute('data-include-in-flow', 'true');
    expect(
      warning.compareDocumentPosition(footer!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test('does not treat the unknown balance sentinel as positive funds', () => {
    const { add, open, store } = fixture(network);
    add(0);
    add(1);
    expect(store.getState().vault.accounts.HDAccount[0].balances).toEqual({
      syscoin: -1,
      ethereum: -1,
    });
    open();
    expect(screen.queryByText('forgetWalletPage.stillHaveFunds')).toBeNull();
    expect(screen.getByText('start.eraseFundsWarning')).toBeInTheDocument();
    expect(screen.queryByLabelText('Inactive empty seed display')).toBeNull();
  });

  test('keeps the warning after an empty new HD account becomes selected', () => {
    const { add, balance, open, store } = fixture(network);
    add(0);
    balance(1, 0);
    add(1);
    balance(0, 1);
    expect(store.getState().vault.activeAccount).toEqual({
      id: 1,
      type: KeyringAccountType.HDAccount,
    });
    expect(
      store.getState().vault.accounts.HDAccount[0].balances[network.kind]
    ).toBe(1);
    open();
    expect(
      screen.queryByText('forgetWalletPage.stillHaveFunds')
    ).not.toBeNull();
  });

  test('includes another account group when its numeric ID matches the selected HD account', () => {
    const { add, balance, open, store } = fixture(network);
    add(0, KeyringAccountType.Imported);
    balance(1, 0, KeyringAccountType.Imported);
    add(0);
    balance(0, 0);
    expect(
      store.getState().vault.accounts.Imported[0].balances[network.kind]
    ).toBe(1);
    expect(
      store.getState().vault.accounts.HDAccount[0].balances[network.kind]
    ).toBe(0);
    open();
    expect(
      screen.queryByText('forgetWalletPage.stillHaveFunds')
    ).not.toBeNull();
  });

  test('includes an already-known opposite-family native balance', () => {
    const { add, balance, open, store } = fixture(network);
    const oppositeNetwork =
      network.kind === UTXO_NETWORK.kind ? EVM_NETWORK : UTXO_NETWORK;
    add(0);
    balance(0, 0);
    // The actual native-balance reducer updates one family without erasing
    // the other. Returning to a network restores its fresh cached zero;
    // the account's known opposite-family native balance remains positive.
    store.dispatch(setNetworkChange({ activeNetwork: oppositeNetwork }));
    balance(1, 0, KeyringAccountType.HDAccount, oppositeNetwork);
    store.dispatch(setNetworkChange({ activeNetwork: network }));
    expect(
      store.getState().vault.accounts.HDAccount[0].balances[network.kind]
    ).toBe(0);
    expect(
      store.getState().vault.accounts.HDAccount[0].balances[
        oppositeNetwork.kind
      ]
    ).toBe(1);
    open();
    expect(
      screen.queryByText('forgetWalletPage.stillHaveFunds')
    ).not.toBeNull();
  });
});
