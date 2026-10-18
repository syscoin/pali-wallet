/** @jest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import vaultGlobalReducer, { setNetwork } from 'state/vaultGlobal';
import { INetwork, INetworkType } from 'types/network';

import { NetworkMenu } from './NetworkMenu';

const mockEmitter = jest.fn();
const mockDispatch = jest.fn();
let mockState: any;
const network: INetwork = {
  chainId: 1337,
  kind: INetworkType.Ethereum,
  url: 'https://rpc.example',
  apiUrl: 'https://old-explorer.example/api',
  explorer: 'https://old-explorer.example',
  label: 'Work network',
  currency: 'eth',
  slip44: 60,
};

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home', search: '', hash: '', state: {} }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'networkMenu.evmNetworks': 'EVM networks',
        'networkMenu.utxoNetworks': 'UTXO networks',
      }[key] || key),
    i18n: { language: 'en' },
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (...args: any[]) => mockDispatch(...args),
  },
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  DropdownArrowSvg: () => null,
  BtcIconSvg: () => null,
  EthIconSvg: () => null,
  WhiteSuccessIconSvg: () => null,
  NetworkIconSvg: () => null,
  EditIconSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({ Icon: () => null }));
jest.mock('components/Spinner/Spinner', () => ({
  __esModule: true,
  default: () => null,
}));

beforeEach(() => {
  mockEmitter.mockReset().mockResolvedValue(undefined);
  mockDispatch.mockReset();
  mockState = {
    vault: { activeNetwork: { ...network }, isBitcoinBased: false },
    vaultGlobal: {
      advancedSettings: { refresh: false },
      networkStatus: 'idle',
      networks: {
        syscoin: {},
        ethereum: { [network.chainId]: { ...network } },
      },
    },
    dapp: { dapps: {} },
  };
});

const chooseSavedNetwork = async (chosen: INetwork = network) => {
  const user = userEvent.setup();
  render(<NetworkMenu />);
  await user.click(screen.getByRole('button', { name: /^Work network/ }));
  const family =
    chosen.kind === INetworkType.Syscoin ? 'UTXO networks' : 'EVM networks';
  await user.click(screen.getByRole('menuitem', { name: family }));
  await user.click(
    within(screen.getByRole('group', { name: family })).getByRole('menuitem', {
      name: chosen.label,
    })
  );
};

const expectActivation = (updated: INetwork) => {
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'setActiveNetwork'],
    [updated]
  );
};

const registerNetwork = (updated: INetwork) => {
  mockState.vaultGlobal = vaultGlobalReducer(
    mockState.vaultGlobal,
    setNetwork({ network: updated })
  );
};

const saveEditedNetwork = (updated: INetwork) => {
  // MainController.editCustomRpc uses this real reducer before persistence.
  // The active vault network deliberately remains separate, as in production.
  mockState.vaultGlobal = vaultGlobalReducer(
    mockState.vaultGlobal,
    setNetwork({ network: updated, isEdit: true })
  );
};

it('allows reselecting the current chain when its saved explorer API changed', async () => {
  const updated = { ...network, apiUrl: 'https://new-explorer.example/api' };
  saveEditedNetwork(updated);
  expect(mockState.vault.activeNetwork.apiUrl).toBe(network.apiUrl);
  expect(mockState.vaultGlobal.networks.ethereum[network.chainId].apiUrl).toBe(
    updated.apiUrl
  );
  await chooseSavedNetwork(updated);
  expectActivation(updated);
});

it.each([
  ['explorer', 'https://new-explorer.example'],
  ['label', 'Renamed work network'],
  ['currency', 'WORK'],
  ['coingeckoId', 'new-coin'],
  ['coingeckoPlatformId', 'new-platform'],
  ['slip44', 61],
] as const)(
  'activates the saved %s configuration through the controller',
  async (field, value) => {
    const updated = { ...network, [field]: value };
    saveEditedNetwork(updated);
    await chooseSavedNetwork(updated);
    expectActivation(updated);
  }
);

it('keeps an exactly unchanged current network as a no-op', async () => {
  saveEditedNetwork({ ...network });
  await chooseSavedNetwork();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('treats an omitted and empty optional API as the same configuration', async () => {
  mockState.vault.activeNetwork = { ...network, apiUrl: undefined };
  saveEditedNetwork({ ...network, apiUrl: '' });
  await chooseSavedNetwork();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('does not reactivate for registry bookkeeping or transient provider observations', async () => {
  saveEditedNetwork({
    ...network,
    default: true,
    key: 'registry-key',
    providerLatency: 12,
  } as INetwork);
  await chooseSavedNetwork();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('still switches through the controller when the saved RPC URL changed', async () => {
  const updated = { ...network, url: 'https://new-rpc.example' };
  saveEditedNetwork(updated);
  await chooseSavedNetwork(updated);
  expectActivation(updated);
});

it.each([
  { ...network, chainId: 1338, label: 'Another EVM chain' },
  { ...network, kind: INetworkType.Syscoin, label: 'UTXO chain', slip44: 57 },
])(
  'activates another kind/chain using the complete selected network: $label',
  async (updated) => {
    registerNetwork(updated);
    await chooseSavedNetwork(updated);
    expectActivation(updated);
  }
);

it('uses the latest live configuration when Redux replaces the active network', async () => {
  const updated = { ...network, apiUrl: 'https://new-explorer.example/api' };
  saveEditedNetwork(updated);
  const user = userEvent.setup();
  const view = render(<NetworkMenu />);
  mockState.vault.activeNetwork = { ...updated };
  view.rerender(<NetworkMenu />);
  await user.click(screen.getByRole('button', { name: /^Work network/ }));
  await user.click(screen.getByRole('menuitem', { name: 'EVM networks' }));
  await user.click(
    within(screen.getByRole('group', { name: 'EVM networks' })).getByRole(
      'menuitem',
      { name: updated.label }
    )
  );
  expect(mockEmitter).not.toHaveBeenCalled();
});
