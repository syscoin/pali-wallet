/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { onMessage } from 'scripts/Background/controllers/message-handler';
import { Interface } from 'utils/ethersV6Compat';

import { SendCalls } from './SendCalls';

let mockState: any;
let mockQuery: any;
let mockController: any;
const mockEmitter = jest.fn(() => {
  throw new Error('Review must not sign, submit or mutate wallet state');
});
const mockCleanup = jest.fn(async () => undefined);
const mockDispatch = jest.fn();
const mockPopup = jest.fn(async (options: any) => {
  mockQuery = {
    ...options.data,
    host: options.host,
    eventName: options.eventName,
  };
  return { id: options.data.bundleId };
});

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({ alert: { error: jest.fn(), success: jest.fn() } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled, type }: any) => (
    <button type={type} onClick={onClick} disabled={disabled}>
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
jest.mock('utils/browser', () => ({
  dispatchBackgroundEvent: (...args: any[]) => mockDispatch(...args),
}));
jest.mock('utils/navigationState', () => ({
  clearTransactionNavigationState: () => mockCleanup(),
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => {
    throw new Error('Review must not sign');
  },
  prepareSmartAccountFeeQuote: () => {
    throw new Error('EOA review must not prepare a smart-account quote');
  },
  signAndSubmitSmartAccountExecutions: () => {
    throw new Error('Review must not sign');
  },
}));
jest.mock('scripts/Background', () => ({
  getController: () => mockController,
}));
jest.mock('scripts/Provider/EthProvider', () => ({ EthProvider: jest.fn() }));
jest.mock('scripts/Provider/SysProvider', () => ({ SysProvider: jest.fn() }));
jest.mock(
  'scripts/Background/controllers/message-handler/popup-promise',
  () => ({
    popupPromise: (options: any) => mockPopup(options),
  })
);
jest.mock(
  'scripts/Background/controllers/message-handler/sendCallsBundles',
  () => ({
    reserveSendCallsBundle: jest.fn(async () => true),
    generateWalletBundleId: () => '0x1234',
    isValidAppProvidedBundleId: () => true,
    releaseSendCallsBundleReservation: jest.fn(async () => undefined),
  })
);
jest.mock('utils/security/blacklistService', () => ({
  blacklistService: {
    checkUrl: jest.fn(async () => ({ isBlacklisted: false })),
    checkAddress: jest.fn(async () => ({ isBlacklisted: false })),
  },
}));

const ACCOUNT = `0x${'11'.repeat(20)}`;
const CONTRACT = `0x${'22'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
const HOST = 'https://batch-review.synthetic.invalid';
const unknownData = new Interface([
  'function ordinaryBatchMessage(bytes32 value)',
]).encodeFunctionData('ordinaryBatchMessage', [`0x${'a5'.repeat(32)}`]);
const knownData = new Interface([
  'function transfer(address to,uint256 amount)',
]).encodeFunctionData('transfer', [RECIPIENT, '17']);
type Call = { data?: string; to: string; value: string };
const call = (data = unknownData): Call => ({
  to: CONTRACT,
  value: '0x1',
  data,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'close').mockImplementation();
  mockQuery = {};
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        currency: 'ETH',
        url: 'https://rpc.synthetic.invalid',
        slip44: 60,
      },
      accounts: { HDAccount: { 0: { id: 0, address: ACCOUNT } } },
      accountAssets: {
        HDAccount: { 0: { ethereum: [], syscoin: [] } },
      },
      isBitcoinBased: false,
    },
    vaultGlobal: { networkStatus: 'idle', activeSlip44: 60 },
    spamFilter: { config: { enabled: false }, dapps: {} },
  };
  mockController = {
    wallet: {
      isUnlocked: () => true,
      getWalletSessionGeneration: () => 1,
      ethereumTransaction: { web3Provider: {} },
    },
    dapp: {
      isConnected: () => true,
      getAccount: () => mockState.vault.accounts.HDAccount[0],
      get: (host: string) => ({ accountId: 0, accountType: 'HDAccount', host }),
    },
  };
  Object.assign(chrome, {
    tabs: {
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    },
  });
});
afterEach(() => {
  cleanup();
  expect(mockEmitter).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

// Retain the actual runtime entry, pipeline and handler. Only window opening
// and bundle storage are intercepted; this suite never starts a sender.
const request = (calls: Call[], host = HOST, atomicRequired = false) =>
  onMessage(
    {
      type: 'METHOD_REQUEST',
      data: {
        method: 'wallet_sendCalls',
        params: [
          {
            version: '2.0.0',
            chainId: '0x1',
            from: ACCOUNT,
            atomicRequired,
            calls,
          },
        ],
      },
    },
    { url: `${host}/ordinary-page`, tab: { id: 50 } } as any
  );
const openReview = async (calls = [call()], host = HOST) => {
  expect(await request(calls, host)).toEqual({ id: '0x1234' });
  expect(mockPopup).toHaveBeenCalledTimes(1);
  expect(mockQuery.host).toBe(host);
  expect(mockQuery.calls).toEqual(calls);
  const view = render(<SendCalls />);
  expect(
    await screen.findByRole('button', { name: 'send.sign' })
  ).toBeEnabled();
  expect(screen.getByText(`send.from: ${ACCOUNT}`)).toBeVisible();
  return view;
};
const disclosure = (container: HTMLElement, index = 0) => {
  const details = container.querySelectorAll('details')[index];
  expect(details).toBeDefined();
  const summary = details.querySelector('summary')!;
  const bytes = details.querySelector('pre')!;
  return { details, summary, bytes };
};

it.each([HOST, `https://${'a'.repeat(60)}.synthetic.invalid`])(
  'shows the trusted requesting origin %s from the real runtime pipeline',
  async (host) => {
    await openReview([call()], host);
    const origin = screen.getByText(host, { exact: true });
    expect(origin).toBeVisible();
    expect(origin).toHaveClass('break-all');
  }
);

it('lets a mouse user expand and collapse the exact unknown-method calldata', async () => {
  const { container } = await openReview();
  const { details, summary, bytes } = disclosure(container);
  expect(summary).toHaveTextContent('send.hex');
  expect(details).not.toHaveAttribute('open');
  expect(bytes.textContent).toBe(unknownData);
  expect(bytes).not.toBeVisible();
  await userEvent.setup().click(summary);
  expect(details).toHaveAttribute('open');
  expect(bytes).toBeVisible();
  await userEvent.setup().click(summary);
  expect(details).not.toHaveAttribute('open');
});

it('places the full unknown-calldata disclosure in native keyboard focus order', async () => {
  const { container } = await openReview();
  const { summary, details, bytes } = disclosure(container);
  expect(summary.tagName).toBe('SUMMARY');
  const user = userEvent.setup();
  await user.tab();
  expect(summary).toHaveFocus();
  // user-event does not emulate Enter/Space default activation for SUMMARY.
  // Its native click toggle is covered here; real key activation is browser QA.
  fireEvent.click(summary);
  expect(details).toHaveAttribute('open');
  expect(bytes).toBeVisible();
  expect(bytes.textContent).toBe(unknownData);
});

it('retains decoded known-call parameters, exact bytes and the one-wei total', async () => {
  const { container } = await openReview([call(knownData)]);
  expect(screen.getByText('transfer', { exact: true })).toBeVisible();
  expect(screen.getByText('amount: 17', { exact: true })).toBeVisible();
  expect(screen.getByText(`to: ${RECIPIENT}`, { exact: true })).toBeVisible();
  const { summary, bytes } = disclosure(container);
  fireEvent.click(summary);
  expect(bytes).toBeVisible();
  expect(bytes.textContent).toBe(knownData);
  const values = screen.getAllByText('0.000000000000000001 ETH', {
    exact: true,
  });
  expect(values).toHaveLength(2);
  values.forEach((value) => expect(value).toBeVisible());
});

it('retains raw bytes when a recognized selector cannot decode its arguments', async () => {
  const data = '0xa9059cbbdeadbeef';
  const { container } = await openReview([call(data)]);
  expect(screen.getByText('transfer', { exact: true })).toBeVisible();
  const { summary, bytes } = disclosure(container);
  fireEvent.click(summary);
  expect(bytes.textContent).toBe(data);
  expect(bytes).toBeVisible();
});

it('keeps native transfers without calldata free of empty disclosures', async () => {
  const { container } = await openReview([call('0x')]);
  expect(container.querySelector('details')).toBeNull();
  expect(screen.getByText(HOST, { exact: true })).toBeVisible();
  expect(screen.getAllByText('0.000000000000000001 ETH')).toHaveLength(2);
});

it('keeps each original call and its exact data independently reviewable', async () => {
  const { container } = await openReview([
    call(),
    { ...call(knownData), value: '0x2' },
  ]);
  const first = disclosure(container, 0);
  const second = disclosure(container, 1);
  fireEvent.click(first.summary);
  expect(first.bytes.textContent).toBe(unknownData);
  expect(first.bytes).toBeVisible();
  expect(second.details).not.toHaveAttribute('open');
  fireEvent.click(second.summary);
  expect(second.bytes.textContent).toBe(knownData);
  expect(second.bytes).toBeVisible();
  const selection = screen.getAllByRole('checkbox') as HTMLInputElement[];
  expect(selection).toHaveLength(2);
  selection.forEach((checkbox) => {
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
  });
  expect(screen.getByText('0.000000000000000003 ETH')).toBeVisible();
});

it('retains ordinary Reject without starting a transaction or accepting the request', async () => {
  await openReview();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'buttons.reject' }));
  expect(mockCleanup).toHaveBeenCalledTimes(1);
  expect(window.close).toHaveBeenCalledTimes(1);
  expect(mockDispatch).not.toHaveBeenCalled();
});

it('refuses unsupported required atomicity before opening approval', async () => {
  expect(await request([call()], HOST, true)).toMatchObject({
    error: { code: 5700 },
  });
  expect(mockPopup).not.toHaveBeenCalled();
});
