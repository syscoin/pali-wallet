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
  parentId: 'parent',
  scope: {
    identity: 'account/network/session',
    rootPublicIdentity: 'root',
    network: { chainId: 57, kind: 'syscoin', url: 'https://blockbook.example' },
    assertRequestCurrent: () => undefined,
  },
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
  registry.publish('parent');
  const id = registry.find('010203', entry().origin, entry().scope.identity);
  expect(
    registry.get(id, '010203', entry().scope.identity).request.transactionHex
  ).toBe('010203');
  expect(registry.find('010203', entry().origin, entry().scope.identity)).toBe(
    id
  );
  for (const changed of ['010204', '000203', '01020300'])
    expect(() =>
      registry.find(changed, entry().origin, entry().scope.identity)
    ).toThrow(/exact/);
  expect(() =>
    registry.find('010203', 'https://another.example', entry().scope.identity)
  ).toThrow(/exact/);
  expect(() => registry.get(id, '010203', 'another-account')).toThrow(
    /expired/
  );
});

it('allows failure retry but prevents concurrent and second disclosed signatures', () => {
  const registry = new SentryFeeAuthorizations();
  registry.remember(entry());
  registry.publish('parent');
  const id = registry.find('010203', entry().origin, entry().scope.identity);
  const failed = registry.acquire(id, '010203', entry().scope.identity);
  expect(() => registry.acquire(id, '010203', entry().scope.identity)).toThrow(
    /already/
  );
  failed();
  const completed = registry.acquire(id, '010203', entry().scope.identity);
  completed(true);
  completed();
  expect(() => registry.get(id, '010203', entry().scope.identity)).toThrow(
    /expired/
  );
});

it('replaces prior consent for identical bytes when the user authorizes again', () => {
  const registry = new SentryFeeAuthorizations();
  registry.remember(entry());
  registry.publish('parent');
  const prior = registry.find('010203', entry().origin, entry().scope.identity);
  registry.remember({ ...entry(), context: { fresh: true } as any });
  registry.publish('parent');
  const current = registry.find(
    '010203',
    entry().origin,
    entry().scope.identity
  );
  expect(current).not.toBe(prior);
  expect(() => registry.get(prior, '010203', entry().scope.identity)).toThrow(
    /expired/
  );
  expect(
    registry.get(current, '010203', entry().scope.identity).context
  ).toEqual({ fresh: true });
});

it('expires after ten minutes and bounds retained public approvals', () => {
  jest.useFakeTimers();
  const registry = new SentryFeeAuthorizations();
  registry.remember(entry());
  registry.publish('parent');
  const id = registry.find('010203', entry().origin, entry().scope.identity);
  jest.advanceTimersByTime(600000);
  expect(() => registry.get(id, '010203', entry().scope.identity)).toThrow(
    /expired/
  );
  registry.remember(entry());
  registry.publish('parent');
  const evicted = registry.find(
    '010203',
    entry().origin,
    entry().scope.identity
  );
  for (let index = 0; index < 8; index++)
    registry.remember({
      ...entry(),
      request: { ...entry().request, transactionHex: `unique-${index}` },
    });
  expect(() => registry.get(evicted, '010203', entry().scope.identity)).toThrow(
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

it('does not publish on remember and retires only the cancelled parent before handoff', () => {
  const registry = new SentryFeeAuthorizations();
  registry.remember(entry());
  expect(() =>
    registry.find('010203', entry().origin, entry().scope.identity)
  ).toThrow();
  registry.cancelUnpublished('parent');
  registry.publish('parent');
  expect(() =>
    registry.find('010203', entry().origin, entry().scope.identity)
  ).toThrow();
  registry.remember(entry());
  registry.publish('parent');
  const token = registry.find('010203', entry().origin, entry().scope.identity);
  registry.cancelUnpublished('parent');
  expect(registry.find('010203', entry().origin, entry().scope.identity)).toBe(
    token
  );
  for (let index = 0; index < 12; index++) {
    registry.remember({
      ...entry(),
      parentId: `cancelled-${index}`,
      request: { ...entry().request, transactionHex: `other-${index}` },
    });
    registry.cancelUnpublished(`cancelled-${index}`);
  }
  expect(registry.find('010203', entry().origin, entry().scope.identity)).toBe(
    token
  );
});
