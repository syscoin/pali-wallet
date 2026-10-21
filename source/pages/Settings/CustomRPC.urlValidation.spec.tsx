/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import CustomRPC from 'pages/Settings/CustomRPC';
import { clearCustomRpcDrafts } from 'pages/Settings/customRpcDraft';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockLocation = { pathname: '/settings/networks/custom-rpc', state: {} };
const originalMessageChannel = globalThis.MessageChannel;

jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vaultGlobal: { networks: { syscoin: {}, ethereum: {} } } }),
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

const fields = [
  ['url', 'settings.rpcUrlPlaceholder'],
  ['explorer', 'settings.explorer'],
  ['apiUrl', 'https://api.example.com/api'],
] as const;

const fillForm = async (placeholder: string, value: string) => {
  const user = userEvent.setup();
  render(<CustomRPC />);
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getChainData'],
      ['ethereum']
    )
  );
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'Public RPC fixture' },
  });
  fireEvent.change(screen.getByPlaceholderText('settings.rpcUrlPlaceholder'), {
    target: { value: 'https://rpc.example.org' },
  });
  fireEvent.change(screen.getByPlaceholderText('settings.chainIdCustomEvm'), {
    target: { value: '31337' },
  });
  fireEvent.change(screen.getByPlaceholderText('settings.symbol'), {
    target: { value: 'ETH' },
  });
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value },
  });
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
};

describe.each(fields)('%s URL validation', (field, placeholder) => {
  it.each([
    ['localhost', 'http://localhost:8545'],
    ['IPv4 loopback', 'http://127.0.0.1:8545'],
    ['HTTPS DNS', 'https://rpc.example.org'],
    ['IPv6 loopback', 'http://[::1]:8545'],
    ['IPv6 global-unicast form', 'https://[2001:db8:1:2:3:4:5:6]:8545'],
    ['IPv6 compressed', 'https://[2001:db8::1]/rpc'],
    ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.1]:8545'],
  ])(
    'accepts an HTTP(S) %s endpoint without changing its text',
    async (_, url) => {
      await fillForm(placeholder, url);
      await waitFor(() =>
        expect(mockEmitter).toHaveBeenCalledWith(
          ['wallet', 'addCustomRpc'],
          [expect.objectContaining({ [field]: url, chainId: 31337 })]
        )
      );
      expect(mockAlert.success).toHaveBeenCalledWith(
        'settings.rpcSuccessfullyAdded'
      );
      expect(
        screen.queryByText('settings.validUrlRequired')
      ).not.toBeInTheDocument();
    }
  );

  it.each([
    ['unsupported FTP', 'ftp://[::1]:8545'],
    ['unsupported WebSocket', 'ws://[::1]:8545'],
    ['script protocol', 'javascript:alert(1)'],
    ['unterminated IPv6', 'http://[::1:8545'],
    ['empty bracketed host', 'http://[]:8545'],
    ['invalid IPv6 hex', 'http://[gggg::1]:8545'],
    ['missing host', 'http://'],
    ['unsupported single-label host', 'http://singlelabel'],
  ])('rejects %s before saving the network', async (_, url) => {
    await fillForm(placeholder, url);
    expect(await screen.findByText('settings.validUrlRequired')).toBeVisible();
    expect(
      mockEmitter.mock.calls.some(([[, method]]) => method === 'addCustomRpc')
    ).toBe(false);
    expect(mockAlert.success).not.toHaveBeenCalled();
  });
});

it.each(fields.slice(1))(
  'keeps an empty optional %s valid',
  async (_, placeholder) => {
    await fillForm(placeholder, '');
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.some(([[, method]]) => method === 'addCustomRpc')
      ).toBe(true)
    );
    expect(mockAlert.success).toHaveBeenCalledWith(
      'settings.rpcSuccessfullyAdded'
    );
  }
);
