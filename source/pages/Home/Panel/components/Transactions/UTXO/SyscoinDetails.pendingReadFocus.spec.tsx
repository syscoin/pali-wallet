/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { ISysTransaction } from 'scripts/Background/controllers/transactions/types';

import { SyscoinTransactionDetails } from './SyscoinDetails';

let mockState: any;
let mockHash: string;
let mockSequence = 0;
const mockEmitter = jest.fn();
const mockCopy = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard'
);

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (copyKey: string, copyValues?: any) =>
      jest
        .requireActual('../../../../../../../tests/helpers/localizedUiCopy')
        .localizedUiCopy(copyKey, copyValues) ??
      (((key: string) => key) as any)(copyKey, copyValues),
    i18n: { language: 'en' },
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useTransactionsListConfig: jest.requireActual(
    'pages/Home/Panel/components/Transactions/utils/useTransactionsInfos'
  ).useTransactionsListConfig,
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockState.scope,
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  ArrowUpSvg: () => null,
  ReceivedArrowSvg: () => null,
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('utils/index', () => ({
  camelCaseToText: jest.requireActual('utils/format').camelCaseToText,
  ellipsis: jest.requireActual('utils/format').ellipsis,
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const transaction = (): ISysTransaction => ({
  txid: mockHash,
  blockHash: 'cc'.repeat(32),
  blockHeight: 100,
  blockTime: 1700000000,
  confirmations: 3,
  fees: '1000',
  hex: '00',
  value: '100000000',
  valueIn: '100001000',
  version: 2,
  direction: 'received',
  addressValueIn: '0',
  addressValueOut: '100000000',
  vin: [
    {
      txid: 'ab'.repeat(32),
      vout: 0,
      n: 0,
      isAddress: true,
      sequence: 0xffffffff,
      addresses: ['synthetic-source-address'],
      value: 100001000,
    },
  ],
  vout: [
    {
      n: 0,
      isAddress: true,
      hex: '00',
      spent: false,
      addresses: ['synthetic-owned-address'],
      value: 100000000,
      isOwn: true,
    },
  ],
});
const hashCopy = () =>
  within(screen.getByText('Transaction ID').parentElement!).getByRole('button');
const userWithClipboard = () => {
  const user = userEvent.setup();
  // userEvent installs its clipboard stub at setup. Observe writes after that
  // installation, rather than holding the stub that setup just replaced.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockCopy },
  });
  return user;
};
const tabToHashCopy = async (user: ReturnType<typeof userEvent.setup>) => {
  for (let i = 0; i < 12 && document.activeElement !== hashCopy(); i += 1)
    await user.tab();
  expect(document.activeElement).toBe(hashCopy());
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockReset();
  mockCopy.mockReset().mockResolvedValue(undefined);
  mockHash = 'da' + (++mockSequence).toString(16).padStart(62, '0');
  mockState = {
    scope: {
      account: 'synthetic-account',
      network: `synthetic-network-${mockSequence}`,
    },
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [] } } },
      isBitcoinBased: true,
      activeNetwork: {
        currency: 'tsys',
        chainId: 5700,
        url: 'https://synthetic.invalid/',
      },
    },
  };
});
afterAll(() => {
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as any).clipboard;
});

it('keeps the keyboard-focused hash copy control when the ordinary full transaction read completes', async () => {
  const user = userWithClipboard();
  const pending = deferred<ISysTransaction>();
  mockEmitter.mockReturnValue(pending.promise);
  const tx = transaction();
  render(<SyscoinTransactionDetails hash={mockHash} tx={tx} />);
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getSysTransactionFromBlockbook'],
      [mockHash, mockState.vault.activeNetwork.url]
    )
  );
  await tabToHashCopy(user);
  const before = hashCopy();
  await act(async () =>
    pending.resolve({ ...tx, confirmations: 4, blockHeight: 101 })
  );
  expect(
    within(screen.getByText('Confirmations').parentElement!).getByText('4')
  ).toBeVisible();
  expect(document.activeElement).toBe(hashCopy());
  expect(hashCopy()).toBe(before);
  await user.keyboard('{Enter}');
  expect(mockCopy).toHaveBeenCalledTimes(1);
  expect(mockCopy).toHaveBeenCalledWith(mockHash);
});

it('supports native Tab and Enter to copy while the full read is still pending', async () => {
  const user = userWithClipboard();
  const pending = deferred<ISysTransaction>();
  mockEmitter.mockReturnValue(pending.promise);
  const tx = transaction();
  render(<SyscoinTransactionDetails hash={mockHash} tx={tx} />);
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  await tabToHashCopy(user);
  await user.keyboard('{Enter}');
  expect(mockCopy).toHaveBeenCalledTimes(1);
  expect(mockCopy).toHaveBeenCalledWith(mockHash);
  expect(document.activeElement).toBe(hashCopy());
  await act(async () => pending.resolve({ ...tx }));
});

it('supports native keyboard and pointer copy after a healthy completed read', async () => {
  const user = userWithClipboard();
  const tx = transaction();
  mockEmitter.mockResolvedValue({ ...tx });
  render(<SyscoinTransactionDetails hash={mockHash} tx={tx} />);
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  await act(async () => undefined);
  await tabToHashCopy(user);
  await user.keyboard('{Enter}');
  expect(mockCopy).toHaveBeenLastCalledWith(mockHash);
  await user.click(hashCopy());
  expect(mockCopy).toHaveBeenCalledTimes(2);
  expect(mockCopy).toHaveBeenLastCalledWith(mockHash);
});
