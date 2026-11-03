import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertBaseUnits,
  assertReviewCurrent,
  createTransferReview,
  formatBaseUnits,
  isPublicAddress,
  loadedBalance,
  normalizePublicAddress,
  parseDecimalAmount,
  validatePublicAccounts,
  WatchOnlyAuthority,
} from '../src/core/index.ts';
import type {
  BalanceReader,
  PublicAccount,
  ReviewContext,
} from '../src/core/index.ts';

const ADDRESS_A = '0x52908400098527886E0F7030069857D2E4169EE7';
const ADDRESS_B = '0x8617E340B3D01FA5F11F306F4090FD50E238070D';
const accounts: PublicAccount[] = [
  {
    id: 'main',
    name: 'Main account',
    addresses: { ethereum: ADDRESS_A, base: ADDRESS_A },
  },
  {
    id: 'savings',
    name: 'Savings',
    addresses: { ethereum: ADDRESS_B, base: ADDRESS_B },
  },
];
const reader: BalanceReader = {
  async readBalance() {
    return { chainId: 1, units: '0' };
  },
};
const context: ReviewContext = {
  accountId: 'main',
  address: ADDRESS_A,
  networkId: 'ethereum',
  chainId: 1,
  endpoint: 'https://example.invalid/rpc',
  generation: 1,
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test('public address normalization uses checksum validation and rejects misleading input', () => {
  assert.equal(
    normalizePublicAddress(ADDRESS_A.toLowerCase(), 'ethereum'),
    ADDRESS_A
  );
  assert.equal(
    isPublicAddress('0x52908400098527886e0F7030069857D2E4169EE7', 'ethereum'),
    false
  );
  assert.equal(isPublicAddress(` ${ADDRESS_A}`, 'ethereum'), false);
  assert.equal(isPublicAddress('0x' + '0'.repeat(40), 'ethereum'), false);
  assert.equal(isPublicAddress('0x529084', 'ethereum'), false);
  assert.equal(isPublicAddress('vitalik.eth', 'ethereum'), false);
  assert.equal(isPublicAddress(ADDRESS_A, 'bitcoin'), false);
});

test('decimal arithmetic stays exact above JS safe integers and rejects ambiguity', () => {
  assert.equal(
    parseDecimalAmount('0.009007199254740993', 18),
    9007199254740993n
  );
  assert.equal(formatBaseUnits('9007199254740993', 18), '0.009007199254740993');
  for (const amount of [
    '1e-3',
    '-1',
    '+1',
    '.5',
    '01',
    ' 1',
    '1 ',
    '1.',
    'NaN',
    'Infinity',
  ]) {
    assert.throws(() => parseDecimalAmount(amount, 18), amount);
  }
  assert.throws(() => parseDecimalAmount('0.0000000000000000001', 18));
  assert.throws(() => parseDecimalAmount('0', 18));
  assert.equal(parseDecimalAmount('0', 18, true), 0n);
  assert.throws(() => assertBaseUnits((1n << 256n).toString()));
});

test('available zero remains distinct from unobserved and failed balances', async () => {
  const authority = new WatchOnlyAuthority(accounts, reader, () => 1000);
  assert.equal(authority.getSnapshot().balance.status, 'unknown');
  authority.unlock();
  await authority.refresh();
  assert.deepEqual(authority.getSnapshot().balance, {
    status: 'available',
    units: '0',
    updatedAt: 1000,
  });
  assert.throws(() => loadedBalance('-1', 1000));
  assert.throws(() => loadedBalance('0', NaN));
  const failure = new WatchOnlyAuthority(accounts, {
    async readBalance() {
      throw new Error('offline');
    },
  });
  failure.unlock();
  await failure.refresh();
  assert.equal(failure.getSnapshot().balance.status, 'error');
});

test('wrong-chain RPC observations cannot become balances', async () => {
  const authority = new WatchOnlyAuthority(accounts, {
    async readBalance() {
      return { chainId: 8453, units: '200' };
    },
  });
  authority.unlock();
  await authority.refresh();
  assert.equal(authority.getSnapshot().balance.status, 'error');
});

test('an A-B-A account switch invalidates the original A response', async () => {
  const result = deferred<{ chainId: number; units: string }>();
  const authority = new WatchOnlyAuthority(accounts, {
    readBalance: () => result.promise,
  });
  authority.unlock();
  const pending = authority.refresh();
  const before = authority.getSnapshot().generation;
  authority.selectAccount('savings');
  authority.selectAccount('main');
  assert.ok(authority.getSnapshot().generation > before);
  result.resolve({ chainId: 1, units: '999' });
  await pending;
  assert.equal(authority.getSnapshot().selectedAccountId, 'main');
  assert.equal(authority.getSnapshot().balance.status, 'unknown');
});

test('an A-B-A network switch and background lock invalidate in-flight balances', async () => {
  const first = deferred<{ chainId: number; units: string }>();
  const second = deferred<{ chainId: number; units: string }>();
  let calls = 0;
  const authority = new WatchOnlyAuthority(accounts, {
    readBalance: () => (++calls === 1 ? first.promise : second.promise),
  });
  authority.unlock();
  const pending = authority.refresh();
  authority.selectNetwork('base');
  authority.selectNetwork('ethereum');
  first.resolve({ chainId: 1, units: '999' });
  await pending;
  assert.equal(authority.getSnapshot().balance.status, 'unknown');
  const next = authority.refresh();
  authority.lock();
  second.resolve({ chainId: 1, units: '123' });
  await next;
  assert.equal(authority.getSnapshot().status, 'locked');
  assert.equal(authority.getSnapshot().balance.status, 'unknown');
  await assert.rejects(authority.refresh(), /locked/);
});

test('a newer refresh wins when concurrent responses finish out of order', async () => {
  const first = deferred<{ chainId: number; units: string }>();
  const second = deferred<{ chainId: number; units: string }>();
  let calls = 0;
  const authority = new WatchOnlyAuthority(accounts, {
    readBalance: () => (++calls === 1 ? first.promise : second.promise),
  });
  authority.unlock();
  const pendingFirst = authority.refresh();
  const pendingSecond = authority.refresh();
  second.resolve({ chainId: 1, units: '200' });
  await pendingSecond;
  first.resolve({ chainId: 1, units: '100' });
  await pendingFirst;
  const balance = authority.getSnapshot().balance;
  assert.equal(balance.status, 'available');
  if (balance.status === 'available') assert.equal(balance.units, '200');
});

test('public persistence accepts only bounded public account data and never calls getters', () => {
  assert.equal(
    validatePublicAccounts(accounts)[0]!.addresses.ethereum,
    ADDRESS_A
  );
  assert.throws(
    () =>
      validatePublicAccounts([{ ...accounts[0], seed: 'not a wallet seed' }]),
    /Unexpected/
  );
  assert.throws(
    () => validatePublicAccounts([accounts[0], accounts[0]]),
    /identity/
  );
  assert.throws(
    () => validatePublicAccounts([{ ...accounts[0], addresses: {} }]),
    /At least/
  );
  assert.throws(
    () => validatePublicAccounts([{ ...accounts[0], name: 'x'.repeat(41) }]),
    /name/
  );
  let invoked = false;
  const evil = {
    get name() {
      invoked = true;
      return 'hidden';
    },
  };
  assert.throws(() => validatePublicAccounts([evil]));
  assert.equal(invoked, false);
  const cycle: any = [];
  cycle.push(cycle);
  assert.throws(() => validatePublicAccounts(cycle));
  const copy = validatePublicAccounts(accounts);
  assert.equal(Object.isFrozen(copy[0]!.addresses), true);
});

test('review computes exact maximum debit and requires unchanged context before expiry', () => {
  const review = createTransferReview(
    { recipient: ADDRESS_B, amount: '0.009007199254740993' },
    context,
    '10000000000000000',
    '1000',
    1000
  );
  assert.equal(review.amountUnits, '9007199254740993');
  assert.equal(review.totalUnits, '9007199254741993');
  assert.equal(Object.isFrozen(review.context), true);
  assert.doesNotThrow(() => assertReviewCurrent(review, context, 1001));
  assert.throws(
    () => assertReviewCurrent(review, { ...context, generation: 3 }, 1001),
    /context/
  );
  assert.throws(
    () =>
      assertReviewCurrent(
        review,
        { ...context, endpoint: 'https://other.invalid' },
        1001
      ),
    /context/
  );
  assert.throws(() => assertReviewCurrent(review, context, 61000), /expired/);
  assert.throws(
    () =>
      createTransferReview(
        { recipient: ADDRESS_B, amount: '1' },
        context,
        '1000000000000000000',
        '1',
        1000
      ),
    /Insufficient/
  );
});

test('watch-only capabilities and authority both refuse signing', async () => {
  let networkReads = 0;
  const authority = new WatchOnlyAuthority(accounts, {
    async readBalance() {
      networkReads++;
      return { chainId: 1, units: '0' };
    },
  });
  authority.unlock();
  assert.equal(authority.getSnapshot().capabilities.send, false);
  assert.equal(
    authority.getSnapshot().capabilities.importRecoveryPhrase,
    false
  );
  await assert.rejects(
    authority.prepareTransfer({ recipient: ADDRESS_B, amount: '1' }),
    /SIGNING_UNAVAILABLE/
  );
  const review = createTransferReview(
    { recipient: ADDRESS_B, amount: '1' },
    context,
    '2000000000000000000',
    '1',
    1000
  );
  await assert.rejects(
    authority.confirmTransfer(review),
    /SIGNING_UNAVAILABLE/
  );
  assert.equal(networkReads, 0);
});
