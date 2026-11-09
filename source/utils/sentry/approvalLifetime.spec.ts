const mockSubscribe = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { subscribe: (changed: () => void) => mockSubscribe(changed) },
}));

import {
  assertSentryDappResponseCurrent,
  createSentryDappApprovalLifetime,
} from './approvalLifetime';

const methods = [
  'sys_signSentryOperation',
  'sys_signSentryVote',
  'sys_linkSentryNode',
];
beforeEach(() => {
  jest.clearAllMocks();
  mockSubscribe.mockImplementation(() => jest.fn());
});
afterEach(() => jest.useRealTimers());

it.each(methods)(
  'keeps %s authority attached to the exact plain response through delivery',
  (method) => {
    const approval = createSentryDappApprovalLifetime(method, () => undefined);
    const result = { version: 1, transactionHex: '0102' };
    const before = JSON.stringify(result);
    approval.retainResponse(result, {
      disclose: () => undefined,
      retire: () => undefined,
    });
    approval.release();
    expect(mockSubscribe.mock.results[0].value).not.toHaveBeenCalled();
    expect(() =>
      assertSentryDappResponseCurrent(method, { ...result })
    ).toThrow(/no longer current/);
    expect(() => assertSentryDappResponseCurrent(method, result)).not.toThrow();
    expect(JSON.stringify(result)).toBe(before);
    expect(Object.keys(result)).toEqual(['version', 'transactionHex']);
    expect(mockSubscribe.mock.results[0].value).toHaveBeenCalledTimes(1);
  }
);

it.each(methods)(
  'blocks %s delivery after popup completion followed by grant removal/restoration',
  (method) => {
    let connected = true;
    const approval = createSentryDappApprovalLifetime(method, () => {
      if (!connected) throw new Error('Revoked');
    });
    const result = { version: 1, linked: true };
    approval.retainResponse(result, {
      disclose: () => undefined,
      retire: () => undefined,
    });
    approval.release();
    connected = false;
    mockSubscribe.mock.calls[0][0]();
    connected = true;
    mockSubscribe.mock.calls[0][0]();
    expect(() => assertSentryDappResponseCurrent(method, result)).toThrow(
      /no longer current/
    );
    expect(mockSubscribe.mock.results[0].value).toHaveBeenCalledTimes(1);
  }
);

it('rejects missing bindings and method substitution but allows ordinary provider errors', () => {
  for (const method of methods) {
    expect(() =>
      assertSentryDappResponseCurrent(method, { version: 1 })
    ).toThrow(/no longer current/);
    expect(() => assertSentryDappResponseCurrent(method, true)).toThrow(
      /no longer current/
    );
    expect(() =>
      assertSentryDappResponseCurrent(method, {
        error: { code: 4001, message: 'Cancelled' },
      })
    ).not.toThrow();
    expect(() =>
      assertSentryDappResponseCurrent(method, {
        error: { code: 4001, message: 'Cancelled', transactionHex: '0102' },
      })
    ).toThrow();
  }
  const approval = createSentryDappApprovalLifetime(
    methods[0],
    () => undefined
  );
  const result = { version: 1 };
  approval.retainResponse(result, {
    disclose: () => undefined,
    retire: () => undefined,
  });
  expect(() => assertSentryDappResponseCurrent(methods[1], result)).toThrow();
  expect(mockSubscribe.mock.results[0].value).toHaveBeenCalledTimes(1);
});

it('cleans abandoned, failed and page-aborted lifetimes without reviving their response', () => {
  jest.useFakeTimers();
  const original = new AbortController();
  const approval = createSentryDappApprovalLifetime(
    methods[0],
    () => undefined,
    original.signal
  );
  const result = { version: 1 };
  approval.retainResponse(result, {
    disclose: () => undefined,
    retire: () => undefined,
  });
  original.abort();
  expect(() => assertSentryDappResponseCurrent(methods[0], result)).toThrow();
  expect(mockSubscribe.mock.results[0].value).toHaveBeenCalledTimes(1);
  const abandoned = createSentryDappApprovalLifetime(
    methods[0],
    () => undefined
  );
  const late = { version: 1 };
  abandoned.retainResponse(late, {
    disclose: () => undefined,
    retire: () => undefined,
  });
  abandoned.release();
  jest.advanceTimersByTime(600000);
  expect(() => assertSentryDappResponseCurrent(methods[0], late)).toThrow();
  expect(mockSubscribe.mock.results[1].value).toHaveBeenCalledTimes(1);
  const failed = createSentryDappApprovalLifetime(methods[0], () => undefined);
  failed.release();
  failed.release();
  expect(mockSubscribe.mock.results[2].value).toHaveBeenCalledTimes(1);
});

it('publishes only at the final guarded handoff and retires unpublished work on cancellation', () => {
  const disclose = jest.fn(),
    retire = jest.fn(),
    parent = new AbortController();
  const approval = createSentryDappApprovalLifetime(
    methods[0],
    () => undefined,
    parent.signal
  );
  const result = { version: 1, transactionHex: '0102' };
  approval.retainResponse(result, { disclose, retire });
  approval.release();
  expect(disclose).not.toHaveBeenCalled();
  parent.abort();
  expect(retire).toHaveBeenCalledTimes(1);
  expect(() => assertSentryDappResponseCurrent(methods[0], result)).toThrow();
  expect(disclose).not.toHaveBeenCalled();
  const delivered = createSentryDappApprovalLifetime(
    methods[0],
    () => undefined
  );
  const next = { version: 1, transactionHex: '0102' };
  delivered.retainResponse(next, { disclose, retire });
  delivered.release();
  assertSentryDappResponseCurrent(methods[0], next);
  expect(disclose).toHaveBeenCalledTimes(1);
  expect(retire).toHaveBeenCalledTimes(2);
});
