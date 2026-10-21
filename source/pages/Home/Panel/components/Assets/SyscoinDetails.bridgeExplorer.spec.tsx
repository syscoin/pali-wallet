/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';

import SysAssetsController from 'scripts/Background/controllers/assets/syscoin';
import vaultReducer, { setAccountAssets, setActiveNetwork } from 'state/vault';
import { INetwork, INetworkType, KeyringAccountType } from 'types/network';
import {
  SYSCOIN_MAINNET_NETWORK,
  SYSCOIN_NEVM_TESTNET_NETWORK_5700,
} from 'utils/constants';
import {
  getSyscoinUTXOMainnetNetwork,
  getSyscoinUTXOTestnetNetwork,
} from 'utils/defaultNetworks';

import { SyscoinAssetDetails } from './SyscoinDetails';

let mockStore: any;
const mockRead = jest.fn();
const mockController = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock(
  'scripts/Background/controllers/utils/fetchBackendAccountWrapper',
  () => ({ fetchBackendAccountCached: (...args: any[]) => mockRead(...args) })
);
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockController(...args),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home/details', state: null }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.fn(),
    alert: { info: jest.fn() },
    useCopyClipboard: () => [false, jest.fn(), () => true],
  }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
}));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
  FiCopy: () => null,
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  syscoinKeysOfInterest:
    jest.requireActual('utils/constants').syscoinKeysOfInterest,
  getKnownSyscoinAsset: () => null,
  getTokenLogo: () => undefined,
}));
jest.mock('utils/retryableFetch', () => ({
  retryableFetch: () => {
    throw new Error('Unexpected external market read');
  },
}));

const GUID = '998877';
const XPUB = 'synthetic-public-xpub';
const CONTRACT = `0x${'ab'.repeat(20)}`;
const MAINNET_LABEL = 'View on NEVM Explorer';
const TESTNET_LABEL = 'View on Tanenbaum Explorer';
const mainnetContractUrl = `${SYSCOIN_MAINNET_NETWORK.explorer}/token/${CONTRACT}`;
const testnetContractUrl = `${SYSCOIN_NEVM_TESTNET_NETWORK_5700.explorer}token/${CONTRACT}`;

const createStore = (network: INetwork) => {
  const initial = vaultReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: {
      vault: vaultReducer,
      price: (state = { fiat: { asset: 'usd', price: 0 } }) => state,
    },
    preloadedState: {
      vault: {
        ...initial,
        isBitcoinBased: true,
        activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
        activeNetwork: network,
        accounts: {
          ...initial.accounts,
          HDAccount: {
            0: {
              ...initial.accounts.HDAccount[0],
              id: 0,
              address: 'synthetic-public-address',
              xpub: XPUB,
              label: 'Synthetic account',
            },
          },
        },
      } as any,
    },
  });
};

const ownedAsset = async (contract = CONTRACT, symbol = 'BRIDGED') => {
  const network = mockStore.getState().vault.activeNetwork;
  mockRead.mockResolvedValue({
    tokensAsset: [
      {
        assetGuid: GUID,
        symbol,
        decimals: 8,
        balance: '100000000',
        totalSent: '0',
        totalReceived: '100000000',
        unconfirmedBalance: '0',
        transfers: 1,
        contract,
      },
    ],
  });
  const rows = await SysAssetsController().getUserOwnedTokens(XPUB);
  expect(mockRead).toHaveBeenLastCalledWith(
    network.url,
    XPUB,
    'details=tokenBalances&tokens=nonzero',
    true
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    assetGuid: GUID,
    chainId: network.chainId,
    contract,
    balance: '1.0',
  });
  return rows[0];
};

const publish = (assets: any[]) =>
  mockStore.dispatch(
    setAccountAssets({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      assets: { syscoin: assets, ethereum: [] },
    })
  );
const mount = () =>
  render(
    <Provider store={mockStore}>
      <SyscoinAssetDetails id={GUID} />
    </Provider>
  );
const expectBridgeLink = (testnet: boolean) => {
  expect(
    screen.getByRole('link', {
      name: testnet ? TESTNET_LABEL : MAINNET_LABEL,
    })
  ).toHaveAttribute('href', testnet ? testnetContractUrl : mainnetContractUrl);
  expect(
    screen.queryByRole('link', {
      name: testnet ? MAINNET_LABEL : TESTNET_LABEL,
    })
  ).toBeNull();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockController.mockImplementation(() => {
    throw new Error('Unexpected controller read for complete asset metadata');
  });
});
afterEach(() => {
  expect(mockController).not.toHaveBeenCalled();
  cleanup();
});

it.each([
  ['default mainnet', getSyscoinUTXOMainnetNetwork(), false],
  ['default testnet', getSyscoinUTXOTestnetNetwork(), true],
  [
    'renamed testnet',
    { ...getSyscoinUTXOTestnetNetwork(), label: 'My custom node' },
    true,
  ],
  [
    'custom mainnet endpoint',
    {
      ...getSyscoinUTXOMainnetNetwork(),
      url: 'https://custom-mainnet.synthetic.invalid/',
      label: 'My custom mainnet node',
    },
    false,
  ],
  [
    'custom testnet endpoint',
    {
      ...getSyscoinUTXOTestnetNetwork(),
      url: 'https://custom-testnet.synthetic.invalid/',
      label: 'My custom testnet node',
    },
    true,
  ],
] as const)(
  'opens the matching NEVM contract for %s, independent of label or RPC hostname',
  async (_name, network, testnet) => {
    createStore(network);
    publish([await ownedAsset()]);
    mount();
    expectBridgeLink(testnet);
  }
);

it.each(['', `0x${'00'.repeat(20)}`])(
  'keeps an unbridged SPT without an NEVM link for contract %s',
  async (contract) => {
    createStore(getSyscoinUTXOTestnetNetwork());
    publish([await ownedAsset(contract)]);
    mount();
    expect(screen.queryByRole('link', { name: MAINNET_LABEL })).toBeNull();
    expect(screen.queryByRole('link', { name: TESTNET_LABEL })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'View on Syscoin Explorer' })
    ).toHaveAttribute(
      'href',
      `https://explorer-blockbook-dev.syscoin.org/asset/${GUID}`
    );
  }
);

it('does not label an unrelated UTXO chain as NEVM based on RPC hostname text', async () => {
  createStore({
    chainId: 2,
    slip44: 2,
    kind: INetworkType.Syscoin,
    currency: 'ltc',
    label: 'Unrelated UTXO network',
    url: 'https://syscoin.org.synthetic.invalid/',
    explorer: 'https://litecoin.synthetic.invalid/',
    default: false,
  });
  publish([await ownedAsset()]);
  mount();
  expect(screen.queryByRole('link', { name: MAINNET_LABEL })).toBeNull();
  expect(screen.queryByRole('link', { name: TESTNET_LABEL })).toBeNull();
});

it('resolves same-GUID assets and their bridge links from the selected chain after a network change', async () => {
  const mainnet = getSyscoinUTXOMainnetNetwork();
  const testnet = getSyscoinUTXOTestnetNetwork();
  createStore(mainnet);
  const mainnetAsset = await ownedAsset(CONTRACT, 'MAINSPT');
  mockStore.dispatch(setActiveNetwork(testnet));
  const testnetAsset = await ownedAsset(CONTRACT, 'TESTSPT');
  mockStore.dispatch(setActiveNetwork(mainnet));
  publish([mainnetAsset, testnetAsset]);
  mount();
  expect(screen.getByText(`MAINSPT (${mainnet.label})`)).toBeVisible();
  expectBridgeLink(false);
  act(() => mockStore.dispatch(setActiveNetwork(testnet)));
  expect(screen.getByText(`TESTSPT (${testnet.label})`)).toBeVisible();
  expect(screen.queryByText(`MAINSPT (${testnet.label})`)).toBeNull();
  expectBridgeLink(true);
});
