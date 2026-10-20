/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import {
  recordSendCallsBundle,
  reserveSendCallsBundle,
  resolveCallsStatus,
} from 'scripts/Background/controllers/message-handler/sendCallsBundles';
import { dispatchBackgroundEvent } from 'utils/browser';

import { SendCalls } from './SendCalls';

const mockEmitter = jest.fn();
const mockCleanup = jest.fn();
const mockSmartSubmit = jest.fn();
const mockClose = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
let mockState: any;
let mockQuery: any;
let mockApprove: () => Promise<void>;
let mockReject: () => Promise<void>;
let mockRecordGate: (descriptor: any) => Promise<void> | void;
let mockStored: any;
const HASH_A = '0x' + 'a'.repeat(64);
const HASH_B = '0x' + 'b'.repeat(64);

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
  selectEnsNameToAddress: () => ({}),
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled, variant }: any) => {
    if (variant === 'primary') mockApprove = onClick;
    if (variant === 'secondary') mockReject = onClick;
    return (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    );
  },
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/navigationState', () => ({
  clearTransactionNavigationState: () => mockCleanup(),
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  getPaliEntryPointAddress: () => '0x' + '9'.repeat(40),
  paliEntryPointInterface: {
    getEvent: () => ({ topicHash: '0x' + '9'.repeat(64) }),
  },
  prepareSmartAccountFeeQuote: async () => ({
    gasUnits: '860000',
    maximumFeeWei: '4300000',
  }),
  SMART_ACCOUNT_FEE_QUOTE_CHANGED: 'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED',
  isSmartAccountFeeQuoteChanged: (error: any) =>
    error?.message === 'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED' &&
    error?.transactionNotBroadcast === true,
  signAndSubmitSmartAccountExecutions: (params: any) => mockSmartSubmit(params),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'close').mockImplementation(mockClose);
  jest.spyOn(console, 'error').mockImplementation();
  const address = `0x${'1'.repeat(40)}`;
  mockState = {
    vault: {
      activeNetwork: { chainId: 1, currency: 'ETH', url: 'rpc-a' },
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { id: 0, address } } },
    },
  };
  mockQuery = {
    host: 'https://dapp.example',
    eventName: 'sendCalls',
    bundleId: 'bundle-id',
    reservationId: 'reservation-id',
    chainId: '0x1',
    version: '2.0.0',
    atomicRequired: false,
    approvedContext: {
      account: { address, id: 0, type: 'HDAccount' },
      chainId: 1,
      rpcUrl: 'rpc-a',
      slip44: 60,
    },
    calls: [{ to: `0x${'2'.repeat(40)}` }],
  };
  mockCleanup.mockResolvedValue(undefined);
  mockEmitter.mockReset().mockImplementation(async ([, method]) => {
    if (method === 'getRecommendedNonceForBatch') return 5;
    if (method === 'sendAndSaveEthTransaction')
      return { hash: `0x${'a'.repeat(64)}` };
    return undefined;
  });
  mockSmartSubmit.mockReset().mockImplementation(async (params) => {
    await params.onBeforeSubmit();
    return { hash: HASH_A };
  });
  mockRecordGate = () => undefined;
  mockStored = {};
  jest.useFakeTimers();
  (chrome.storage.local.get as jest.Mock).mockImplementation((_keys, reply) =>
    reply({ 'pali-sendcalls-bundles': JSON.parse(JSON.stringify(mockStored)) })
  );
  (chrome.storage.local.set as jest.Mock).mockImplementation(
    (values, reply) => {
      mockStored = JSON.parse(JSON.stringify(values['pali-sendcalls-bundles']));
      reply();
    }
  );
  mockQuery.bundleId = '0xabcd';
  mockQuery.calls = [
    { to: '0x' + '2'.repeat(40), value: '0x1' },
    { to: '0x' + '3'.repeat(40), value: '0x2' },
  ];
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const flush = () =>
  act(async () => {
    for (let index = 0; index < 24; index++) await Promise.resolve();
  });
const sends = () =>
  mockEmitter.mock.calls.filter(
    ([path]) => path[1] === 'sendAndSaveEthTransaction'
  );
const reply = () => ({ id: mockQuery.bundleId, capabilities: {} });
const safeFailure = () =>
  Object.assign(new Error('Synthetic refusal before broadcast'), {
    transactionNotBroadcast: true,
  });
const pending = () => {
  let resolve!: (value?: any) => void;
  let reject!: (error: any) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const prepare = async (
  smart = false,
  send: (index: number) => any = (index) => ({ hash: index ? HASH_B : HASH_A })
) => {
  let count = 0;
  await reserveSendCallsBundle(
    mockQuery.host,
    mockQuery.bundleId,
    { atomic: smart, smartAccount: smart, chainId: 1 },
    mockQuery.reservationId
  );
  mockEmitter.mockImplementation(async (path, args) => {
    if (path[1] === 'getRecommendedNonceForBatch') return 5 + sends().length;
    if (path[1] === 'recordSendCallsBundle') {
      await mockRecordGate(args[2]);
      return recordSendCallsBundle(...(args as [string, string, any]));
    }
    if (path[1] === 'sendAndSaveEthTransaction') return send(count++);
    throw new Error(
      'Unexpected controller or irreversible method ' + path.join('.')
    );
  });
  if (smart)
    Object.assign(mockState.vault.accounts.HDAccount[0], {
      isSmartAccount: true,
      smartAccount: { chainId: 1 },
    });
  const view = render(<SendCalls />);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'send.sign' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  );
  return view;
};
const approve = async () => {
  await act(async () => mockApprove());
  await flush();
};
const close = async () => {
  await act(async () => mockReject());
  await flush();
};
const finishDelay = () =>
  act(async () => {
    jest.advanceTimersByTime(2100);
  });
const status = async () =>
  (
    await resolveCallsStatus(
      () => ({
        getTransactionReceipt: async (hash) => ({
          hash,
          status: 1,
          blockHash: HASH_A,
          blockNumber: 1,
          gasUsed: 21000,
          logs: [],
        }),
      }),
      mockQuery.host,
      mockQuery.bundleId
    )
  ).status;

it.each([false, true])(
  'keeps every original call mandatory even when atomicRequired is false (smart=%s)',
  async (smart) => {
    await prepare(smart);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.map((box) => box.checked)).toEqual([true, true]);
    expect(checkboxes.every((box) => box.disabled)).toBe(true);
    checkboxes.forEach((checkbox) => fireEvent.click(checkbox));
    expect(checkboxes.map((box) => box.checked)).toEqual([true, true]);
    expect(screen.getByText('0.000000000000000003 ETH')).toBeTruthy();
    await approve();
    if (smart) {
      expect(mockSmartSubmit.mock.calls[0][0].executions).toEqual([
        { target: mockQuery.calls[0].to, data: '0x', value: '0x1' },
        { target: mockQuery.calls[1].to, data: '0x', value: '0x2' },
      ]);
    } else
      expect(sends().map((call) => call[1][0].to)).toEqual(
        mockQuery.calls.map((call) => call.to)
      );
    await finishDelay();
    expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
      'sendCalls.' + mockQuery.host,
      reply()
    );
  }
);

it('keeps atomic-required smart calls mandatory and returns the reserved ID', async () => {
  mockQuery.atomicRequired = true;
  await prepare(true);
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  await approve();
  expect(mockSmartSubmit.mock.calls[0][0].executions).toHaveLength(2);
  await finishDelay();
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

it('returns the durable ID on explicit Close after one acknowledged call and one definite rejection', async () => {
  await prepare(false, (index) => {
    if (index === 1) throw safeFailure();
    return { hash: HASH_A };
  });
  await approve();
  expect(await status()).toBe(600);
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'buttons.close' })).toBeTruthy();
  await close();
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'sendCalls.' + mockQuery.host,
    reply()
  );
  expect(mockStored[mockQuery.host][mockQuery.bundleId].txHashes).toEqual([
    HASH_A,
  ]);
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it('retries only the rejected suffix and completes using the same reserved ID', async () => {
  await prepare(false, (index) => {
    if (index === 1) throw safeFailure();
    return { hash: index ? HASH_B : HASH_A };
  });
  await approve();
  expect(await status()).toBe(600);
  await approve();
  expect(sends().map((call) => call[1][0].to)).toEqual([
    mockQuery.calls[0].to,
    mockQuery.calls[1].to,
    mockQuery.calls[1].to,
  ]);
  expect(await status()).toBe(200);
  await finishDelay();
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'sendCalls.' + mockQuery.host,
    reply()
  );
});

it('retains known hashes when a later retry has no new hash and closes with the same ID', async () => {
  await prepare(false, (index) => {
    if (index > 0) throw safeFailure();
    return { hash: HASH_A };
  });
  await approve();
  await approve();
  expect(sends()).toHaveLength(3);
  expect(await status()).toBe(600);
  await close();
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'sendCalls.' + mockQuery.host,
    reply()
  );
});

it('stops at the first definite unsent failure so retry preserves original call order', async () => {
  await prepare(false, (index) => {
    if (index === 0) throw safeFailure();
    return { hash: index === 1 ? HASH_A : HASH_B };
  });
  await approve();
  expect(sends().map((call) => call[1][0].to)).toEqual([mockQuery.calls[0].to]);
  expect(await status()).toBe(400);
  await approve();
  expect(sends().map((call) => call[1][0].to)).toEqual([
    mockQuery.calls[0].to,
    mockQuery.calls[0].to,
    mockQuery.calls[1].to,
  ]);
  await finishDelay();
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

it('keeps all-failed/no-hash Close a rejection rather than a success ID', async () => {
  await prepare(false, () => {
    throw safeFailure();
  });
  await approve();
  expect(sends()).toHaveLength(1);
  expect(await status()).toBe(400);
  await close();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it('keeps pre-send Reject terminal without emitting an ID or invoking either sender', async () => {
  await prepare();
  const retained = mockApprove;
  await close();
  await act(async () => retained());
  expect(sends()).toHaveLength(0);
  expect(mockSmartSubmit).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it('does not return an earlier known hash as completion after a later unknown send', async () => {
  await prepare(false, (index) => {
    if (index === 1) throw new Error('Synthetic lost RPC response');
    return { hash: HASH_A };
  });
  await approve();
  expect(await status()).toBe(100);
  expect(
    (screen.getByRole('button', { name: 'send.sign' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  await act(async () => mockApprove());
  expect(sends()).toHaveLength(2);
  await close();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it('cannot complete from an acknowledged hash whose persistence failed', async () => {
  mockRecordGate = (descriptor) => {
    if (!descriptor.submissionCompleted && descriptor.txHashes.length)
      throw new Error('Synthetic hash write failure');
  };
  await prepare();
  await approve();
  expect(sends()).toHaveLength(1);
  expect(await status()).toBe(100);
  await close();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it('retries failed terminal persistence on Close before returning a known partial ID', async () => {
  let fail = true;
  mockRecordGate = (descriptor) => {
    if (descriptor.submissionCompleted && fail)
      throw new Error('Synthetic terminal write failure');
  };
  await prepare(false, (index) => {
    if (index === 1) throw safeFailure();
    return { hash: HASH_A };
  });
  await approve();
  expect(await status()).toBe(100);
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  fail = false;
  await close();
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'sendCalls.' + mockQuery.host,
    reply()
  );
  expect(await status()).toBe(600);
});

it('does not settle when terminal persistence still fails, and allows a later Close recovery', async () => {
  let fail = true;
  mockRecordGate = (descriptor) => {
    if (descriptor.submissionCompleted && fail)
      throw new Error('Synthetic terminal write failure');
  };
  await prepare(false, (index) => {
    if (index === 1) throw safeFailure();
    return { hash: HASH_A };
  });
  await approve();
  await close();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
  fail = false;
  await close();
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

it('recovers an all-acknowledged terminal write without resubmitting either call', async () => {
  let fail = true;
  mockRecordGate = (descriptor) => {
    if (descriptor.submissionCompleted && fail)
      throw new Error('Synthetic terminal write failure');
  };
  await prepare();
  await approve();
  await finishDelay();
  expect(sends()).toHaveLength(2);
  expect(await status()).toBe(100);
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  fail = false;
  await close();
  await finishDelay();
  expect(sends()).toHaveLength(2);
  expect(await status()).toBe(200);
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

it('invalidates old completion while a newer admitted retry is pending', async () => {
  const sending = pending();
  await prepare(false, (index) => {
    if (index === 1) throw safeFailure();
    return index === 2 ? sending.promise : { hash: HASH_A };
  });
  await approve();
  const retainedClose = mockReject;
  const retry = mockApprove;
  let active!: Promise<void>;
  await act(async () => {
    active = retry();
  });
  await flush();
  await act(async () => retainedClose());
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
  await act(async () => {
    sending.reject(safeFailure());
    await active;
  });
  await close();
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

it('settles only once when manual Close races the all-success timer and retained callbacks', async () => {
  const cleanup = pending();
  mockCleanup.mockReturnValue(cleanup.promise);
  await prepare();
  const retainedApprove = mockApprove;
  await approve();
  const retainedClose = mockReject;
  let closing!: Promise<void>;
  await act(async () => {
    closing = retainedClose();
  });
  await finishDelay();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  await act(async () => {
    cleanup.resolve();
    await closing;
  });
  await act(async () => {
    await retainedClose();
    await retainedApprove();
  });
  await finishDelay();
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(sends()).toHaveLength(2);
});

it('cancels retained auto-completion and close callbacks when the component unmounts', async () => {
  const view = await prepare();
  await approve();
  const retainedClose = mockReject;
  view.unmount();
  await finishDelay();
  await act(async () => retainedClose());
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
});

it('does not let a retained Approve reopen an already acknowledged complete batch before its timer', async () => {
  await prepare();
  const retained = mockApprove;
  await approve();
  const count = mockEmitter.mock.calls.length;
  await act(async () => retained());
  expect(mockEmitter).toHaveBeenCalledTimes(count);
  await finishDelay();
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

it('does not dispatch or close after unmounting during completion cleanup', async () => {
  const cleanup = pending();
  mockCleanup.mockReturnValue(cleanup.promise);
  const view = await prepare();
  await approve();
  let closing!: Promise<void>;
  await act(async () => {
    closing = mockReject();
  });
  view.unmount();
  await act(async () => {
    cleanup.resolve();
    await closing;
  });
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
});

it('does not invoke a sender after unmounting while the durable begin is pending', async () => {
  const begin = pending();
  mockRecordGate = (descriptor) =>
    descriptor.submissionStarted ? begin.promise : undefined;
  const view = await prepare();
  let sending!: Promise<void>;
  await act(async () => {
    sending = mockApprove();
  });
  await flush();
  view.unmount();
  await act(async () => {
    begin.resolve();
    await sending;
  });
  expect(sends()).toHaveLength(0);
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});
