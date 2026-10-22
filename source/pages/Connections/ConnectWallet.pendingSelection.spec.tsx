/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { dispatchBackgroundEvent } from 'utils/browser';

import { ConnectWallet } from './ConnectWallet';

const mockState = {
  vault: {
    accounts: {
      HDAccount: {
        0: {
          id: 0,
          label: 'Alpha',
          address: `0x${'11'.repeat(20)}`,
          balances: { ethereum: -1, syscoin: -1 },
        },
        1: {
          id: 1,
          label: 'Beta',
          address: `0x${'22'.repeat(20)}`,
          balances: { ethereum: -1, syscoin: -1 },
        },
      },
    },
    activeAccount: { id: 0, type: 'HDAccount' },
    activeNetwork: {
      kind: 'ethereum',
      chainId: 1,
      url: 'https://rpc.synthetic.invalid',
    },
    isBitcoinBased: false,
  },
};
const mockEmitter = jest.fn();
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
  useQueryData: () => ({
    host: 'https://bridge.syscoin.org',
    chain: 'ethereum',
    chainId: 1,
    eventName: 'connect',
  }),
  useUtils: () => ({
    alert: mockAlert,
    useCopyClipboard: () => [null, mockCopy],
  }),
}));
jest.mock('state/vault/selectors', () => ({ selectAccountAssets: () => ({}) }));
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: () => null,
}));
jest.mock('components/AccountIdenticon', () => ({
  AccountIdenticon: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <span>Loading</span>,
}));
jest.mock('components/index', () => ({
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  Button: jest.requireActual('components/Button/Button').Button,
  Icon: ({ name }: any) => <span aria-hidden="true" data-icon={name} />,
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Dialog/Dialog', () => ({
  DialogPrimitive: () => null,
  CenterPanel: ({ children }: any) => children,
  DialogActions: ({ children }: any) => children,
  DialogBody: ({ children }: any) => children,
  DialogFooter: ({ children }: any) => children,
  DialogHeader: () => null,
  DialogActionButton: () => null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/TokenIcon', () => ({
  getAccountReviewTokens: jest.requireActual('components/TokenIcon')
    .getAccountReviewTokens,
  TokenIconStack: () => null,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

const row = (label: string) =>
  screen.getByText(label).closest('[role="button"]') as HTMLElement;
const selected = (label: string) => row(label).classList.contains('shadow-md');
const copyButton = (label: string) =>
  within(row(label)).getByRole('button', { name: 'transactions.copyAddress' });
const confirm = () => screen.getByRole('button', { name: 'buttons.confirm' });
const cancel = () => screen.getByRole('button', { name: 'buttons.cancel' });
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
type PendingStage = 'setAccount' | 'connect';
const holdStage = (stage: PendingStage) => {
  const gate = deferred();
  const invoke = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((methods, args) =>
    methods[1] === stage ? gate.promise : invoke(methods, args)
  );
  return { ...gate, restore: () => mockEmitter.mockImplementation(invoke) };
};
const grantCalls = () =>
  mockEmitter.mock.calls.filter(([methods]) => methods[1] === 'connect');
let close: jest.SpyInstance;
let log: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  close = jest.spyOn(window, 'close').mockImplementation(() => undefined);
  log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockCopy.mockResolvedValue(undefined);
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'get') return null;
    if (method === 'setAccount' || method === 'connect') return undefined;
    throw Error(`Unexpected method ${method}`);
  });
});
afterEach(() => {
  close.mockRestore();
  log.mockRestore();
});
const setup = async () => {
  const user = userEvent.setup();
  render(<ConnectWallet />);
  await screen.findByText('Beta');
  expect(selected('Alpha')).toBe(true);
  return user;
};
const expectEditing = (enabled: boolean) => {
  for (const label of ['Alpha', 'Beta']) {
    expect(row(label)).toHaveAttribute('aria-disabled', String(!enabled));
    expect(row(label).tabIndex).toBe(enabled ? 0 : -1);
    if (enabled) expect(copyButton(label)).toBeEnabled();
    else expect(copyButton(label)).toBeDisabled();
  }
  if (enabled) {
    expect(confirm()).toBeEnabled();
    expect(cancel()).toBeEnabled();
  } else {
    expect(confirm()).toBeDisabled();
    expect(cancel()).toBeDisabled();
  }
};

// The controller boundary is synthetic and held at its actual asynchronous
// methods. These cases prove rendered selection/interaction, not disk writes.
it('grants the account selected before confirmation', async () => {
  const user = await setup();
  expectEditing(true);
  await user.click(row('Beta'));
  expect(selected('Beta')).toBe(true);
  await user.click(confirm());
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(grantCalls()[0][1][0].accountId).toBe(1);
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

it.each(
  (['setAccount', 'connect'] as const).flatMap((stage) =>
    ['pointer', '{Enter}', ' '].map((method) => ({ stage, method }))
  )
)(
  'retains reviewed selection during pending $stage for $method',
  async ({ stage, method }) => {
    const user = await setup();
    const gate = holdStage(stage);
    try {
      await user.click(confirm());
      await waitFor(() =>
        expect(
          mockEmitter.mock.calls.some(([methods]) => methods[1] === stage)
        ).toBe(true)
      );
      expectEditing(false);
      screen
        .getByRole('searchbox', { name: 'connections.searchAccounts' })
        .focus();
      await user.tab();
      expect(
        screen.getByRole('link', { name: 'connections.learnMore' })
      ).toHaveFocus();
      await user.click(copyButton('Beta'));
      expect(mockCopy).not.toHaveBeenCalled();
      if (method === 'pointer') await user.click(row('Beta'));
      else {
        row('Beta').focus();
        await user.keyboard(method);
      }
      expect(selected('Alpha')).toBe(true);
      expect(selected('Beta')).toBe(false);
      expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    } finally {
      await act(async () => gate.resolve());
    }
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(grantCalls()).toHaveLength(1);
    expect(grantCalls()[0][1][0].accountId).toBe(0);
    expect(grantCalls()[0][1][1].address).toBe(
      mockState.vault.accounts.HDAccount[0].address
    );
    expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  }
);

it.each(['setAccount', 'connect'] as const)(
  'restores selection and controls after %s failure for a new retry',
  async (stage) => {
    const user = await setup();
    const gate = holdStage(stage);
    await user.click(confirm());
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.some(([methods]) => methods[1] === stage)
      ).toBe(true)
    );
    await act(async () =>
      gate.reject(new Error('Synthetic persistence failure'))
    );
    expect(mockAlert.error).toHaveBeenCalledWith(
      'Synthetic persistence failure'
    );
    expect(close).not.toHaveBeenCalled();
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expectEditing(true);
    gate.restore();
    await user.click(row('Beta'));
    expect(selected('Beta')).toBe(true);
    await user.click(confirm());
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(grantCalls().at(-1)[1][0].accountId).toBe(1);
    expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  }
);
