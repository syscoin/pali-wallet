/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { INetworkType } from 'types/network';

import CustomRPC from './CustomRPC';
import { clearCustomRpcDrafts } from './customRpcDraft';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockLocation = {
  pathname: '/settings/networks/custom-rpc',
  state: {} as any,
};
let mockNetworks: any;
const originalMessageChannel = globalThis.MessageChannel;
const customExplorer = 'https://custom-explorer.example/subpath?theme=dark';
const chains = {
  [INetworkType.Ethereum]: {
    name: 'EVM Example',
    chain: INetworkType.Ethereum,
    chainId: 71,
    nativeCurrency: { symbol: 'EVM' },
    rpc: [{ url: 'https://evm-rpc.example' }],
    explorers: [{ url: 'https://evm-explorer.example' }],
  },
  [INetworkType.Syscoin]: {
    name: 'UTXO Example',
    chain: INetworkType.Syscoin,
    chainId: 2,
    nativeCurrency: { symbol: 'UTXO' },
    rpc: [{ url: 'https://utxo-blockbook.example' }],
    explorers: [{ url: 'https://utxo-blockbook.example' }],
  },
};

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
    account: 'account-a',
    network: 'network-a',
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
  mockLocation.state = {};
  mockNetworks = { ethereum: {}, syscoin: {} };
  jest.clearAllMocks();
  globalThis.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
  mockEmitter.mockImplementation(async ([, method], args) => {
    if (method === 'getChainData') return [chains[args[0]]];
    if (method === 'testRpcConnection')
      return { success: true, chainId: args[2] };
    if (method === 'getRpc') {
      const data = args[0];
      return {
        ...data,
        kind: data.isSyscoinRpc ? INetworkType.Syscoin : INetworkType.Ethereum,
        currency: data.symbol.toLowerCase(),
        slip44: data.isSyscoinRpc ? 2 : 60,
      };
    }
    return undefined;
  });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(() => ({
      matches: false,
      addListener: jest.fn(),
      removeListener: jest.fn(),
    })),
  });
});

afterEach(() => {
  globalThis.MessageChannel = originalMessageChannel;
});

const open = async (kind = INetworkType.Ethereum, user = userEvent.setup()) => {
  render(<CustomRPC />);
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getChainData'],
      [INetworkType.Ethereum]
    )
  );
  if (kind === INetworkType.Syscoin)
    await user.click(screen.getByRole('switch'));
  return user;
};

const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  kind: INetworkType,
  afterSelection?: () => Promise<void>
) => {
  const input = screen.getByRole('combobox');
  await user.clear(input);
  await user.type(input, chains[kind].name);
  await user.click(
    await screen.findByRole('option', { name: new RegExp(chains[kind].name) })
  );
  await afterSelection?.();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled()
  );
};

const save = async (
  user: ReturnType<typeof userEvent.setup>,
  method = 'addCustomRpc'
) => {
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(
      mockEmitter.mock.calls.some(([[, called]]) => called === method)
    ).toBe(true)
  );
  const saved = mockEmitter.mock.calls.find(
    ([[, called]]) => called === method
  )![1][0];
  await waitFor(() =>
    expect(mockAlert.success).toHaveBeenCalledWith(
      method === 'addCustomRpc'
        ? 'settings.rpcSuccessfullyAdded'
        : 'settings.rpcSuccessfullyEdited'
    )
  );
  expect(mockAlert.error).not.toHaveBeenCalled();
  return saved;
};

it.each([INetworkType.Ethereum, INetworkType.Syscoin])(
  'saves a fresh %s suggestion with its own explorer',
  async (kind) => {
    const user = await open(kind);
    await choose(user, kind);
    const saved = await save(user);
    expect(saved).toMatchObject({
      kind,
      url: chains[kind].rpc[0].url,
      explorer: chains[kind].explorers[0].url,
    });
  }
);

it.each([
  [INetworkType.Ethereum, INetworkType.Syscoin],
  [INetworkType.Syscoin, INetworkType.Ethereum],
])(
  'a new %s to %s suggestion cannot inherit the old explorer',
  async (from, to) => {
    const user = await open(from);
    await choose(user, from);
    await user.click(screen.getByRole('switch'));
    await choose(user, to);
    const saved = await save(user);
    expect(saved).toMatchObject({
      kind: to,
      url: chains[to].rpc[0].url,
      explorer: chains[to].explorers[0].url,
    });
  }
);

it.each([INetworkType.Ethereum, INetworkType.Syscoin])(
  'preserves an explicit custom explorer entered after a %s selection',
  async (kind) => {
    const user = await open(kind);
    await choose(user, kind);
    fireEvent.change(screen.getByPlaceholderText('settings.explorer'), {
      target: { value: customExplorer },
    });
    expect((await save(user)).explorer).toBe(customExplorer);
  }
);

it.each([INetworkType.Ethereum, INetworkType.Syscoin])(
  'preserves a custom explorer when saving the same %s editor',
  async (kind) => {
    const chain = chains[kind];
    const registered = {
      kind,
      chainId: chain.chainId,
      slip44: kind === INetworkType.Syscoin ? 2 : 60,
      label: chain.name,
      currency: chain.nativeCurrency.symbol.toLowerCase(),
      url: chain.rpc[0].url,
      explorer: customExplorer,
    };
    mockNetworks[kind][chain.chainId] = registered;
    mockLocation.state = {
      isEditing: true,
      selected: { kind, chainId: chain.chainId },
      chain: kind,
    };
    const user = userEvent.setup();
    render(<CustomRPC />);
    expect(screen.getByPlaceholderText('settings.explorer')).toHaveValue(
      customExplorer
    );
    expect((await save(user, 'editCustomRpc')).explorer).toBe(customExplorer);
  }
);

it('keeps the working UTXO fallback instead of the first failed catalogue endpoint', async () => {
  const normal = mockEmitter.getMockImplementation()!;
  const fallback = 'https://fallback-blockbook.example';
  mockEmitter.mockImplementation(async (method, args) => {
    if (method[1] === 'getChainData' && args[0] === INetworkType.Syscoin)
      return [
        { ...chains.syscoin, rpc: [...chains.syscoin.rpc, { url: fallback }] },
      ];
    if (
      method[1] === 'testRpcConnection' &&
      args[0] === chains.syscoin.rpc[0].url
    )
      return { success: false, error: 'Synthetic unavailable endpoint' };
    return normal(method, args);
  });
  jest.useFakeTimers();
  try {
    const user = await open(
      INetworkType.Syscoin,
      userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    );
    await choose(user, INetworkType.Syscoin, async () => {
      // Each catalogue candidate has a real 300 ms presentation delay. Drive
      // both explicitly instead of racing their sum against waitFor's deadline.
      await act(async () => jest.advanceTimersByTimeAsync(300));
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'testRpcConnection'],
        [chains.syscoin.rpc[0].url, INetworkType.Syscoin, 2, 5000, 500]
      );
      expect(
        mockEmitter.mock.calls.some(
          ([[, method], args]) =>
            method === 'testRpcConnection' && args[0] === fallback
        )
      ).toBe(false);
      expect(
        screen.getByRole('button', { name: 'buttons.save' })
      ).toBeDisabled();
      await act(async () => jest.advanceTimersByTimeAsync(300));
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'testRpcConnection'],
        [fallback, INetworkType.Syscoin, 2, 5000, 500]
      );
    });
    const saved = await save(user);
    expect(saved).toMatchObject({
      kind: INetworkType.Syscoin,
      url: fallback,
      explorer: fallback,
    });
  } finally {
    jest.useRealTimers();
  }
});
