/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import CustomRPC from 'pages/Settings/CustomRPC';
import { clearCustomRpcDrafts } from 'pages/Settings/customRpcDraft';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockLocation = {
  pathname: '/settings/networks/custom-rpc',
  state: {} as any,
};
let mockNetworks: any;
const originalMessageChannel = globalThis.MessageChannel;

jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vaultGlobal: { networks: mockNetworks } }),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ isUnlocked: true }),
  subscribeControllerStatus: () => () => undefined,
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { subscribe: () => () => undefined },
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: 'public-fixture',
    network: 'public-fixture',
  }),
  navigateBack: jest.fn(),
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Modal/StatusModal', () => ({ StatusModal: () => null }));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, type, onClick }: any) => (
    <button disabled={disabled} type={type} onClick={onClick}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => children,
}));

beforeEach(() => {
  clearCustomRpcDrafts();
  jest.clearAllMocks();
  mockLocation.state = {};
  mockNetworks = { syscoin: {}, ethereum: {} };
  globalThis.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
  mockEmitter.mockImplementation(async ([, method], args) => {
    if (method === 'getChainData') return [];
    if (method === 'testExplorerApi') return { success: true };
    if (method === 'getRpc') {
      const data = args[0];
      return {
        ...data,
        chainId: Number(data.chainId),
        currency: data.symbol.toLowerCase(),
        kind: 'ethereum',
        slip44: 60,
        default: false,
      };
    }
    return undefined;
  });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn(() => ({
      matches: false,
      addListener: jest.fn(),
      removeListener: jest.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  globalThis.MessageChannel = originalMessageChannel;
});

const manualUtxo = async (chainId: number, label?: string) => {
  const user = userEvent.setup();
  const coin =
    chainId === 0
      ? { label: 'Bitcoin fixture', symbol: 'btc', slip44: 0 }
      : { label: 'Syscoin fixture', symbol: 'sys', slip44: 57 };
  mockEmitter.mockImplementation(async ([, method], args) => {
    if (method === 'getChainData') return [];
    if (method === 'getRpc')
      return {
        url: args[0].url,
        explorer: args[0].explorer || args[0].url,
        label: args[0].label || coin.label,
        currency: args[0].symbol?.toLowerCase() || coin.symbol,
        chainId,
        slip44: coin.slip44,
        kind: 'syscoin',
        default: false,
      };
    return undefined;
  });
  const view = render(<CustomRPC />);
  await user.click(screen.getByRole('switch', { name: 'Syscoin Network' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getChainData'],
      ['syscoin']
    )
  );
  if (label) await user.type(screen.getByRole('combobox'), label);
  const url = screen.getByPlaceholderText('settings.blockbookUrlPlaceholder');
  await user.type(url, 'https://bitcoin-fixture.invalid');
  await user.tab();
  await waitFor(() =>
    expect(screen.getByPlaceholderText('settings.symbol')).toHaveValue(
      coin.symbol.toUpperCase()
    )
  );
  return {
    ...view,
    user,
    id: screen.getByPlaceholderText('settings.chainIdAutoDetectedUtxo'),
  };
};

it.each([0, 57])(
  'shows the detected UTXO chain ID %s in the read-only field',
  async (chainId) => {
    const { id } = await manualUtxo(chainId, 'My node');
    expect(id).toHaveAttribute('readonly');
    expect(id).toHaveValue(String(chainId));
  }
);

it('shows the automatically detected UTXO label before Save or another edit', async () => {
  await manualUtxo(57);
  expect(screen.getByRole('combobox')).toHaveValue('Syscoin fixture');
});

it('preserves the user label and saves numeric-zero Bitcoin identity', async () => {
  const { user } = await manualUtxo(0, 'My Bitcoin node');
  expect(screen.getByRole('combobox')).toHaveValue('My Bitcoin node');
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'addCustomRpc'],
      [
        expect.objectContaining({
          label: 'My Bitcoin node',
          kind: 'syscoin',
          chainId: 0,
          slip44: 0,
          currency: 'btc',
        }),
      ]
    )
  );
  expect(mockAlert.success).toHaveBeenCalledWith(
    'settings.rpcSuccessfullyAdded'
  );
});

it('still requires a nonempty visible label after the user clears it', async () => {
  const { user } = await manualUtxo(57, 'My node');
  await user.clear(screen.getByRole('combobox'));
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(screen.getByRole('combobox')).toHaveValue('');
  expect(
    mockEmitter.mock.calls.some(([[, method]]) => method === 'addCustomRpc')
  ).toBe(false);
});

it.each([false, true])(
  'retains text input semantics for visible custom-network fields (UTXO %s)',
  async (utxo) => {
    const user = userEvent.setup();
    const view = render(<CustomRPC />);
    if (utxo)
      await user.click(screen.getByRole('switch', { name: 'Syscoin Network' }));
    const inputs = Array.from(
      view.container.querySelectorAll<HTMLInputElement>('input')
    );
    expect(inputs).toHaveLength(utxo ? 5 : 6);
    for (const input of inputs) expect(input.type).toBe('text');
  }
);

it('keeps the edit-mode label hidden and present in the submitted network', async () => {
  const network = {
    kind: 'ethereum',
    chainId: 31337,
    slip44: 60,
    url: 'https://rpc.example.org',
    explorer: 'https://explorer.example.org',
    label: 'Current edit label',
    currency: 'eth',
    default: false,
  };
  mockLocation.state = {
    isEditing: true,
    isDefault: false,
    selected: { kind: 'ethereum', chainId: 31337 },
  };
  mockNetworks.ethereum[31337] = network;
  mockEmitter.mockImplementation(async ([, method], args) => {
    if (method === 'getChainData') return [];
    if (method === 'getRpc')
      return { ...network, ...args[0], chainId: 31337, currency: 'eth' };
    return undefined;
  });
  const user = userEvent.setup();
  const view = render(<CustomRPC />);
  const hidden = view.container.querySelector<HTMLInputElement>(
    'input[type="hidden"]'
  );
  expect(hidden).not.toBeNull();
  expect(hidden).toHaveValue(network.label);
  for (const input of view.container.querySelectorAll<HTMLInputElement>(
    'input:not([type="hidden"])'
  ))
    expect(input.type).toBe('text');
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'editCustomRpc'],
      [
        expect.objectContaining({ label: network.label, chainId: 31337 }),
        expect.any(String),
      ]
    )
  );
});
