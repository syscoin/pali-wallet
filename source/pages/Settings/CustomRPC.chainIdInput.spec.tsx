/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { clearRpcCaches, getEthRpc } from '@sidhujag/sysweb3-network';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import CustomRPC from 'pages/Settings/CustomRPC';
import { clearCustomRpcDrafts } from 'pages/Settings/customRpcDraft';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockLocation = { pathname: '/settings/networks/custom-rpc', state: {} };
const originalMessageChannel = globalThis.MessageChannel;
const originalFetch = globalThis.fetch;
const rpcUrl = 'https://public-rpc.invalid';
const validationMessage = 'Chain ID must be a positive number';

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
  clearRpcCaches();
  jest.clearAllMocks();
  globalThis.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
  // Match MainController.getRpc's real SDK call. Only HTTP is synthetic: its
  // chain ID is fixed independently of whatever the user types in the form.
  globalThis.fetch = jest.fn(async (url, options) => {
    expect(url).toBe(rpcUrl);
    expect(JSON.parse(String(options?.body))).toMatchObject({
      method: 'eth_chainId',
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x7a69' }),
    } as Response;
  });
  mockEmitter.mockImplementation(async ([, method], args) => {
    if (method === 'getChainData') return [];
    if (method === 'getRpc')
      return (await getEthRpc(args[0], false)).formattedNetwork;
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
  clearRpcCaches();
  globalThis.MessageChannel = originalMessageChannel;
  globalThis.fetch = originalFetch;
});

const prepareForm = async (chainId: string) => {
  const user = userEvent.setup();
  render(<CustomRPC />);
  await user.type(screen.getByRole('combobox'), 'Public chain');
  await user.type(
    screen.getByPlaceholderText('settings.rpcUrlPlaceholder'),
    rpcUrl
  );
  await user.tab();
  const input = screen.getByPlaceholderText('settings.chainIdCustomEvm');
  expect(input).toHaveAttribute('type', 'text');
  expect(input).not.toHaveAttribute('step');
  await waitFor(() => expect(input).toHaveValue('31337'));
  await user.clear(input);
  await user.type(input, chainId);
  await user.type(screen.getByPlaceholderText('settings.symbol'), 'ETH');
  return {
    user,
    input,
    save: screen.getByRole('button', { name: 'buttons.save' }),
  };
};

const saves = () =>
  mockEmitter.mock.calls.filter(([[, method]]) => method === 'addCustomRpc');

it.each(['31337', ' 31337 '])(
  'saves a complete positive decimal chain ID %j as the detected integer',
  async (chainId) => {
    const { user, save } = await prepareForm(chainId);
    await user.click(save);
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0][1]).toEqual([
      expect.objectContaining({ chainId: 31337, url: rpcUrl }),
    ]);
    expect(mockAlert.success).toHaveBeenCalledWith(
      'settings.rpcSuccessfullyAdded'
    );
    expect(screen.queryByText(validationMessage)).not.toBeInTheDocument();
  }
);

it.each([
  '31337.5',
  '31337oops',
  '3.1337e4',
  '0x7a69',
  '9007199254740992',
  '0',
  '-1',
  'not-a-chain',
])(
  'rejects invalid chain ID text %j visibly without saving',
  async (chainId) => {
    const { user, input, save } = await prepareForm(chainId);
    await user.click(save);
    expect(await screen.findByText(validationMessage)).toBeVisible();
    expect(input).toHaveValue(chainId);
    expect(saves()).toHaveLength(0);
    expect(mockAlert.success).not.toHaveBeenCalled();
  }
);

it('allows correcting invalid chain ID text before saving the valid integer', async () => {
  const { user, input, save } = await prepareForm('31337.5');
  await user.click(save);
  expect(await screen.findByText(validationMessage)).toBeVisible();
  expect(saves()).toHaveLength(0);

  await user.clear(input);
  await user.type(input, '31337');
  await user.click(save);
  await waitFor(() => expect(saves()).toHaveLength(1));
  expect(saves()[0][1][0].chainId).toBe(31337);
  expect(screen.queryByText(validationMessage)).not.toBeInTheDocument();
  expect(mockAlert.success).toHaveBeenCalledWith(
    'settings.rpcSuccessfullyAdded'
  );
});

it('still rejects a valid integer that differs from the RPC chain ID', async () => {
  const { user, input, save } = await prepareForm('31338');
  await user.click(save);
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith(
      'Chain ID mismatch: RPC reports 31337, but you entered 31338',
      expect.objectContaining({ autoClose: 4000 })
    )
  );
  expect(input).toHaveValue('31338');
  expect(saves()).toHaveLength(0);
  expect(mockAlert.success).not.toHaveBeenCalled();
});
