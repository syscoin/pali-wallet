/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import { TxsPanel } from '../TxsPanel';
import vaultReducer from 'state/vault';
import globalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

let mockStore: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('pages/Home/Panel/index', () => ({
  TransactionsPanel: jest.requireActual('pages/Home/Panel/ActivityPanel')
    .TransactionsPanel,
  AssetsPanel: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('components/Icon/Icon', () => ({ ExternalLinkSvg: () => null }));
jest.mock('pages/Home/Panel/components/Transactions/EVM/EvmList', () => ({
  EvmTransactionsList: () => <p>Public EVM history</p>,
}));
jest.mock('pages/Home/Panel/components/Transactions/UTXO/UtxoList', () => ({
  UtxoTransactionsList: () => <p>Public UTXO history</p>,
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: () => {
    throw new Error('Explorer rendering must not request external data');
  },
}));

const EVM_ADDRESS = `0x${'11'.repeat(20)}`;
const UTXO_ADDRESS = 'tsys1qqyqszqgpqyqszqgpqyqszqgpqyqszqgpmtdx9f';
// Only the public extended-key string is used; this path does not parse keys.
const XPUB = 'synthetic-public-xpub';
type AccountKind =
  | 'evm'
  | 'hd-utxo'
  | 'imported-xpub'
  | 'imported-address'
  | 'utxo-address';
const openFromActivity = (kind: AccountKind, explorer?: string) => {
  const isBitcoinBased = kind !== 'evm';
  const type = kind.startsWith('imported')
    ? KeyringAccountType.Imported
    : KeyringAccountType.HDAccount;
  const address = isBitcoinBased ? UTXO_ADDRESS : EVM_ADDRESS;
  const xpub =
    kind === 'imported-address'
      ? address
      : kind === 'hd-utxo' || kind === 'imported-xpub'
      ? XPUB
      : undefined;
  const chainId = isBitcoinBased ? 5700 : 1;
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = globalReducer(undefined, { type: 'test/init' });
  const networkType = isBitcoinBased
    ? INetworkType.Syscoin
    : INetworkType.Ethereum;
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: globalReducer },
    preloadedState: {
      vault: {
        ...vault,
        activeAccount: { type, id: 0 },
        accounts: {
          ...vault.accounts,
          [type]: {
            0: {
              id: 0,
              address,
              xpub,
              isImported: type === KeyringAccountType.Imported,
            },
          },
        },
        activeNetwork: {
          chainId,
          kind: networkType,
          slip44: isBitcoinBased ? 1 : 60,
          currency: isBitcoinBased ? 'tsys' : 'eth',
          label: 'Synthetic public network',
          url: 'https://rpc.synthetic.invalid/base/',
          explorer,
        },
        isBitcoinBased,
        accountTransactions: {
          [type]: {
            0: {
              ethereum: {
                [chainId]: isBitcoinBased
                  ? []
                  : [{ hash: `0x${'aa'.repeat(32)}` }],
              },
              syscoin: {
                [chainId]: isBitcoinBased ? [{ txid: 'aa'.repeat(32) }] : [],
              },
            },
          },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: isBitcoinBased ? 1 : 60 },
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  const open = jest.spyOn(window, 'open').mockReturnValue(null);
  render(
    <Provider store={mockStore}>
      <MemoryRouter initialEntries={['/home?tab=activity']}>
        <TxsPanel />
      </MemoryRouter>
    </Provider>
  );
  expect(
    screen.getByText(
      isBitcoinBased ? 'Public UTXO history' : 'Public EVM history'
    )
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'home.seeAllTxs' }));
  expect(open).toHaveBeenCalledTimes(1);
  return open;
};
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// Inputs here are stored explorer bases. This consumer preserves their query
// and fragment values; it does not normalize the original CustomRPC form input.
it.each([
  [
    'EVM root',
    'evm',
    'https://explorer.synthetic.invalid/',
    `https://explorer.synthetic.invalid/address/${EVM_ADDRESS}`,
  ],
  [
    'EVM path',
    'evm',
    'https://explorer.synthetic.invalid/public/',
    `https://explorer.synthetic.invalid/public/address/${EVM_ADDRESS}`,
  ],
  [
    'EVM query',
    'evm',
    'https://explorer.synthetic.invalid/public/?view=compact/',
    `https://explorer.synthetic.invalid/public/address/${EVM_ADDRESS}?view=compact/`,
  ],
  [
    'EVM query unchanged by SDK',
    'evm',
    'https://explorer.synthetic.invalid/public/?returnPath=/',
    `https://explorer.synthetic.invalid/public/address/${EVM_ADDRESS}?returnPath=/`,
  ],
  [
    'EVM anchored query',
    'evm',
    'https://explorer.synthetic.invalid/public/?view=compact#section',
    `https://explorer.synthetic.invalid/public/address/${EVM_ADDRESS}?view=compact#section`,
  ],
  [
    'EVM hash route',
    'evm',
    'https://explorer.synthetic.invalid/app/#/route/',
    `https://explorer.synthetic.invalid/app/#/route/address/${EVM_ADDRESS}`,
  ],
  [
    'EVM hash query',
    'evm',
    'https://explorer.synthetic.invalid/app/#/route?view=compact/',
    `https://explorer.synthetic.invalid/app/#/route/address/${EVM_ADDRESS}?view=compact/`,
  ],
  [
    'EVM hashbang query',
    'evm',
    'https://explorer.synthetic.invalid/app/#!/route?view=compact/',
    `https://explorer.synthetic.invalid/app/#!/route/address/${EVM_ADDRESS}?view=compact/`,
  ],
  [
    'UTXO extended key',
    'hd-utxo',
    'https://explorer.synthetic.invalid/',
    `https://explorer.synthetic.invalid/xpub/${XPUB}`,
  ],
  [
    'UTXO imported extended key',
    'imported-xpub',
    'https://explorer.synthetic.invalid/public/',
    `https://explorer.synthetic.invalid/public/xpub/${XPUB}`,
  ],
  [
    'UTXO imported single address',
    'imported-address',
    'https://explorer.synthetic.invalid/',
    `https://explorer.synthetic.invalid/address/${UTXO_ADDRESS}`,
  ],
  [
    'UTXO missing extended key',
    'utxo-address',
    'https://explorer.synthetic.invalid/',
    `https://explorer.synthetic.invalid/address/${UTXO_ADDRESS}`,
  ],
  [
    'UTXO extended key query',
    'hd-utxo',
    'https://explorer.synthetic.invalid/public/?view=compact/',
    `https://explorer.synthetic.invalid/public/xpub/${XPUB}?view=compact/`,
  ],
  [
    'RPC fallback',
    'evm',
    undefined,
    `https://rpc.synthetic.invalid/base/address/${EVM_ADDRESS}`,
  ],
] as const)(
  'keeps the current %s identifier in the route and preserves stored URL components',
  (_label, kind, explorer, expected) => {
    expect(openFromActivity(kind, explorer)).toHaveBeenCalledWith(
      expected,
      '_blank'
    );
  }
);
