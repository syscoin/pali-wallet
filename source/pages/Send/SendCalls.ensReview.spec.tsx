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

import { reviewedDappFeeFixture } from './fixtures/reviewedDappFee';
import { SendCalls } from './SendCalls';

let mockState: any;
let mockQuery: any;
let mockEns: Record<string, string>;
let user: ReturnType<typeof userEvent.setup>;
const mockEmitter = jest.fn();
const mockQuote = jest.fn();
const mockSubmit = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => mockEns,
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled, variant }: any) => (
    <button data-testid={variant} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Icon: () => null,
  Tooltip: jest.requireActual('components/Tooltip').Tooltip,
}));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/navigationState', () => ({
  clearTransactionNavigationState: jest.fn(async () => undefined),
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  prepareSmartAccountFeeQuote: (params: any) => mockQuote(params),
  signAndSubmitSmartAccountExecutions: (params: any) => mockSubmit(params),
  SMART_ACCOUNT_FEE_QUOTE_CHANGED: 'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED',
  isSmartAccountFeeQuoteChanged: () => false,
}));

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TARGET_A = `0x${'22'.repeat(20)}`;
const TARGET_B = `0x${'33'.repeat(20)}`;
const HASH = `0x${'ab'.repeat(32)}`;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const sends = () =>
  mockEmitter.mock.calls.filter(
    ([[, method]]) => method === 'sendAndSaveEthTransaction'
  );
const confirm = (index = 1, total = mockQuery.calls.length) =>
  screen.findByRole('button', { name: `buttons.confirm ${index}/${total}` });
async function tooltip(name: string) {
  await user.click(document.body);
  await user.hover(screen.getByText(name).parentElement!);
  await waitFor(() => expect(screen.getAllByRole('tooltip')).toHaveLength(1));
  return screen.getByRole('tooltip');
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(window, 'close').mockImplementation();
  user = userEvent.setup();
  mockEns = { 'owned.eth': TARGET_A };
  mockState = {
    vault: {
      activeNetwork: { chainId: 1, currency: 'ETH', url: 'rpc-a' },
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { id: 0, address: ACCOUNT } } },
    },
  };
  mockQuery = {
    host: 'https://dapp.example',
    eventName: 'sendCalls',
    bundleId: 'bundle',
    reservationId: 'reservation',
    version: '2.0.0',
    chainId: '0x1',
    atomicRequired: false,
    approvedContext: {
      account: { address: ACCOUNT, id: 0, type: 'HDAccount' },
      chainId: 1,
      rpcUrl: 'rpc-a',
      slip44: 60,
    },
    calls: [{ to: 'owned.eth', value: '0x1' }],
  };
  mockEmitter.mockReset().mockImplementation(async ([, method], args) => {
    if (method === 'getRecommendedNonceForBatch') return 0;
    if (method === 'reviewDappEvmFee') return reviewedDappFeeFixture(args[0]);
    if (method === 'resolveEns') return TARGET_A;
    if (method === 'batchResolveEns')
      return Object.fromEntries(
        args[0].map((name: string) => [name, TARGET_A])
      );
    if (method === 'sendAndSaveEthTransaction') return { hash: HASH };
    return undefined;
  });
  mockQuote.mockReset().mockResolvedValue({
    gasUnits: '21000',
    maximumFeeWei: '42000',
  });
  mockSubmit.mockReset().mockImplementation(async (params) => {
    await params.onBeforeSubmit({ executionContextId: 'execution-context' });
    return { hash: HASH };
  });
});
afterEach(() => jest.restoreAllMocks());

it('keeps the reviewed ENS target through cache changes, confirmation and unknown submission', async () => {
  const submitted = deferred<unknown>();
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, args) =>
    path[1] === 'sendAndSaveEthTransaction'
      ? submitted.promise
      : original(path, args)
  );
  const view = render(<SendCalls />);
  const approve = await confirm();
  mockEns = { 'owned.eth': TARGET_B };
  view.rerender(<SendCalls />);
  const destination = await tooltip('owned.eth');
  const reviewedTarget = destination.textContent;
  fireEvent.click(approve);
  await waitFor(() => expect(sends()).toHaveLength(1));
  expect(sends()[0][1][0].to).toBe(TARGET_A);
  expect(reviewedTarget).toBe(TARGET_A);
  expect(destination).toHaveTextContent(TARGET_A);
  await act(async () => submitted.reject(new Error('Lost broadcast reply')));
  await screen.findAllByText('send.submissionStatusUnknown');
  expect(destination).toHaveTextContent(TARGET_A);
  expect(sends()).toHaveLength(1);
  expect(screen.getByTestId('primary')).toBeDisabled();
});

it.each(['single', 'batch'])(
  'displays the prepared %s ENS lookup without a cache entry',
  async (kind) => {
    mockEns = {};
    if (kind === 'batch') mockQuery.calls.push({ to: 'other.eth' });
    render(<SendCalls />);
    const approve = await confirm();
    expect(await tooltip('owned.eth')).toHaveTextContent(TARGET_A);
    fireEvent.click(approve);
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0][1][0].to).toBe(TARGET_A);
  }
);

it('preserves ordinary address review and submission without resolving a name', async () => {
  mockQuery.calls = [{ to: TARGET_A, value: '0x1' }];
  render(<SendCalls />);
  const approve = await confirm();
  await user.hover(screen.getByText(/0x22222222.*22222222/).parentElement!);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(TARGET_A);
  fireEvent.click(approve);
  await waitFor(() => expect(sends()).toHaveLength(1));
  expect(sends()[0][1][0].to).toBe(TARGET_A);
  expect(
    mockEmitter.mock.calls.some(([[, method]]) => /resolveEns/i.test(method))
  ).toBe(false);
});

it('retains completed destinations while a later call is reviewed and refreshes only the retried call', async () => {
  mockQuery.calls.push({ to: 'later.eth' });
  mockEns['later.eth'] = TARGET_A;
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, args) => {
    if (path[1] === 'sendAndSaveEthTransaction' && sends().length === 2)
      throw Object.assign(new Error('Signer canceled'), {
        transactionNotBroadcast: true,
      });
    return original(path, args);
  });
  const view = render(<SendCalls />);
  fireEvent.click(await confirm());
  await confirm(2);
  mockEns = { 'owned.eth': TARGET_B, 'later.eth': TARGET_B };
  view.rerender(<SendCalls />);
  expect(await tooltip('owned.eth')).toHaveTextContent(TARGET_A);
  fireEvent.click(await confirm(2));
  await waitFor(() =>
    expect(screen.getByTestId('primary')).toHaveTextContent(/^send.sign$/)
  );
  fireEvent.click(screen.getByTestId('primary'));
  await confirm(2);
  expect(await tooltip('later.eth')).toHaveTextContent(TARGET_B);
  fireEvent.click(await confirm(2));
  await waitFor(() => expect(sends()).toHaveLength(3));
  expect(sends().map(([, args]) => args[0].to)).toEqual([
    TARGET_A,
    TARGET_A,
    TARGET_B,
  ]);
  expect(await tooltip('owned.eth')).toHaveTextContent(TARGET_A);
});

it('shows the quoted smart-account ENS execution and discards its display authority during refresh', async () => {
  mockState.vault.accounts.HDAccount[0] = {
    id: 0,
    address: ACCOUNT,
    isSmartAccount: true,
    smartAccount: { chainId: 1 },
  };
  mockEns = {};
  const view = render(<SendCalls />);
  await waitFor(() => expect(screen.getByTestId('primary')).toBeEnabled());
  const destination = await tooltip('owned.eth');
  expect(destination).toHaveTextContent(TARGET_A);
  const refresh = deferred<unknown>();
  mockQuote.mockReturnValue(refresh.promise);
  mockEns = { 'owned.eth': TARGET_B };
  view.rerender(<SendCalls />);
  expect(screen.getByTestId('primary')).toBeDisabled();
  expect(destination).toHaveTextContent('owned.eth');
  expect(destination).not.toHaveTextContent(TARGET_A);
  expect(destination).not.toHaveTextContent(TARGET_B);
  await act(async () =>
    refresh.resolve({ gasUnits: '21000', maximumFeeWei: '43000' })
  );
  await waitFor(() => expect(screen.getByTestId('primary')).toBeEnabled());
  expect(destination).toHaveTextContent(TARGET_B);
  fireEvent.click(screen.getByTestId('primary'));
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  expect(mockSubmit.mock.calls[0][0].executions).toEqual([
    { target: TARGET_B, data: '0x', value: '0x1' },
  ]);
  await waitFor(() =>
    expect(screen.getByText(/send.sent/)).toBeInTheDocument()
  );
  expect(destination).toHaveTextContent(TARGET_B);
  mockEns = { 'owned.eth': TARGET_A };
  view.rerender(<SendCalls />);
  expect(destination).toHaveTextContent(TARGET_B);
});

it.each(['signing', 'sending'])(
  'retains the approved smart-account target while %s despite a newer quote',
  async (phase) => {
    mockState.vault.accounts.HDAccount[0] = {
      id: 0,
      address: ACCOUNT,
      isSmartAccount: true,
      smartAccount: { chainId: 1 },
    };
    const submitted = deferred<{ hash: string }>();
    mockSubmit.mockImplementation(async (params) => {
      if (phase === 'sending') params.onAssertionResolved();
      await params.onBeforeSubmit({ executionContextId: 'execution-context' });
      return submitted.promise;
    });
    const view = render(<SendCalls />);
    await waitFor(() => expect(screen.getByTestId('primary')).toBeEnabled());
    const destination = await tooltip('owned.eth');
    expect(destination).toHaveTextContent(TARGET_A);
    fireEvent.click(screen.getByTestId('primary'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0][0].executions[0].target).toBe(TARGET_A);
    mockEns = { 'owned.eth': TARGET_B };
    view.rerender(<SendCalls />);
    await waitFor(() => expect(mockQuote).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText('send.calculating')).not.toBeInTheDocument()
    );
    expect(mockQuote.mock.calls[1][0].executions[0].target).toBe(TARGET_B);
    expect(destination).toHaveTextContent(TARGET_A);
    expect(screen.getByTestId('primary')).toBeDisabled();
    await act(async () => submitted.resolve({ hash: HASH }));
    await screen.findByText(/send.sent/);
    expect(destination).toHaveTextContent(TARGET_A);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  }
);
