/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';

import en from '../../assets/locales/en.json';

import { SmartAccountSignedOperationOptions } from './TransactionOptions';
import { useSmartAccountCancellation } from './useSmartAccountCancellation';

const ACCOUNT = `0x${'33'.repeat(20)}`;
const PAYER = `0x${'44'.repeat(20)}`;
const OPERATION = `0x${'ab'.repeat(32)}`;
const TRANSACTION = `0x${'11'.repeat(32)}`;
const NONCE = '1427247692705959881058285969449495136382746625';
const mockEmitter = jest.fn();
const mockSubmit = jest.fn();
const mockAlert = {
  error: jest.fn(),
  success: jest.fn(),
  warning: jest.fn(),
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key.split('.').reduce((value: any, part) => value?.[part], en) ?? key,
  }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        activeAccount: { id: 2, type: 'SmartAccount' },
        accounts: {
          SmartAccount: {
            2: {
              address: ACCOUNT,
              isSmartAccount: true,
              smartAccount: { chainId: 57057 },
            },
          },
        },
        activeNetwork: {
          chainId: 57057,
          currency: 'sys',
          url: 'https://test.rpc',
        },
        isBitcoinBased: false,
      },
      vaultGlobal: { activeSlip44: 60 },
    }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({ account: 'smart', network: 'sys' }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('utils/smartAccount/execution', () => ({
  getSmartAccountLocalOwnerContexts: jest.fn(),
  signAndSubmitSmartAccountExecutions: (...args: any[]) => mockSubmit(...args),
}));
jest.mock('components/Icon/Icon', () => ({
  Icon: () => null,
  LoadingSvg: () => null,
  MdBugReport: () => null,
  TrashIconSvg: () => null,
}));

const reviewedQuote = {
  executionContextId: 'reviewed-cancellation',
  feePayer: { id: 3, type: 'HDAccount', address: PAYER },
  gasUnits: '600000',
  maximumFeeWei: '3000000000000000',
  cancellationPayerBudget: {
    gasTank: false,
    maximumFeeWei: '4000000000000000',
    maximumPrefundWei: '1200000000000000',
    maximumPrefundFeeWei: '100000000000000',
  },
};

function prepare(originalHash: string, entryPointFeeQuote: unknown) {
  mockEmitter.mockResolvedValueOnce(7).mockResolvedValueOnce({
    accountId: 2,
    accountAddress: ACCOUNT,
    smartAccount: { chainId: 57057 },
    executionContextId: reviewedQuote.executionContextId,
    entryPointFeeQuote,
    executions: [{ target: ACCOUNT, data: '0x', value: '0' }],
    operationCancellation: {
      originalHash,
      operationHash: OPERATION,
      operationNonce: NONCE,
    },
  });
}

function Harness({ originalHash }: { originalHash: string }) {
  const cancellation = useSmartAccountCancellation(originalHash);
  return (
    <>
      <button type="button" onClick={() => void cancellation.request()}>
        Request cancellation
      </button>
      {cancellation.content}
    </>
  );
}

const originalResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

beforeEach(() => {
  mockEmitter.mockReset();
  mockSubmit.mockReset();
  Object.values(mockAlert).forEach((alert) => alert.mockClear());
});

it('reviews the complete fee budget before signing and submits after one confirmation', async () => {
  prepare(TRANSACTION, reviewedQuote);
  mockSubmit.mockResolvedValue({});
  render(<Harness originalHash={TRANSACTION} />);
  fireEvent.click(screen.getByRole('button', { name: 'Request cancellation' }));
  const dialog = await screen.findByRole('dialog', {
    name: en.header.cancelTx,
  });
  const review = within(dialog);
  expect(dialog).toHaveAccessibleDescription(
    en.transactions.smartAccountCancelReviewDescription
  );
  expect(review.getByText(ACCOUNT)).toBeVisible();
  expect(review.getByText(PAYER)).toBeVisible();
  for (const [label, amount] of [
    [en.send.smartAccountMaxFee, '0.003 SYS'],
    [en.transactions.smartAccountCancelMaximumReplacementFee, '0.004 SYS'],
    [en.transactions.smartAccountCancelMaximumDeposit, '0.0012 SYS'],
    [en.transactions.smartAccountCancelMaximumDepositFee, '0.0001 SYS'],
  ]) {
    expect(review.getByText(label).nextElementSibling).toHaveTextContent(
      amount
    );
  }
  const details = review
    .getByText(en.transactions.technicalDetails)
    .closest('details')!;
  expect(details.open).toBe(false);
  details.open = true;
  expect(within(details).getByText(TRANSACTION)).toBeVisible();
  expect(within(details).getByText(OPERATION)).toBeVisible();
  expect(within(details).getByText(NONCE)).toBeVisible();
  expect(mockSubmit).not.toHaveBeenCalled();

  fireEvent.click(
    review.getByRole('button', { name: en.transactions.smartAccountCancelSign })
  );
  await waitFor(() =>
    expect(mockAlert.success).toHaveBeenCalledWith(
      en.transactions.transactionCancelSubmitted
    )
  );
  expect(mockSubmit).toHaveBeenCalledTimes(1);
  const submission = mockSubmit.mock.calls[0][0];
  expect(submission.approvedFeeQuote).toBe(reviewedQuote);
  expect(submission.expectedContext).toMatchObject({
    chainId: 57057,
    sessionGeneration: 7,
  });
  expect(submission).not.toHaveProperty('feeConsent');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('dismisses without signing and shows one hash when both references match', async () => {
  const originalHash = `0x${OPERATION.slice(2).toUpperCase()}`;
  prepare(originalHash, {
    ...reviewedQuote,
    cancellationPayerBudget: {
      ...reviewedQuote.cancellationPayerBudget,
      gasTank: true,
      maximumPrefundWei: '0',
      maximumPrefundFeeWei: '0',
    },
  });
  render(<Harness originalHash={originalHash} />);
  fireEvent.click(screen.getByRole('button', { name: 'Request cancellation' }));
  const dialog = within(await screen.findByRole('dialog'));
  const details = dialog
    .getByText(en.transactions.technicalDetails)
    .closest('details')!;
  details.open = true;
  expect(within(details).getByText(OPERATION)).toBeVisible();
  expect(within(details).queryByText(originalHash)).not.toBeInTheDocument();
  expect(
    dialog.getByText(en.settings.smartAccountFeeReviewGasTank)
      .nextElementSibling
  ).toHaveTextContent('0.004 SYS');
  expect(
    dialog.queryByText(en.transactions.smartAccountCancelMaximumDeposit)
  ).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: en.buttons.cancel }));
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it('opens the existing cancellation review from a signed-only operation menu', async () => {
  prepare(OPERATION, reviewedQuote);
  render(<SmartAccountSignedOperationOptions operationHash={OPERATION} />);
  fireEvent.click(
    screen.getByRole('button', { name: en.transactions.transactionOptions })
  );
  const menu = within(screen.getByRole('menu'));
  expect(menu.getAllByRole('menuitem')).toHaveLength(1);
  fireEvent.click(menu.getByRole('menuitem', { name: en.buttons.cancel }));
  await screen.findByRole('dialog', { name: en.header.cancelTx });
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['wallet', 'prepareSmartAccountCancellation'],
    [
      { originalHash: OPERATION, operationHash: OPERATION },
      2,
      expect.any(Object),
    ],
    300000,
    false
  );
  expect(mockSubmit).not.toHaveBeenCalled();
});

it('blocks review and signing when the payer budget is missing', async () => {
  prepare(TRANSACTION, {
    ...reviewedQuote,
    cancellationPayerBudget: undefined,
  });
  render(<Harness originalHash={TRANSACTION} />);
  fireEvent.click(screen.getByRole('button', { name: 'Request cancellation' }));
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith(
      en.transactions.smartAccountCancelUnavailable
    )
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mockSubmit).not.toHaveBeenCalled();
});

it('reports a signed cancellation if submission fails after owner authorization', async () => {
  prepare(TRANSACTION, reviewedQuote);
  mockSubmit.mockImplementation(async ({ onAssertionResolved }) => {
    onAssertionResolved();
    throw new Error('Current payer fee exceeds the approved maximum');
  });
  render(<Harness originalHash={TRANSACTION} />);
  fireEvent.click(screen.getByRole('button', { name: 'Request cancellation' }));
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.click(
    dialog.getByRole('button', { name: en.transactions.smartAccountCancelSign })
  );
  await waitFor(() =>
    expect(mockAlert.warning).toHaveBeenCalledWith(
      en.transactions.smartAccountCancelSigned
    )
  );
  expect(mockAlert.warning).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByText(en.transactions.smartAccountCancelSigned)
  ).toBeNull();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
