/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { SendEth } from './SendEth';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockSave = jest.fn();
let mockAssets: any[] = [];
let mockState: any;
const mockLocation = {
  key: 'send',
  pathname: '/send/eth',
  state: undefined as any,
};
const mockStatus = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
const originalResizeObserver = globalThis.ResizeObserver;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockStatus,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ ...mockStatus, controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.fn(),
    alert: { error: jest.fn(), info: jest.fn() },
  }),
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: () => 'https://explorer.invalid',
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  saveNavigationState: (...args: any[]) => mockSave(...args),
}));
jest.mock('utils/index', () => ({
  getWalletNavigationScope: (...args: any[]) =>
    jest
      .requireActual('utils/navigationState')
      .getWalletNavigationScope(...args),
  getAssetBalance: (...args: any[]) =>
    jest.requireActual('utils/transactions').getAssetBalance(...args),
  ellipsis: (...args: any[]) =>
    jest.requireActual('utils/format').ellipsis(...args),
  adjustUrl: (v: string) => v,
  formatFullPrecisionBalance: (...args: any[]) =>
    jest.requireActual('utils/format').formatFullPrecisionBalance(...args),
  createNavigationContext: jest.fn(),
  navigateWithContext: (...args: any[]) => mockNavigate(...args),
  getTokenTypeBadgeColor: () => '',
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountWithAssets: (state: any) => ({
    account:
      state.vault.accounts[state.vault.activeAccount.type][
        state.vault.activeAccount.id
      ],
    assets: { ethereum: mockAssets, syscoin: [] },
  }),
  selectValidEnsCache: () => ({}),
  selectEnsNameToAddress: () => ({}),
}));
jest.mock('components/Icon/Icon', () => ({
  PaliWhiteSmallIconSvg: () => null,
  ArrowDownSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Tooltip: ({ children }: any) => <>{children}</>,
  Icon: () => null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      // JSDOM has no layout.
    }
    unobserve() {
      // JSDOM has no layout.
    }
    disconnect() {
      // JSDOM has no layout.
    }
  } as any;
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as any;
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
  jest.clearAllMocks();
  mockAssets = [];
  mockLocation.state = undefined;
  window.history.replaceState(null, '', '/app.html');
  mockState = {
    vault: {
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: '0x1111111111111111111111111111111111111111',
            xpub: 'public-a',
            balances: { ethereum: '10', syscoin: '10' },
          },
        },
      },
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        url: 'https://rpc.invalid',
        currency: 'eth',
        label: 'Ethereum',
        explorer: 'https://explorer.invalid',
      },
      isBitcoinBased: false,
      accountTransactions: {},
    },
    vaultGlobal: { activeSlip44: 60, isBitcoinBased: false },
  };
  mockSave.mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation();
});
afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

// Keep the actual Form, submit event, Headless UI menu and exported SendEth.
// Only public read replies and the navigation endpoint are synthetic.
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const TOKEN = {
  id: 'verification-token',
  contractAddress: '0x3333333333333333333333333333333333333333',
  chainId: 1,
  tokenSymbol: 'TOKEN',
  tokenStandard: 'ERC-20',
  isNft: false,
  balance: '1',
  decimals: 6,
};
const VERIFIED_TOKEN = { balance: '1000000', decimals: 6 };
type SubmitMethod = 'Next' | 'Enter on focused Next';
type User = ReturnType<typeof userEvent.setup>;
const amount = () =>
  screen.getByPlaceholderText('send.amount') as HTMLInputElement;
const receiver = () => screen.getByPlaceholderText('send.receiver');
const next = () => screen.getByRole('button', { name: 'buttons.next' });
const ensCalls = () =>
  mockEmitter.mock.calls.filter(([method]) => method.at(-1) === 'resolveEns');
const tokenCalls = () =>
  mockEmitter.mock.calls.filter(
    ([method]) => method.at(-1) === 'getERC20TokenInfo'
  );

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mount(
  resolver: Promise<string>,
  tokenInfo: Promise<typeof VERIFIED_TOKEN> = Promise.resolve(VERIFIED_TOKEN)
) {
  mockAssets = [TOKEN];
  mockEmitter.mockImplementation(async (method: string[]) => {
    switch (method.at(-1)) {
      case 'resolveEns':
        return resolver;
      case 'getERC20TokenInfo':
        return tokenInfo;
      case 'getFeeDataWithDynamicMaxPriorityFeePerGas':
        return {
          maxFeePerGas: '1000000000',
          maxPriorityFeePerGas: '100000000',
        };
      case 'refreshActiveAccountBalances':
        return undefined;
      default:
        throw new Error('Forbidden unexpected operation: ' + method.join('.'));
    }
  });
  const user = userEvent.setup();
  render(<SendEth />);
  await waitFor(() => expect(next()).toBeEnabled());
  return user;
}

async function selectToken(user: User) {
  await user.click(screen.getByRole('button', { name: 'ETH' }));
  await user.click(screen.getByRole('menuitem', { name: /TOKEN.*ERC-20/ }));
}

async function selectNative(user: User) {
  await user.click(screen.getByRole('button', { name: 'TOKEN' }));
  await user.click(screen.getByRole('menuitem', { name: /ETH.*send.native/ }));
}

async function enter(user: User, quantity: string) {
  await user.type(receiver(), 'pending.eth');
  await user.type(amount(), quantity);
}

async function submit(user: User, method: SubmitMethod = 'Next') {
  const form = document.getElementById('send-form') as HTMLFormElement;
  const submitButton = next() as HTMLButtonElement;
  const events: Array<{
    ensCallsAtSubmit: number;
    formId: string;
    submitterId: string | undefined;
  }> = [];
  const activations: string[] = [];
  expect(submitButton.type).toBe('submit');
  expect(submitButton.form).toBe(form);
  const observe = (event: Event) => {
    events.push({
      ensCallsAtSubmit: ensCalls().length,
      formId: (event.target as HTMLFormElement).id,
      submitterId: (event as SubmitEvent).submitter?.id,
    });
  };
  const observeActivation = () => activations.push(submitButton.id);
  form.addEventListener('submit', observe, true);
  submitButton.addEventListener('click', observeActivation, true);
  try {
    if (method === 'Next') await user.click(submitButton);
    else {
      // This covers keyboard activation of the real submit button, not the
      // environment-dependent implicit Enter behavior of a number input or
      // the separate Headless UI menu's deferred Tab/focus restoration.
      submitButton.focus();
      expect(submitButton).toHaveFocus();
      await user.keyboard('{Enter}');
    }
  } finally {
    form.removeEventListener('submit', observe, true);
    submitButton.removeEventListener('click', observeActivation, true);
  }
  expect(activations).toEqual(['send-eth-next-btn']);
  expect(events).toHaveLength(1);
  expect(events[0].formId).toBe('send-form');
  // This JSDOM version emits Event, not SubmitEvent, from requestSubmit.
  // The observed native button click + associated form submit establish the
  // path without inventing submitter metadata absent from this environment.
  console.info(
    'native_send_submit=' +
      JSON.stringify({ method, activations, ...events[0] })
  );
  return events[0];
}

async function beginPendingNative(
  user: User,
  method: SubmitMethod = 'Next',
  quantity = '2'
) {
  await enter(user, quantity);
  const event = await submit(user, method);
  // Change/blur validation can already be awaiting the same resolver. Require
  // the fresh validation after this actual DOM submit before changing assets.
  await waitFor(() =>
    expect(ensCalls().length).toBeGreaterThan(event.ensCallsAtSubmit)
  );
  expect(mockNavigate).not.toHaveBeenCalled();
}

async function expectPreview(expectedAmount: string, token: boolean) {
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
  expect(mockNavigate.mock.calls[0][1]).toBe('/send/confirm');
  expect(mockNavigate.mock.calls[0][2].tx).toMatchObject({
    sender: '0x1111111111111111111111111111111111111111',
    amount: expectedAmount,
    receivingAddress: RECIPIENT,
    isMax: false,
    token: token
      ? {
          contractAddress: TOKEN.contractAddress,
          decimals: 6,
          tokenSymbol: 'TOKEN',
        }
      : null,
  });
}

async function correctAndResubmitToken(user: User) {
  await waitFor(() => expect(amount()).toBeEnabled(), { timeout: 2500 });
  // Completing verification never resumes the abandoned native submit.
  expect(mockNavigate).not.toHaveBeenCalled();
  await user.clear(amount());
  await user.type(amount(), '0.5');
  await submit(user);
  await expectPreview('0.5', true);
}

afterEach(() => {
  const allowed = [
    'resolveEns',
    'getERC20TokenInfo',
    'getFeeDataWithDynamicMaxPriorityFeePerGas',
    'refreshActiveAccountBalances',
  ];
  expect(
    mockEmitter.mock.calls.every(([method]) => allowed.includes(method.at(-1)))
  ).toBe(true);
  expect(
    mockEmitter.mock.calls.some(([method]) =>
      /sign|sendAndSave|broadcast/i.test(method.join('.'))
    )
  ).toBe(false);
});

it('healthy native ENS validation preserves its native asset and exact amount', async () => {
  const held = deferred<string>();
  const user = await mount(held.promise);
  await beginPendingNative(user);
  await act(async () => held.resolve(RECIPIENT));
  await expectPreview('2', false);
  expect(tokenCalls()).toHaveLength(0);
});

it('healthy token-first validation rejects excess balance and admits corrected exact amount', async () => {
  const user = await mount(Promise.resolve(RECIPIENT));
  await selectToken(user);
  await waitFor(() => expect(amount()).toBeEnabled(), { timeout: 2500 });
  await enter(user, '2');
  await submit(user);
  await waitFor(() =>
    expect(screen.getByText('send.insufficientFundsVerified')).toBeVisible()
  );
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(tokenCalls()).toHaveLength(1);
  await correctAndResubmitToken(user);
});

it.each<SubmitMethod>(['Next', 'Enter on focused Next'])(
  '%s does not reuse native validation for a newly selected token while its verification is pending',
  async (method) => {
    const held = deferred<string>();
    const tokenInfo = deferred<typeof VERIFIED_TOKEN>();
    const user = await mount(held.promise, tokenInfo.promise);
    await beginPendingNative(user, method);
    await selectToken(user);
    expect(amount()).toBeDisabled();
    await act(async () => held.resolve(RECIPIENT));
    await waitFor(() =>
      expect(
        screen.getByText('send.pleaseWaitForBalanceVerification')
      ).toBeVisible()
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    // Use the ordinary debounced read, not a directly invoked callback.
    await waitFor(() => expect(tokenCalls()).toHaveLength(1), {
      timeout: 2500,
    });
    await act(async () => tokenInfo.resolve(VERIFIED_TOKEN));
    await correctAndResubmitToken(user);
  }
);

it('retires native validation even when the new token finishes verification before the old ENS request', async () => {
  const held = deferred<string>();
  const user = await mount(held.promise);
  await beginPendingNative(user);
  await selectToken(user);
  await waitFor(() => expect(amount()).toBeEnabled(), { timeout: 2500 });
  expect(tokenCalls()).toHaveLength(1);
  expect(mockNavigate).not.toHaveBeenCalled();
  await act(async () => held.resolve(RECIPIENT));
  await waitFor(() =>
    expect(screen.getByText('send.insufficientFundsVerified')).toBeVisible()
  );
  expect(mockNavigate).not.toHaveBeenCalled();
  await correctAndResubmitToken(user);
});

it.each<SubmitMethod>(['Next', 'Enter on focused Next'])(
  '%s retires a native submit after selecting a token and returning to native',
  async (method) => {
    const held = deferred<string>();
    const user = await mount(held.promise);
    await beginPendingNative(user, method);
    await selectToken(user);
    await selectNative(user);
    await waitFor(() => expect(amount()).toBeEnabled());
    expect(amount()).toHaveValue(2);
    await act(async () => held.resolve(RECIPIENT));
    await act(async () => undefined);
    expect(mockNavigate).not.toHaveBeenCalled();
    // The original native amount is still valid; only a fresh user submit may proceed.
    await submit(user, method);
    await expectPreview('2', false);
  }
);
