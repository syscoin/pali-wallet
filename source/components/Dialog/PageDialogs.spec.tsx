/** @jest-environment jsdom */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { FaucetFirstAccessModal } from 'components/Modal/FaucetFirstAccessModal';
import { ConnectWallet } from 'pages/Connections/ConnectWallet';
import { EditApprovedAllowanceValueModal } from 'pages/Send/EditApprovedAllowanceValueModal';
import ConnectedSites from 'pages/Settings/ConnectedSites';

let mockState: any;
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockCopy = jest.fn();
const mockAlert = { info: jest.fn() };
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const messages = jest.requireActual('../../assets/locales/en.json');
      const message = key
        .split('.')
        .reduce((entry: any, part) => entry?.[part], messages);
      return typeof message === 'string'
        ? message.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name]))
        : key;
    },
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => ({
    host: 'https://untrusted.example',
    chain: 'ethereum',
    chainId: 1,
    eventName: 'connect',
  }),
  useUtils: () => ({
    navigate: mockNavigate,
    alert: mockAlert,
    useCopyClipboard: () => [null, mockCopy],
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('state/vault/selectors', () => ({ selectAccountAssets: () => ({}) }));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <svg aria-hidden="true" />,
  EditIconSvg: () => <svg aria-hidden="true" />,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('../Button/Button').Button,
  IconButton: jest.requireActual('../IconButton/IconButton').IconButton,
  Icon: () => <svg aria-hidden="true" />,
  Modal: jest.requireActual('../Modal/Modal').Modal,
  PageActionFooter: jest.requireActual('../PageActionFooter/PageActionFooter')
    .PageActionFooter,
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/ChainIcon', () => ({
  ChainIcon: () => <svg aria-hidden="true" />,
}));
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: () => <span>Balance</span>,
}));
jest.mock('components/Loading/ListLoadMore', () => ({
  ListLoadMore: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({
  truncate: (value: string) => value,
  ellipsis: (value: string) => value,
}));
jest.mock('utils/navigationState', () => ({ navigateBack: jest.fn() }));

// The real shared dialog and Headless UI manage focus. JSDOM only lacks the
// layout observer used to detect a dialog becoming invisible.
const originalResizeObserver = globalThis.ResizeObserver;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as typeof ResizeObserver;
  // AntD's real Form batches watchers through the browser MessageChannel.
  // Keep its async ordering without creating Node worker ports in JSDOM.
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});
beforeEach(() => {
  mockEmitter.mockReset().mockResolvedValue(null);
  mockNavigate.mockReset();
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        chainId: 1,
        kind: 'ethereum',
        url: 'https://rpc.example',
      },
      isBitcoinBased: false,
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            label: 'Test account',
            address: `0x${'11'.repeat(20)}`,
            balances: { ethereum: 0, syscoin: -1 },
          },
        },
      },
    },
    dapp: {
      dapps: {
        example: {
          host: 'https://untrusted.example',
          accountId: 0,
          accountType: 'HDAccount',
        },
      },
    },
  };
});

it('gives the faucet a named dialog, keyboard dismissal and a trapped action', async () => {
  const user = userEvent.setup();
  const onClose = jest.fn();
  render(<FaucetFirstAccessModal onClose={onClose} />);
  const dialog = screen.getByRole('dialog');
  expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
  const close = within(dialog).getByRole('button', { name: 'Close' });
  close.focus();
  await user.tab();
  const action = within(dialog).getByRole('button', { name: 'Go to Faucet' });
  expect(document.activeElement).toBe(action);
  await user.tab();
  expect(document.activeElement).toBe(close);
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('keeps the faucet action navigation and close ordering unchanged', async () => {
  const user = userEvent.setup();
  const onClose = jest.fn();
  render(<FaucetFirstAccessModal onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: 'Go to Faucet' }));
  expect(mockNavigate).toHaveBeenCalledWith('/faucet');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockNavigate.mock.invocationCallOrder[0]).toBeLessThan(
    onClose.mock.invocationCallOrder[0]
  );
});

it('names connection actions and retains the exact disconnect operation', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ConnectedSites />
    </MemoryRouter>
  );
  await user.click(screen.getByRole('button', { name: 'Edit connection' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit connection' });
  expect(dialog.className).not.toMatch(/\bz-10\b/);
  expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
  await user.click(
    within(dialog).getByRole('button', { name: 'Delete connected site' })
  );
  expect(mockEmitter).toHaveBeenCalledWith(
    ['dapp', 'disconnect'],
    [
      'https://untrusted.example',
      true,
      { allowAlreadyDisconnected: true, propagateErrors: true },
    ]
  );
});

it('closes the connection editor with Escape without disconnecting', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ConnectedSites />
    </MemoryRouter>
  );
  await user.click(screen.getByRole('button', { name: 'Edit connection' }));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

const mountAllowance = () => {
  const setAmount = jest.fn();
  const close = jest.fn();
  render(
    <EditApprovedAllowanceValueModal
      host="https://untrusted.example"
      customApprovedAllowanceAmount={{
        isCustom: false,
        defaultAllowanceValue: '100',
      }}
      approvedTokenInfos={{ tokenDecimals: 8, tokenSymbol: 'TEST' }}
      showModal
      setCustomApprovedAllowanceAmount={setAmount}
      setOpenEditFeeModal={close}
    />
  );
  return { setAmount, close };
};

it('labels the allowance input and preserves the exact edited decimal string', async () => {
  const user = userEvent.setup();
  const { setAmount, close } = mountAllowance();
  const dialog = screen.getByRole('dialog', {
    name: 'Spending limit permission',
  });
  expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
  await user.click(
    within(dialog).getByRole('radio', { name: 'Custom spending limit' })
  );
  const input = within(dialog).getByRole('textbox', {
    name: 'Enter a maximum spending limit',
  });
  await user.type(input, '1.23456789');
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(setAmount).toHaveBeenCalledTimes(1));
  expect(setAmount.mock.calls[0][0]({ isCustom: false })).toEqual({
    isCustom: true,
    customAllowanceValue: '1.23456789',
  });
  expect(close).toHaveBeenCalledWith(false);
  expect(within(dialog).getByText('TEST').className).not.toContain(
    'text-brand-royalblue'
  );
});

it('cancels allowance editing without changing the existing limit', async () => {
  const user = userEvent.setup();
  const { setAmount, close } = mountAllowance();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledWith(false);
  expect(setAmount).not.toHaveBeenCalled();
});

it('retains required custom-limit validation and the proposed-limit save result', async () => {
  const user = userEvent.setup();
  const { setAmount } = mountAllowance();
  await user.click(
    screen.getByRole('radio', { name: 'Custom spending limit' })
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe(
      'true'
    )
  );
  expect(setAmount).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole('radio', { name: 'Proposed approval limit' })
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(setAmount).toHaveBeenCalledTimes(1));
  expect(
    setAmount.mock.calls[0][0]({ isCustom: true, customAllowanceValue: 'old' })
  ).toEqual({ isCustom: false, customAllowanceValue: '' });
});

it('dismisses the untrusted-site warning without approving a connection', async () => {
  const user = userEvent.setup();
  render(<ConnectWallet />);
  const confirm = await screen.findByRole('button', { name: 'Confirm' });
  await waitFor(() =>
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
  );
  await user.click(confirm);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['dapp', 'get'],
    ['https://untrusted.example']
  );
});

it('focuses safe Cancel in the warning and keeps it open while connection is pending', async () => {
  const user = userEvent.setup();
  render(<ConnectWallet />);
  const confirm = await screen.findByRole('button', { name: 'Confirm' });
  await waitFor(() =>
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
  );
  await user.click(confirm);
  const dialog = screen.getByRole('dialog', {
    name: 'Non trusted site detected',
  });
  expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
  await waitFor(() => expect(document.activeElement).toBe(cancel));
  mockEmitter.mockImplementation(() => new Promise(() => undefined));
  await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  expect((cancel as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(document.activeElement || dialog, { key: 'Escape' });
  expect(
    screen.getByRole('dialog', { name: 'Non trusted site detected' })
  ).toBe(dialog);
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['wallet', 'setAccount'],
    [0, 'HDAccount', true, '0x1111111111111111111111111111111111111111']
  );
});
