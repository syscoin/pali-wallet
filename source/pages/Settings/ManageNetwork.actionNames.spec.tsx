/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import React from 'react';

import fr from 'assets/locales/fr.json';
import { INetworkType } from 'types/network';
import { SYSCOIN_NEVM_TESTNET_NETWORK_5700 } from 'utils/constants';
import { getSyscoinUTXOMainnetNetwork } from 'utils/defaultNetworks';
import { truncate } from 'utils/format';

import ManageNetwork from './ManageNetwork';

const mockNavigate = jest.fn();
const mockEmitter = jest.fn(() => {
  throw new Error('No mutation allowed in network action naming tests');
});
const mockLocation = {
  key: 'manage',
  pathname: '/settings/networks/edit',
  search: '',
  hash: '',
  state: null,
};
const utxo = getSyscoinUTXOMainnetNetwork();
const evm = SYSCOIN_NEVM_TESTNET_NETWORK_5700;
const longLabel = 'A custom network with a complete descriptive name';
const mockState = {
  vault: { activeNetwork: utxo },
  vaultGlobal: {
    networkStatus: 'idle',
    isSwitchingAccount: false,
    networks: {
      syscoin: {
        [utxo.chainId]: utxo,
        customUtxo: {
          ...utxo,
          chainId: 3312,
          label: 'Custom UTXO',
          url: 'https://blockbook.invalid',
          key: 'customUtxo',
          default: false,
        },
      },
      ethereum: {
        [evm.chainId]: evm,
        customEvm: {
          ...evm,
          chainId: 3313,
          label: longLabel,
          url: 'https://rpc.invalid',
          key: 'customEvm',
          default: false,
        },
      },
    },
  },
};

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) => {
      if (key === 'buttons.edit') return fr.buttons.edit;
      if (key === 'buttons.remove') return fr.buttons.remove;
      if (key === 'settings.chainNumber')
        return fr.settings.chainNumber.replace(
          '{{chainId}}',
          String(values?.chainId)
        );
      return values?.networkName ? `${key}: ${values.networkName}` : key;
    },
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: { error: jest.fn() } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ connectionUnavailable: false }),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isContextChanging: false }),
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => null }));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  // Match the Ant icons' real image names. The parent button must supply
  // its localized action and row context instead of inheriting these names.
  Icon: ({ name }: any) => (
    <span role="img" aria-label={name === 'trash' ? 'delete' : name} />
  ),
  Tooltip: ({ children }: any) => children,
  ConfirmationModal: ({ show, title, description, children }: any) =>
    show ? (
      <div role="dialog" aria-labelledby="network-removal-test-title">
        <h2 id="network-removal-test-title">{title}</h2>
        <p>{description}</p>
        {children}
      </div>
    ) : null,
}));
jest.mock('utils/index', () => ({
  truncate: jest.requireActual('utils/format').truncate,
}));
jest.mock('utils/navigationState', () => ({
  navigateWithContext: (...args: any[]) => mockNavigate(...args),
  createBrowsingNavigationContext: () => ({
    returnRoute: '/settings/networks/edit',
  }),
  navigateBack: jest.fn(),
}));

afterEach(() => {
  expect(mockEmitter).not.toHaveBeenCalled();
  cleanup();
  jest.clearAllMocks();
});

const row = (label: string) =>
  within(screen.getByText(truncate(label, 25), { exact: true }).closest('li')!);
const identity = (network: {
  chainId: number;
  kind: INetworkType;
  label: string;
}) =>
  `${network.label} (${
    network.kind === INetworkType.Syscoin ? 'UTXO' : 'EVM'
  } · ${fr.settings.chainNumber.replace(
    '{{chainId}}',
    String(network.chainId)
  )})`;

it('names every edit action with its localized purpose and network identity', () => {
  render(<ManageNetwork />);
  for (const network of [
    ...Object.values(mockState.vaultGlobal.networks.syscoin),
    ...Object.values(mockState.vaultGlobal.networks.ethereum),
  ]) {
    expect(
      screen.getByRole('button', {
        name: `${fr.buttons.edit}: ${identity(network)}`,
      })
    ).toBeEnabled();
  }
});

it('distinguishes removable network actions in the accessible button list', () => {
  render(<ManageNetwork />);
  for (const network of [
    mockState.vaultGlobal.networks.syscoin.customUtxo,
    mockState.vaultGlobal.networks.ethereum.customEvm,
  ]) {
    expect(
      screen.getByRole('button', {
        name: `${fr.buttons.remove}: ${identity(network)}`,
      })
    ).toBeEnabled();
  }
});

it('retains the full accessible network identity when the row text is truncated', () => {
  render(<ManageNetwork />);
  expect(screen.queryByText(longLabel, { exact: true })).toBeNull();
  expect(screen.getByText(truncate(longLabel, 25))).toBeInTheDocument();
  for (const action of [fr.buttons.edit, fr.buttons.remove]) {
    expect(
      screen.getByRole('button', {
        name: `${action}: ${identity(
          mockState.vaultGlobal.networks.ethereum.customEvm
        )}`,
      })
    ).toBeEnabled();
  }
});

it.each([
  ['Custom UTXO', INetworkType.Syscoin, 'customUtxo', 3312],
  [longLabel, INetworkType.Ethereum, 'customEvm', 3313],
])(
  'healthy edit of %s still targets the exact normal registration',
  (label, kind, key, chainId) => {
    render(<ManageNetwork />);
    const network = { label, kind, chainId } as {
      chainId: number;
      kind: INetworkType;
      label: string;
    };
    const action = row(label as string).getByRole('button', {
      name: `${fr.buttons.edit}: ${identity(network)}`,
    });
    expect(action).toBeEnabled();
    fireEvent.click(action);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.any(Function),
      '/settings/networks/custom-rpc',
      {
        selected: { chainId, key, kind },
        chain: kind,
        isDefault: false,
        isEditing: true,
      },
      expect.any(Object)
    );
  }
);

it('healthy default network does not offer a removal action', () => {
  render(<ManageNetwork />);
  expect(
    row(utxo.label).getByRole('button', {
      name: `${fr.buttons.edit}: ${identity(utxo)}`,
    })
  ).toBeEnabled();
  expect(
    row(utxo.label).queryByRole('button', {
      name: `${fr.buttons.remove}: ${identity(utxo)}`,
    })
  ).toBeNull();
});

it('healthy remove review still identifies the chosen network without mutation', () => {
  render(<ManageNetwork />);
  fireEvent.click(
    row('Custom UTXO').getByRole('button', {
      name: `${fr.buttons.remove}: ${identity(
        mockState.vaultGlobal.networks.syscoin.customUtxo
      )}`,
    })
  );
  expect(
    screen.getByRole('dialog', {
      name: `settings.confirmRemoveNetwork: ${identity(
        mockState.vaultGlobal.networks.syscoin.customUtxo
      )}`,
    })
  ).toBeInTheDocument();
});
