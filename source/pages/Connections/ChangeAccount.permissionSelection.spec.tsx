/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import DAppController from 'scripts/Background/controllers/DAppController';
import dappReducer from 'state/dapp';
import { KeyringAccountType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';

import { ChangeAccount } from './ChangeAccount';

let mockState: any;
let mockQuery: any;
const mockEmitter = jest.fn();
let mockConfirm: () => Promise<void>;
let mockBeforeGrant: (() => void) | undefined;
const mockCopy = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({
    alert: mockAlert,
    useCopyClipboard: () => [null, mockCopy],
  }),
}));
jest.mock('state/vault/selectors', () => ({ selectAccountAssets: () => ({}) }));
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: 'account-balance',
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: 'loading' }));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled }: any) => {
    if (children === 'buttons.confirm') mockConfirm = onClick;
    return (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    );
  },
  Icon: 'icon',
  IconButton: 'button',
  Tooltip: 'tooltip',
}));
jest.mock('components/Loading/ListLoadMore', () => ({
  ListLoadMore: 'load-more',
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: 'token-icon' }));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

const mockDispatch = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => mockDispatch(action),
  },
  saveMainState: jest.fn(async () => true),
  persistMainStateStrict: jest.fn(async () => undefined),
}));
jest.mock('scripts/Background/notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/message-handler/provider-cache',
  () => ({ clearProviderCache: jest.fn() })
);
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
const host = 'https://synthetic.invalid';
const makeAccount = (id: number) => ({
  id,
  xpub: 'public-xpub-' + id,
  address: '0x' + String(id + 1).repeat(40),
  label: 'Account ' + id,
  balances: { ethereum: 1 },
});
beforeEach(() => {
  jest.clearAllMocks();
  mockBeforeGrant = undefined;
  mockState = {
    dapp: { dapps: {} },
    vault: {
      accounts: { HDAccount: { 0: makeAccount(0), 1: makeAccount(1) } },
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: {
        chainId: 1,
        kind: 'ethereum',
        url: 'https://synthetic.invalid',
        slip44: 60,
      },
      isBitcoinBased: false,
    },
  };
  mockQuery = {
    host,
    eventName: 'requestPermissions',
    currentAccountId: 1,
    currentAccountType: KeyringAccountType.HDAccount,
  };
  mockDispatch.mockImplementation((action) => {
    mockState = { ...mockState, dapp: dappReducer(mockState.dapp, action) };
  });
  (chrome.runtime as any).id = 'pali';
  (chrome as any).tabs = { query: jest.fn((_q, cb) => cb([])) };
  (chrome as any).scripting = { executeScript: jest.fn(async () => []) };
  const controller = DAppController(() => true);
  mockEmitter.mockImplementation(async (path, args) => {
    if (path[0] === 'dapp') {
      mockBeforeGrant?.();
      mockBeforeGrant = undefined;
      return (controller as any)[path[1]](...args);
    }
    if (path[1] === 'setAccount') {
      if (!mockState.vault.accounts[args[1]]?.[args[0]])
        throw new Error('Account not found');
      return;
    }
    throw new Error('Unexpected controller method');
  });
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
it('healthy permission selection emits its actual controller response', async () => {
  render(<ChangeAccount />);
  await act(async () => fireEvent.click(screen.getByText('buttons.confirm')));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['dapp', 'requestPermissions'],
    [
      host,
      1,
      KeyringAccountType.HDAccount,
      expect.objectContaining({ address: makeAccount(1).address }),
    ]
  );
  expect(mockState.dapp.dapps[host].accountId).toBe(1);
  expect(dispatchBackgroundEvent).toHaveBeenCalled();
});
it('removing a selected account while approval is open must not create a permission', async () => {
  const view = render(<ChangeAccount />);
  mockState = {
    ...mockState,
    vault: {
      ...mockState.vault,
      accounts: { HDAccount: { 0: makeAccount(0) } },
    },
  };
  view.rerender(<ChangeAccount />);
  await act(async () => fireEvent.click(screen.getByText('buttons.confirm')));
  expect(mockState.dapp.dapps[host]).toBeUndefined();
});

it.each([
  'removed',
  'address',
  'xpub',
  'kind',
  'chainId',
  'url',
  'slip44',
  'host',
])(
  'disables and refuses a captured Confirm after %s changes',
  async (change) => {
    const view = render(<ChangeAccount />);
    const oldConfirm = mockConfirm;
    if (change === 'removed') delete mockState.vault.accounts.HDAccount[1];
    else if (change === 'address')
      mockState.vault.accounts.HDAccount[1] = {
        ...makeAccount(1),
        address: '0x' + '3'.repeat(40),
      };
    else if (change === 'xpub')
      mockState.vault.accounts.HDAccount[1] = {
        ...makeAccount(1),
        xpub: 'replacement-public-xpub',
      };
    else if (change === 'host')
      mockQuery = { ...mockQuery, host: 'https://other.invalid' };
    else
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        [change]: 'changed-' + change,
      };
    view.rerender(<ChangeAccount />);
    expect(
      (screen.getByText('buttons.confirm') as HTMLButtonElement).disabled
    ).toBe(true);
    await act(async () => oldConfirm());
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(mockState.dapp.dapps[host]).toBeUndefined();
  }
);

it.each(['address', 'url'])(
  'the real controller rejects a %s change while the approval message is in transit',
  async (change) => {
    render(<ChangeAccount />);
    mockBeforeGrant = () => {
      if (change === 'address')
        mockState.vault.accounts.HDAccount[1] = {
          ...makeAccount(1),
          address: '0x' + '3'.repeat(40),
        };
      else
        mockState.vault.activeNetwork = {
          ...mockState.vault.activeNetwork,
          url: 'https://replacement.invalid',
        };
    };
    await act(async () => mockConfirm());
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockState.dapp.dapps[host]).toBeUndefined();
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  }
);

it.each(['unchanged', 'host', 'network', 'unmount'])(
  'settles the original approval without closing a changed %s view',
  async (change) => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const original = mockEmitter.getMockImplementation()!;
    mockEmitter.mockImplementation((path, args) => {
      if (path[0] === 'wallet' && path[1] === 'setAccount') return pending;
      return original(path, args);
    });
    const view = render(<ChangeAccount />);
    await act(async () => {
      fireEvent.click(screen.getByText('buttons.confirm'));
    });
    expect(mockEmitter).toHaveBeenCalledTimes(2);
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    if (change === 'host')
      mockQuery = { ...mockQuery, host: 'https://new-approval.invalid' };
    if (change === 'network')
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        chainId: 2,
        url: 'https://new-rpc.invalid',
      };
    if (change === 'unmount') view.unmount();
    else view.rerender(<ChangeAccount />);
    await act(async () => finish());
    expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
      `requestPermissions.${host}`,
      expect.any(Array)
    );
    if (change === 'unchanged') {
      expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
      expect(window.close).toHaveBeenCalledTimes(1);
    } else {
      expect(window.close).not.toHaveBeenCalled();
    }
  }
);
