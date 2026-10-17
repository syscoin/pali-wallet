import { webcrypto } from 'crypto';

import {
  SentryFeeAuthorizations,
  isSentryTransactionVersion,
} from './feeAuthorization';

beforeEach(() => {
  Object.defineProperty(global, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
});
afterEach(() => jest.useRealTimers());

const entry = () => ({
  scopeIdentity: 'account/network/session',
  origin: 'https://sysnode.example',
  serviceUrl: 'https://trusted.example',
  request: {
    version: 1 as const,
    operation: 'updateService' as const,
    chain: { genesisHash: 'ab'.repeat(32), era: 'legacy-v3' as const },
    transactionHex: '010203',
  },
  context: {} as any,
});

it('binds exact transaction bytes, origin and complete wallet scope without consuming reads', () => {
  const registry = new SentryFeeAuthorizations();
  registry.remember(entry());
  const id = registry.find('010203', entry().origin, entry().scopeIdentity);
  expect(
    registry.get(id, '010203', entry().scopeIdentity).request.transactionHex
  ).toBe('010203');
  expect(registry.find('010203', entry().origin, entry().scopeIdentity)).toBe(
    id
  );
  for (const changed of ['010204', '000203', '01020300'])
    expect(() =>
      registry.find(changed, entry().origin, entry().scopeIdentity)
    ).toThrow(/exact/);
  expect(() =>
    registry.find('010203', 'https://another.example', entry().scopeIdentity)
  ).toThrow(/exact/);
  expect(() => registry.get(id, '010203', 'another-account')).toThrow(
    /expired/
  );
});

it('allows failure retry but prevents concurrent and second disclosed signatures', () => {
  const registry = new SentryFeeAuthorizations();
  registry.remember(entry());
  const id = registry.find('010203', entry().origin, entry().scopeIdentity);
  const failed = registry.acquire(id, '010203', entry().scopeIdentity);
  expect(() => registry.acquire(id, '010203', entry().scopeIdentity)).toThrow(
    /already/
  );
  failed();
  const completed = registry.acquire(id, '010203', entry().scopeIdentity);
  completed(true);
  completed();
  expect(() => registry.get(id, '010203', entry().scopeIdentity)).toThrow(
    /expired/
  );
});

it('replaces prior consent for identical bytes when the user authorizes again', () => {
  const registry = new SentryFeeAuthorizations();
  registry.remember(entry());
  const prior = registry.find('010203', entry().origin, entry().scopeIdentity);
  registry.remember({ ...entry(), context: { fresh: true } as any });
  const current = registry.find(
    '010203',
    entry().origin,
    entry().scopeIdentity
  );
  expect(current).not.toBe(prior);
  expect(() => registry.get(prior, '010203', entry().scopeIdentity)).toThrow(
    /expired/
  );
  expect(
    registry.get(current, '010203', entry().scopeIdentity).context
  ).toEqual({ fresh: true });
});

it('expires after ten minutes and bounds retained public approvals', () => {
  jest.useFakeTimers();
  const registry = new SentryFeeAuthorizations();
  registry.remember(entry());
  const id = registry.find('010203', entry().origin, entry().scopeIdentity);
  jest.advanceTimersByTime(600000);
  expect(() => registry.get(id, '010203', entry().scopeIdentity)).toThrow(
    /expired/
  );
  registry.remember(entry());
  const evicted = registry.find(
    '010203',
    entry().origin,
    entry().scopeIdentity
  );
  for (let index = 0; index < 8; index++)
    registry.remember({
      ...entry(),
      request: { ...entry().request, transactionHex: `unique-${index}` },
    });
  expect(() => registry.get(evicted, '010203', entry().scopeIdentity)).toThrow(
    /expired/
  );
});

it('recognizes only the explicit Sentry transaction versions', () => {
  [80, 81, 82, 83, 86].forEach((version) =>
    expect(isSentryTransactionVersion(version)).toBe(true)
  );
  [1, 2, 3, 84, 85, 87, undefined, NaN].forEach((version) =>
    expect(isSentryTransactionVersion(version as number)).toBe(false)
  );
});
