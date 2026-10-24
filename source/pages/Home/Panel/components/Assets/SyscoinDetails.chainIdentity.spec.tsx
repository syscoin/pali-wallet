/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';

import vaultReducer, { setAccountAssets, setActiveNetwork } from 'state/vault';
import { KeyringAccountType } from 'types/network';

import { SyscoinAssetDetails } from './SyscoinDetails';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (copyKey: string, copyValues?: any) =>
      jest
        .requireActual('../../../../../../tests/helpers/localizedUiCopy')
        .localizedUiCopy(copyKey, copyValues) ??
      (((key: string) => key) as any)(copyKey, copyValues),
  }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home/details', state: null }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, jest.fn()],
    alert: { info: jest.fn() },
    navigate: jest.fn(),
  }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/index', () => ({
  Button: ({ children }: any) => <button>{children}</button>,
}));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
  FiCopy: () => null,
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('utils/index', () => ({
  formatCurrency: (value: string) => value,
  truncate: (value: string) => value,
  camelCaseToText: (value: string) =>
    value.charAt(0).toUpperCase() + value.slice(1),
  syscoinKeysOfInterest: ['symbol', 'decimals', 'balance', 'contract'],
  adjustUrl: (value: string) => value,
  getKnownSyscoinAsset: () => null,
  getTokenLogo: () => undefined,
}));
jest.mock('utils/retryableFetch', () => ({
  retryableFetch: jest.fn(() => {
    throw new Error('Unexpected network read');
  }),
}));
jest.mock('utils/navigationState', () => ({ navigateBack: jest.fn() }));

const guid = '998877';
const mainnet = {
  assetGuid: guid,
  chainId: 57,
  symbol: 'MAIN',
  decimals: 8,
  balance: '99',
  totalSent: '1',
  totalReceived: '100',
};
const testnet = {
  assetGuid: guid,
  chainId: 5700,
  symbol: 'TEST',
  decimals: 2,
  balance: '12',
  totalSent: '3',
  totalReceived: '15',
};
const network = {
  chainId: 5700,
  kind: 'syscoin',
  label: 'Syscoin Testnet',
  url: 'https://testnet.invalid/',
};

const mount = (
  assets: any[],
  navigationState?: any,
  selectedNetwork = network
) => {
  const initial = vaultReducer(undefined, { type: 'test/init' });
  const store = configureStore({
    reducer: {
      vault: vaultReducer,
      price: (state = { fiat: { asset: 'usd', price: 0 } }) => state,
    },
    preloadedState: {
      vault: {
        ...initial,
        activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
        activeNetwork: selectedNetwork,
      } as any,
    },
  });
  store.dispatch(
    setAccountAssets({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      assets: { syscoin: assets, ethereum: [] },
    })
  );
  render(
    <Provider store={store}>
      <SyscoinAssetDetails id={guid} navigationState={navigationState} />
    </Provider>
  );
  return store;
};

it('displays an imported asset from the active chain', () => {
  mount([testnet]);
  expect(screen.getByText('TEST (Syscoin Testnet)')).toBeInTheDocument();
  expect(screen.getByText('12')).toBeInTheDocument();
});

it('resolves the active-chain asset when another chain imported the same GUID first', () => {
  mount([mainnet, testnet]);
  expect(screen.getByText('TEST (Syscoin Testnet)')).toBeInTheDocument();
  expect(screen.getByText('12')).toBeInTheDocument();
  expect(screen.queryByText('MAIN (Syscoin Testnet)')).not.toBeInTheDocument();
  expect(screen.queryByText('99')).not.toBeInTheDocument();
});

it('updates the details to the selected chain when its network changes', () => {
  const store = mount([mainnet, testnet]);
  act(() => {
    store.dispatch(
      setActiveNetwork({
        ...network,
        chainId: 57,
        label: 'Syscoin Mainnet',
        url: 'https://mainnet.invalid/',
      } as any)
    );
  });
  expect(screen.getByText('MAIN (Syscoin Mainnet)')).toBeInTheDocument();
  expect(screen.getByText('99')).toBeInTheDocument();
  expect(screen.queryByText('12')).not.toBeInTheDocument();
});

it('keeps the missing-asset state when only another chain contains the GUID', () => {
  mount([mainnet]);
  expect(screen.getByText('Asset not found')).toBeInTheDocument();
  expect(screen.queryByText('MAIN (Syscoin Testnet)')).not.toBeInTheDocument();
});

it('keeps import previews available even when another chain has the GUID', () => {
  mount([mainnet], {
    isImportPreview: true,
    assetGuid: guid,
    symbol: 'PREVIEW',
    balance: '4',
    decimals: 2,
  });
  expect(screen.getByText('PREVIEW (Syscoin Testnet)')).toBeInTheDocument();
  expect(screen.getByText('4')).toBeInTheDocument();
  expect(screen.queryByText('MAIN (Syscoin Testnet)')).not.toBeInTheDocument();
});

it('localizes a genuinely missing import-preview symbol without persisting the synthetic placeholder', () => {
  const store = mount([], {
    isImportPreview: true,
    assetGuid: guid,
    balance: '4',
    decimals: 2,
  });
  expect(
    screen.getByText('components.unknown (Syscoin Testnet)')
  ).toBeInTheDocument();
  expect(store.getState().vault.accountAssets.HDAccount[0].syscoin).toEqual([]);
});

it('does not translate a real preview token whose supplied symbol is Unknown', () => {
  mount([], {
    isImportPreview: true,
    assetGuid: guid,
    symbol: 'Unknown',
    balance: '4',
    decimals: 2,
  });
  expect(screen.getByText('Unknown (Syscoin Testnet)')).toBeInTheDocument();
  expect(screen.queryByText('components.unknown (Syscoin Testnet)')).toBeNull();
});

it('keeps a stored Unknown symbol authoritative over an incomplete preview draft', () => {
  const stored = { ...testnet, symbol: 'Unknown' };
  const store = mount([stored], { isImportPreview: true, assetGuid: guid });
  expect(screen.getByText('Unknown (Syscoin Testnet)')).toBeInTheDocument();
  expect(store.getState().vault.accountAssets.HDAccount[0].syscoin).toEqual([
    stored,
  ]);
});

const previewContract = '0x3333333333333333333333333333333333333333';
const foreignContract = '0x4444444444444444444444444444444444444444';
const preview = (contract: unknown) => ({
  isImportPreview: true,
  assetGuid: guid,
  symbol: 'PREVIEW',
  balance: '0',
  decimals: 8,
  contract,
});

it.each([
  {
    chainId: 57,
    label: 'Syscoin Mainnet',
    url: 'https://mainnet.invalid/',
    linkName: 'View on NEVM Explorer',
    explorer: 'https://explorer.syscoin.org',
  },
  {
    chainId: 5700,
    label: 'Syscoin Testnet',
    url: 'https://testnet.invalid/',
    linkName: 'View on Tanenbaum Explorer',
    explorer: 'https://explorer.tanenbaum.io',
  },
])(
  'retains validated preview contract actions on chain $chainId without importing or mutating the inventory',
  (value) => {
    const store = mount([], preview(previewContract), {
      ...network,
      chainId: value.chainId,
      label: value.label,
      url: value.url,
    });
    const copy = screen.getByRole('button', {
      name: 'send.copyContractAddress',
    });
    expect(copy).toHaveAttribute('type', 'button');
    expect(copy).toHaveAttribute('title', 'send.copyContractAddress');
    expect(copy).toHaveClass(
      'h-11',
      'w-11',
      'flex-shrink-0',
      'focus-visible:ring-2',
      'focus-visible:ring-brand-royalblue'
    );
    expect(screen.getByText(previewContract)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: value.linkName })).toHaveAttribute(
      'href',
      value.explorer + '/token/' + previewContract
    );
    expect(store.getState().vault.accountAssets.HDAccount[0].syscoin).toEqual(
      []
    );
  }
);

it('uses the current preview contract rather than an imported same-GUID contract from another chain', () => {
  const foreign = { ...mainnet, contract: foreignContract };
  const store = mount([foreign], preview(previewContract));
  expect(screen.getByText(previewContract)).toBeInTheDocument();
  expect(screen.queryByText(foreignContract)).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'View on Tanenbaum Explorer' })
  ).toHaveAttribute(
    'href',
    'https://explorer.tanenbaum.io/token/' + previewContract
  );
  expect(store.getState().vault.accountAssets.HDAccount[0].syscoin).toEqual([
    foreign,
  ]);
});

it('keeps an imported active-chain contract authoritative over an incomplete preview draft', () => {
  const stored = { ...testnet, contract: foreignContract };
  const store = mount([stored], preview(previewContract));
  expect(screen.getByText(foreignContract)).toBeInTheDocument();
  expect(screen.queryByText(previewContract)).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'View on Tanenbaum Explorer' })
  ).toHaveAttribute(
    'href',
    'https://explorer.tanenbaum.io/token/' + foreignContract
  );
  expect(store.getState().vault.accountAssets.HDAccount[0].syscoin).toEqual([
    stored,
  ]);
});

it.each([undefined, null, { address: previewContract }])(
  'does not invent contract controls for a preview without string contract metadata: %p',
  (contract) => {
    const store = mount([], preview(contract));
    expect(
      screen.queryByRole('button', { name: 'send.copyContractAddress' })
    ).toBeNull();
    expect(
      screen.queryByRole('link', { name: 'View on Tanenbaum Explorer' })
    ).toBeNull();
    expect(store.getState().vault.accountAssets.HDAccount[0].syscoin).toEqual(
      []
    );
  }
);
