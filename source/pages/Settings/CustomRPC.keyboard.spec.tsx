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

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockLocation = { pathname: '/settings/networks/custom-rpc', state: {} };
const originalMessageChannel = globalThis.MessageChannel;
const chains = [
  {
    name: 'Keyboard Alpha',
    chainId: 71,
    nativeCurrency: { symbol: 'ALPHA' },
    rpc: [{ url: 'https://alpha.example' }],
    explorers: [],
  },
  {
    name: 'Keyboard Beta',
    chainId: 72,
    nativeCurrency: { symbol: 'BETA' },
    rpc: [{ url: 'https://beta.example' }],
    explorers: [],
  },
];

jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vaultGlobal: { networks: { syscoin: {}, ethereum: {} } } }),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: mockNavigate,
    alert: mockAlert,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ isUnlocked: true }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({}),
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
  mockAlert.error.mockReset();
  mockAlert.success.mockReset();
  // AntD's real Form batches field watchers using this browser API.
  globalThis.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
  mockEmitter.mockReset().mockImplementation(async ([, method]) => {
    if (method === 'getChainData') return chains;
    if (method === 'testRpcConnection') return { success: true, chainId: 72 };
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

async function openSuggestions() {
  const user = userEvent.setup();
  const view = render(<CustomRPC />);
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getChainData'],
      [INetworkType.Ethereum]
    )
  );
  const input = screen.getByRole('combobox', { name: 'settings.label' });
  await user.type(input, 'Keyboard');
  await screen.findByRole('option', { name: /Keyboard Alpha/ });
  return { user, input, ...view };
}

it('selects a suggestion with arrows and Enter while retaining combobox focus', async () => {
  const { user, input } = await openSuggestions();
  const alpha = screen.getByRole('option', { name: /Keyboard Alpha/ });
  const beta = screen.getByRole('option', { name: /Keyboard Beta/ });
  expect(input).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard('{ArrowDown}');
  expect(alpha).toHaveAttribute('aria-selected', 'true');
  expect(input).toHaveAttribute('aria-activedescendant', alpha.id);
  await user.keyboard('{ArrowDown}');
  expect(beta).toHaveAttribute('aria-selected', 'true');
  await user.keyboard('{ArrowDown}');
  expect(alpha).toHaveAttribute('aria-selected', 'true');
  await user.keyboard('{ArrowUp}');
  expect(beta).toHaveAttribute('aria-selected', 'true');
  await user.keyboard('{Enter}');
  expect(input).toHaveValue('Keyboard Beta');
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(mockEmitter).not.toHaveBeenCalledWith(
    ['wallet', 'addCustomRpc'],
    expect.anything()
  );
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'testRpcConnection'],
      ['https://beta.example', INetworkType.Ethereum, 72, 5000, 500]
    )
  );
});

it('dismisses with Escape and Tab without changing the form or reopening later', async () => {
  const { user, input } = await openSuggestions();
  await user.keyboard('{ArrowUp}');
  await user.keyboard('{Escape}');
  expect(input).toHaveFocus();
  expect(input).toHaveValue('Keyboard');
  expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(input).not.toHaveAttribute('aria-activedescendant');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await user.keyboard('{ArrowDown}');
  expect(input).toHaveAttribute('aria-expanded', 'true');
  await user.tab();
  expect(input).not.toHaveFocus();
  expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(
    mockEmitter.mock.calls.every(([[, method]]) => method === 'getChainData')
  ).toBe(true);
});

it('selects the first suggestion on Enter, and ignores IME composition', async () => {
  const { input } = await openSuggestions();
  expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(
    true
  );
  expect(input).toHaveValue('Keyboard');
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
  expect(input).toHaveValue('Keyboard Alpha');
  expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('keeps pointer selection working and clears old options on an empty query', async () => {
  const { user, input } = await openSuggestions();
  await user.clear(input);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await user.type(input, 'Keyboard');
  await user.click(screen.getByRole('option', { name: /Keyboard Beta/ }));
  expect(input).toHaveValue('Keyboard Beta');
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('dismisses the old family and supports keyboard selection for UTXO networks', async () => {
  const { user, input } = await openSuggestions();
  await user.click(screen.getByRole('switch'));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getChainData'],
      [INetworkType.Syscoin]
    )
  );
  expect(input).toHaveAttribute('aria-expanded', 'false');
  await user.clear(input);
  await user.type(input, 'Keyboard');
  await user.keyboard('{ArrowUp}{Enter}');
  expect(input).toHaveValue('Keyboard Beta');
  expect(input).toHaveAttribute('aria-expanded', 'false');
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'testRpcConnection'],
      ['https://beta.example', INetworkType.Syscoin, 72, 5000, 500]
    )
  );
});

const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it.each([true, false])(
  'discards an old suggestion result after a manual draft change (success=%s)',
  async (success) => {
    const pending = deferred();
    mockEmitter.mockImplementation(async ([, method]) => {
      if (method === 'getChainData')
        return [
          {
            ...chains[0],
            rpc: [
              { url: 'https://alpha.example' },
              { url: 'https://fallback.example' },
            ],
          },
        ];
      if (method === 'testRpcConnection') return pending.promise;
      return undefined;
    });
    const { user, input } = await openSuggestions();
    await user.click(screen.getByRole('option', { name: /Keyboard Alpha/ }));
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.some(
          ([[, method]]) => method === 'testRpcConnection'
        )
      ).toBe(true)
    );
    const save = screen.getByRole('button', { name: 'buttons.save' });
    expect(save).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'Replacement');
    const chainId = screen.getByPlaceholderText('settings.chainIdCustomEvm');
    fireEvent.change(chainId, { target: { value: '12345' } });
    const url = screen.getByPlaceholderText('settings.rpcUrlPlaceholder');
    fireEvent.change(url, { target: { value: 'https://replacement.example' } });
    expect(save).toBeEnabled();
    await act(async () =>
      pending.resolve(
        success
          ? { success: true, chainId: 71 }
          : { success: false, error: 'Synthetic failure' }
      )
    );
    expect(input).toHaveValue('Replacement');
    expect(chainId).toHaveValue('12345');
    expect(url).toHaveValue('https://replacement.example');
    expect(
      mockEmitter.mock.calls.filter(
        ([[, method]]) => method === 'testRpcConnection'
      )
    ).toHaveLength(1);
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it('retains the normal fallback and successful cleanup for the current unedited suggestion', async () => {
  mockEmitter.mockImplementation(async ([, method], args) => {
    if (method === 'getChainData')
      return [
        {
          ...chains[0],
          rpc: [
            { url: 'https://alpha.example' },
            { url: 'https://fallback.example' },
          ],
        },
      ];
    if (method === 'testRpcConnection')
      return args[0] === 'https://alpha.example'
        ? { success: false, requiresAuth: true }
        : { success: true, chainId: 71 };
    return undefined;
  });
  const { user, input } = await openSuggestions();
  await user.click(screen.getByRole('option', { name: /Keyboard Alpha/ }));
  await waitFor(() => expect(mockAlert.success).toHaveBeenCalledTimes(1));
  expect(input).toHaveValue('Keyboard Alpha');
  expect(screen.getByPlaceholderText('settings.rpcUrlPlaceholder')).toHaveValue(
    'https://fallback.example'
  );
  expect(screen.getByPlaceholderText('settings.chainIdCustomEvm')).toHaveValue(
    '71'
  );
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'testRpcConnection'
    )
  ).toHaveLength(2);
});

it('does not let an older completion clear a newer selection progress', async () => {
  const alpha = deferred();
  const beta = deferred();
  mockEmitter.mockImplementation(async ([, method], args) => {
    if (method === 'getChainData') return chains;
    if (method === 'testRpcConnection')
      return args[0] === 'https://alpha.example' ? alpha.promise : beta.promise;
    return undefined;
  });
  const { user, input } = await openSuggestions();
  await user.click(screen.getByRole('option', { name: /Keyboard Alpha/ }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'testRpcConnection'],
      ['https://alpha.example', INetworkType.Ethereum, 71, 5000, 500]
    )
  );
  await user.clear(input);
  await user.type(input, 'Keyboard');
  await user.click(screen.getByRole('option', { name: /Keyboard Beta/ }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'testRpcConnection'],
      ['https://beta.example', INetworkType.Ethereum, 72, 5000, 500]
    )
  );
  await act(async () => alpha.resolve({ success: true, chainId: 71 }));
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
  expect(screen.getByPlaceholderText('settings.rpcUrlPlaceholder')).toHaveValue(
    'https://beta.example'
  );
  expect(mockAlert.success).not.toHaveBeenCalled();
  await act(async () => beta.resolve({ success: true, chainId: 72 }));
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
  expect(mockAlert.success).toHaveBeenCalledTimes(1);
});

it.each(['family', 'unmount'])(
  'silences a pending check after %s cancellation',
  async (action) => {
    const pending = deferred();
    mockEmitter.mockImplementation(async ([, method]) => {
      if (method === 'getChainData') return chains;
      if (method === 'testRpcConnection') return pending.promise;
      return undefined;
    });
    const { user, unmount } = await openSuggestions();
    await user.click(screen.getByRole('option', { name: /Keyboard Alpha/ }));
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.some(
          ([[, method]]) => method === 'testRpcConnection'
        )
      ).toBe(true)
    );
    if (action === 'family') {
      await user.click(screen.getByRole('switch'));
      expect(
        screen.getByRole('button', { name: 'buttons.save' })
      ).toBeEnabled();
    } else unmount();
    await act(async () => pending.resolve({ success: true, chainId: 9999 }));
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
    if (action === 'family')
      expect(
        screen.getByPlaceholderText('settings.chainIdAutoDetectedUtxo')
      ).toHaveValue('71');
  }
);

it('discards a late chain-list load for the previous network family', async () => {
  const old = deferred();
  mockEmitter.mockImplementation(async ([, method], args) => {
    if (method === 'getChainData')
      return args[0] === INetworkType.Ethereum ? old.promise : [chains[1]];
    return undefined;
  });
  const user = userEvent.setup();
  render(<CustomRPC />);
  await user.click(screen.getByRole('switch'));
  const input = screen.getByRole('combobox');
  await user.type(input, 'Keyboard');
  expect(
    await screen.findByRole('option', { name: /Keyboard Beta/ })
  ).toBeVisible();
  await act(async () => old.resolve([chains[0]]));
  expect(screen.getByRole('option', { name: /Keyboard Beta/ })).toBeVisible();
  expect(
    screen.queryByRole('option', { name: /Keyboard Alpha/ })
  ).not.toBeInTheDocument();
});

it('discards a URL blur validation result when the URL is replaced', async () => {
  const pending = deferred();
  mockEmitter.mockImplementation(async ([, method]) => {
    if (method === 'getChainData') return chains;
    if (method === 'getRpc') return pending.promise;
    return undefined;
  });
  render(<CustomRPC />);
  const url = screen.getByPlaceholderText('settings.rpcUrlPlaceholder');
  fireEvent.change(url, { target: { value: 'https://old.example' } });
  fireEvent.blur(url);
  await waitFor(() =>
    expect(
      mockEmitter.mock.calls.some(([[, method]]) => method === 'getRpc')
    ).toBe(true)
  );
  fireEvent.change(url, { target: { value: 'https://new.example' } });
  await act(async () => pending.resolve({ chainId: 9999 }));
  expect(url).toHaveValue('https://new.example');
  expect(screen.getByPlaceholderText('settings.chainIdCustomEvm')).toHaveValue(
    ''
  );
  expect(mockAlert.error).not.toHaveBeenCalled();
});
