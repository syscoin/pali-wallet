/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { ConnectWallet } from 'pages/Connections/ConnectWallet';

const mockCopy = jest.fn();
const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
const mockState = {
  vault: {
    accounts: {
      HDAccount: {
        0: {
          id: 0,
          label: 'Alpha',
          address: '0x1111111111111111111111111111111111111111',
          balances: { ethereum: -1, syscoin: -1 },
        },
        1: {
          id: 1,
          label: 'Beta',
          address: '0x2222222222222222222222222222222222222222',
          balances: { ethereum: -1, syscoin: -1 },
        },
      },
    },
    activeAccount: { id: 0, type: 'HDAccount' },
    activeNetwork: {
      chainId: 1,
      kind: 'ethereum',
      url: 'https://rpc.synthetic.invalid',
    },
    isBitcoinBased: false,
  },
};

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
  screen
    .getByText(label, { selector: 'p' })
    .closest('[role="button"]') as HTMLElement;
const selected = (label: string) => row(label).classList.contains('shadow-md');
const copyButton = (label: string) =>
  within(row(label)).getByRole('button', { name: 'transactions.copyAddress' });
const expectNoMutation = () =>
  expect(mockEmitter.mock.calls.map(([methods]) => methods)).toEqual([
    ['dapp', 'get'],
  ]);
const setup = async () => {
  const user = userEvent.setup();
  render(<ConnectWallet />);
  await screen.findByText('Beta');
  expect(selected('Alpha')).toBe(true);
  expect(selected('Beta')).toBe(false);
  expect(row('Alpha')).toHaveAttribute('aria-pressed', 'true');
  expect(row('Beta')).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getAllByRole('button', { pressed: true })).toEqual([
    row('Alpha'),
  ]);
  expect(copyButton('Beta')).toHaveAccessibleName('transactions.copyAddress');
  return user;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'get') return null;
    throw new Error(`Unexpected mutation: ${method}`);
  });
  mockCopy.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('mouse copy copies an unselected address without selecting its account', async () => {
  const user = await setup();
  await user.click(copyButton('Beta'));
  await waitFor(() =>
    expect(mockCopy).toHaveBeenCalledWith(
      mockState.vault.accounts.HDAccount[1].address
    )
  );
  expect(selected('Alpha')).toBe(true);
  expect(selected('Beta')).toBe(false);
  expect(mockAlert.info).toHaveBeenCalledWith('home.addressCopied');
  expectNoMutation();
});

it.each(['{Enter}', ' '])(
  'focused account row remains selectable with keyboard %s',
  async (key) => {
    const user = await setup();
    await user.tab(); // Search.
    await user.tab(); // Alpha row.
    await user.tab(); // Alpha copy.
    await user.tab(); // Beta row.
    expect(row('Beta')).toHaveFocus();
    await user.keyboard(key);
    expect(selected('Beta')).toBe(true);
    expect(selected('Alpha')).toBe(false);
    expect(row('Alpha')).toHaveAttribute('aria-pressed', 'false');
    expect(row('Beta')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', { pressed: true })).toEqual([
      row('Beta'),
    ]);
    expect(mockCopy).not.toHaveBeenCalled();
    expectNoMutation();
  }
);

it.each(['{Enter}', ' '])(
  'keyboard %s copies an unselected address without selecting its account',
  async (key) => {
    const user = await setup();
    await user.tab(); // Search.
    await user.tab(); // Alpha row.
    await user.tab(); // Alpha copy.
    await user.tab(); // Beta row.
    await user.tab(); // Beta copy.
    expect(copyButton('Beta')).toHaveFocus();
    expect(copyButton('Beta')).toHaveClass('focus:opacity-100');
    await user.keyboard(key);
    expect({
      copyCalls: mockCopy.mock.calls.length,
      alphaSelected: selected('Alpha'),
      betaSelected: selected('Beta'),
    }).toEqual({ copyCalls: 1, alphaSelected: true, betaSelected: false });
    expect(mockCopy).toHaveBeenCalledWith(
      mockState.vault.accounts.HDAccount[1].address
    );
    expect(row('Alpha')).toHaveAttribute('aria-pressed', 'true');
    expect(row('Beta')).toHaveAttribute('aria-pressed', 'false');
    expect(mockAlert.info).toHaveBeenCalledWith('home.addressCopied');
    expectNoMutation();
  }
);
