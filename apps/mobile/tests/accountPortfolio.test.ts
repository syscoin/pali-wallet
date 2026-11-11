import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountPortfolioController } from '../src/portfolio/accountPortfolio.ts';
import { createPortfolioFilter } from '../src/portfolio/portfolioFilter.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import type { PublicCustodySource } from '../src/portfolio/nativePortfolio.ts';
import type { NotificationChoice } from '../src/notifications/choices.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(initialFilter: string | null = 'ethereum', networks = ['ethereum', 'base'], tokenDecimals = 2, tokenCount = 1) {
  let saved = initialFilter, selected = 0, revision = 1, phase = 'ready';
  const accounts = Array.from({ length: 15 }, (_, index) => ({ id: `hd:60:${index}`, address: `0x${(index + 1).toString(16).padStart(40, '0')}`, type: 'HDAccount', label: `Account ${index + 1}`, index, slip44: 60 }));
  const choices: NotificationChoice[] = accounts.flatMap(account => networks.map(id => ({ label: account.label, networkName: getNativeNetwork(id).name, symbol: getNativeNetwork(id).symbol,
    scope: { id: `native:${account.id}:${id}`, accountId: account.id, accountType: account.type, accountAddress: account.address, network: getNativeNetwork(id), guardian: false } })));
  const listeners = new Set<() => void>();
  const source = { getSnapshot: () => ({ phase, revision, account: { address: accounts[selected]!.address, network: 'ethereum' } }),
    getCatalogue: () => ({ revision, active: { accountId: accounts[selected]!.id, networkId: 'ethereum' }, accounts, networks: networks.map(id => getNativeNetwork(id)), utxoNetworks: [] }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } } as unknown as PublicCustodySource;
  const reads: string[] = [], tokens: string[] = [], prices: string[] = [];
  let held: Promise<void> | undefined;
  let quoteHeld: Promise<void> | undefined;
  let tokenQuoteHeld: Promise<void> | undefined;
  let rejectPrices = false, includeCollectible = false, activeQuotes = 0, maximumQuotes = 0;
  const quoteSignals: AbortSignal[] = [];
  const price = async (kind: 'native' | 'token', choice: NotificationChoice, currency: string, signal: AbortSignal) => {
    prices.push(`${kind}:${choice.scope.network.id}`); quoteSignals.push(signal);
    maximumQuotes = Math.max(maximumQuotes, ++activeQuotes);
    try {
      await (kind === 'native' ? quoteHeld : tokenQuoteHeld);
      if (rejectPrices) throw Error('Market unavailable');
      return kind === 'native' ? currency === 'eur' ? 20 : 10 : currency === 'eur' ? 4 : 2;
    } finally { activeQuotes--; }
  };
  const preference = createPortfolioFilter({ get: async () => saved, set: async value => { saved = value; } });
  const make = (filter = preference) => {
    const model = new AccountPortfolioController({ source, choices: () => choices, filter,
      reader: { async readBalance(network, address) { reads.push(`${network}:${address}`); await held; return { chainId: Number(getNativeNetwork(network).chainId), units: '1000000000000000000' }; } },
      async assets(scope, _signal, check) { check(); tokens.push(`${scope.network.id}:${scope.accountId}`); return {
        tokens: Array.from({ length: tokenCount }, (_, index) => ({ metadata: { contractAddress: `0x${(index + 1).toString(16).padStart(40, '0')}`, name: 'Saved token', symbol: 'TOK', decimals: tokenDecimals }, status: 'available' as const, units: tokenDecimals === 255 ? '1' : '250' })),
        collectibles: includeCollectible ? [{ collectible: { contractAddress: '0x' + 'ab'.repeat(20), tokenStandard: 'ERC-721' as const }, status: 'available' as const, units: '1' }] : [] }; },
      nativePrice: (choice, currency, signal) => price('native', choice, currency, signal),
      tokenPrice: (choice, _token, currency, signal) => price('token', choice, currency, signal),
    });
    model.setCurrency('usd'); return model;
  };
  return { make, preference, reads, tokens, prices, accounts, quoteSignals, maximumQuotes: () => maximumQuotes,
    hold(value: Promise<void>) { held = value; },
    holdQuote(value: Promise<void>) { quoteHeld = value; },
    holdTokenQuote(value: Promise<void>) { tokenQuoteHeld = value; },
    rejectPrices() { rejectPrices = true; },
    includeCollectible() { includeCollectible = true; },
    select(index: number) { selected = index; revision++; for (const listener of listeners) listener(); },
    lock() { phase = 'locked'; revision++; for (const listener of listeners) listener(); } };
}

test('restored concrete filter reads only the selected account, despite 15 saved accounts', async () => {
  const f = fixture(), model = f.make(), stop = model.connect();
  try {
    await settle();
    assert.deepEqual(f.reads, [`ethereum:${f.accounts[0]!.address}`]);
    assert.deepEqual(f.tokens, ['ethereum:hd:60:0']);
    assert.deepEqual(f.prices, ['native:ethereum', 'token:ethereum']);
    assert.equal(model.getSnapshot().knownValue, 15);
    assert.equal(model.getSnapshot().partial, false);
  } finally { stop(); }
});

test('no balance, token, or quote is requested while the saved filter is unresolved', async () => {
  const f = fixture(), pending = Promise.withResolvers<string>();
  const model = f.make({ load: () => pending.promise, save: async () => {} }), stop = model.connect();
  try {
    await settle(); assert.deepEqual([f.reads, f.tokens, f.prices], [[], [], []]);
    pending.resolve('base'); await settle();
    assert.deepEqual(f.reads, [`base:${f.accounts[0]!.address}`]);
  } finally { stop(); }
});

test('concrete filter persists across controller recreation without hidden-network reads', async () => {
  const f = fixture(), first = f.make(), stop = first.connect();
  await settle(); await first.selectFilter('base'); stop(); f.reads.length = 0; f.tokens.length = 0; f.prices.length = 0;
  const second = f.make(), close = second.connect();
  try {
    await settle(); assert.equal(second.getSnapshot().filter, 'base');
    assert.deepEqual(f.reads, [`base:${f.accounts[0]!.address}`]);
    assert.deepEqual(f.tokens, ['base:hd:60:0']);
    assert.deepEqual(f.prices, ['native:base', 'token:base']);
  } finally { close(); }
});

test('switching accounts clears previous values and refreshes only the newly selected owner', async () => {
  const f = fixture(), model = f.make(), stop = model.connect();
  try {
    await settle(); f.reads.length = 0; f.tokens.length = 0;
    f.select(14); await settle();
    assert.deepEqual(f.reads, [`ethereum:${f.accounts[14]!.address}`]);
    assert.deepEqual(f.tokens, ['ethereum:hd:60:14']);
    assert.equal(model.getSnapshot().accountId, 'hd:60:14');
    assert.equal(model.cachedBalances().length, 1);
  } finally { stop(); }
});

test('All networks uses only the selected account scopes and excludes testnets from fiat', async () => {
  const f = fixture(null, ['ethereum', 'base', 'syscoin-nevm-testnet']), model = f.make(), stop = model.connect();
  try {
    await settle(); assert.equal(model.getSnapshot().filter, 'all');
    assert.deepEqual(f.reads.map(read => read.split(':')[0]).sort(), ['base', 'ethereum', 'syscoin-nevm-testnet']);
    assert(f.reads.every(read => read.endsWith(f.accounts[0]!.address)));
    assert.equal(model.getSnapshot().knownValue, 30);
    assert(f.prices.every(read => !read.includes('testnet')));
    assert.equal(f.tokens.length, 3);
  } finally { stop(); }
});

test('testnet filter shows its assets with no fiat quotes or pretend currency total', async () => {
  const f = fixture('syscoin-nevm-testnet', ['ethereum', 'syscoin-nevm-testnet']), model = f.make(), stop = model.connect();
  try { await settle(); assert.equal(model.getSnapshot().rows.length, 1); assert.equal(model.getSnapshot().knownValue, null); assert.deepEqual(f.prices, []); }
  finally { stop(); }
});

test('picker cache lookup never fetches an unfetched network', async () => {
  const f = fixture(), model = f.make(), stop = model.connect();
  try { await settle(); assert.deepEqual(model.cachedBalances(), [{ networkId: 'ethereum', available: '1.0', loading: false }]); assert.equal(f.reads.length, 1); }
  finally { stop(); }
});

test('unknown or unavailable saved filters never fall back to All', async () => {
  for (const filter of ['deleted-network', 'invalid filter']) {
    const f = fixture(filter), model = f.make(), stop = model.connect();
    try { await settle(); assert.deepEqual([f.reads, f.tokens, f.prices], [[], [], []]); assert.equal(model.getSnapshot().rows.length, 0); }
    finally { stop(); }
  }
});

test('lock retires every pending owner observation without publishing cached balances', async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.hold(held.promise);
  const model = f.make(), stop = model.connect();
  try {
    await settle(); f.lock(); held.resolve(); await settle();
    assert.equal(model.getSnapshot().status, 'unavailable'); assert.deepEqual(model.cachedBalances(), []); assert.deepEqual(f.tokens, []);
  } finally { stop(); }
});

test('currency changes clear old quotes before displaying the new currency', async () => {
  const f = fixture(), model = f.make(), stop = model.connect();
  try {
    await settle(); assert.equal(model.getSnapshot().knownValue, 15);
    model.setCurrency('eur');
    assert.equal(model.getSnapshot().knownValue, null);
    assert.equal(model.getSnapshot().currency, 'eur');
    await settle(); assert.equal(model.getSnapshot().knownValue, 30);
  } finally { stop(); }
});

test('a late quote from the previous currency cannot repopulate the current total', async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.holdQuote(held.promise);
  const model = f.make(), stop = model.connect();
  try {
    await settle(); assert.equal(model.cachedBalances()[0]?.available, '1.0');
    model.setCurrency('eur'); await settle(); held.resolve(); await settle();
    assert.equal(model.getSnapshot().currency, 'eur'); assert.equal(model.getSnapshot().knownValue, 30);
    assert.equal(model.getSnapshot().rows[0]?.price, 20);
  } finally { stop(); }
});

test('a tracked token with 255 decimals keeps its observed units without failing the network row', async () => {
  const f = fixture('ethereum', ['ethereum'], 255), model = f.make(), stop = model.connect();
  try { await settle(); assert.equal(model.getSnapshot().rows[0]?.status, 'available'); assert.equal(model.getSnapshot().rows[0]?.tokens[0]?.units, '1'); }
  finally { stop(); }
});

test('overlapping All then Base writes serialize and only the latest intent reads, including after reopen', async () => {
  const f = fixture(), oldWrite = Promise.withResolvers<void>();
  let saved: string | null = 'ethereum';
  const writes: string[] = [];
  const preference = createPortfolioFilter({
    get: async () => saved,
    async set(value) { writes.push(value); if (value === 'all') await oldWrite.promise; saved = value; },
  });
  const model = f.make(preference), stop = model.connect();
  await settle(); f.reads.length = 0; f.tokens.length = 0;
  const first = model.selectFilter('all'), latest = model.selectFilter('base');
  await settle(); assert.deepEqual(writes, ['all']); assert.deepEqual(f.reads, []);
  oldWrite.resolve(); await Promise.all([first, latest]);
  assert.deepEqual(writes, ['all', 'base']); assert.equal(saved, 'base'); assert.equal(model.getSnapshot().filter, 'base');
  assert.deepEqual(f.reads, [`base:${f.accounts[0]!.address}`]); stop();
  f.reads.length = 0; const reopened = f.make(preference), close = reopened.connect();
  try { await settle(); assert.equal(reopened.getSnapshot().filter, 'base'); assert.deepEqual(f.reads, [`base:${f.accounts[0]!.address}`]); }
  finally { close(); }
});

test('a detached view never exposes account A values while account B awaits reconnection', async () => {
  const f = fixture(), model = f.make(), stop = model.connect();
  await settle(); assert.equal(model.getSnapshot().knownValue, 15);
  stop(); f.select(14);
  const detached = model.getSnapshot();
  assert.equal(detached.knownValue, null); assert.deepEqual(detached.rows, []);
  assert.strictEqual(model.getSnapshot(), detached);
  assert.deepEqual(model.cachedBalances(), []);
  const close = model.connect();
  try { await settle(); assert.equal(model.getSnapshot().accountId, 'hd:60:14'); }
  finally { close(); }
});

test('a pending narrowing filter blocks source-change and manual refresh IO, then applies to the current owner', async () => {
  const f = fixture(), write = Promise.withResolvers<void>();
  let saved: string | null = 'all';
  const preference = createPortfolioFilter({ get: async () => saved, async set(value) { await write.promise; saved = value; } });
  const model = f.make(preference), stop = model.connect();
  try {
    await settle(); f.reads.length = 0; f.tokens.length = 0;
    const narrowing = model.selectFilter('base');
    f.select(14); await model.refresh(); await settle();
    assert.deepEqual(f.reads, []); assert.deepEqual(f.tokens, []);
    write.resolve(); await narrowing;
    assert.equal(model.getSnapshot().filter, 'base');
    assert.deepEqual(f.reads, [`base:${f.accounts[14]!.address}`]);
    assert.deepEqual(f.tokens, ['base:hd:60:14']);
  } finally { stop(); }
});

test('held market quotes never hide token or NFT balances or delay later network reads', async () => {
  const f = fixture(null, ['ethereum', 'base', 'arbitrum']), held = Promise.withResolvers<void>();
  f.holdQuote(held.promise); f.holdTokenQuote(held.promise); f.includeCollectible();
  const model = f.make(), stop = model.connect();
  try {
    await settle();
    assert.equal(f.reads.length, 3);
    assert.equal(f.tokens.length, 3);
    assert.equal(f.prices.length, 2, 'only two optional quotes run concurrently');
    assert.equal(model.getSnapshot().refreshing, true);
    for (const row of model.getSnapshot().rows) {
      assert.equal(row.status, 'available');
      assert.equal(row.assetsAvailable, true);
      assert.equal(row.tokens[0]?.units, '250');
      assert.equal(row.tokens[0]?.price, null);
      assert.equal(row.collectibles[0]?.units, '1');
      assert.equal(model.cachedAssets(row.choice.scope.network.id)?.tokens[0]?.units, '250');
    }
    held.resolve(); await settle();
    assert.equal(model.getSnapshot().refreshing, false);
    assert.equal(f.maximumQuotes(), 2);
  } finally { held.resolve(); stop(); }
});

test('rejected optional prices leave healthy native, token and NFT observations available', async () => {
  const f = fixture(); f.rejectPrices(); f.includeCollectible();
  const model = f.make(), stop = model.connect();
  try {
    await settle();
    const snapshot = model.getSnapshot(), row = snapshot.rows[0]!;
    assert.equal(snapshot.refreshing, false);
    assert.equal(row.status, 'available');
    assert.equal(row.units, '1000000000000000000');
    assert.equal(row.assetsAvailable, true);
    assert.equal(row.tokens[0]?.units, '250');
    assert.equal(row.collectibles[0]?.units, '1');
    assert.equal(row.price, null); assert.equal(row.tokens[0]?.price, null);
    assert.equal(snapshot.partial, true);
  } finally { stop(); }
});

test('all optional quotes share one eight-second budget and ignore late results', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture('ethereum', ['ethereum'], 2, 256), held = Promise.withResolvers<void>();
  f.holdQuote(held.promise); f.holdTokenQuote(held.promise);
  const model = f.make(), stop = model.connect();
  try {
    await settle();
    assert.equal(model.getSnapshot().rows[0]?.tokens.length, 256);
    assert.equal(f.prices.length, 2);
    context.mock.timers.tick(7_999); await settle();
    assert.equal(model.getSnapshot().refreshing, true);
    context.mock.timers.tick(1); await settle();
    assert.equal(model.getSnapshot().refreshing, false);
    assert.equal(f.prices.length, 2, 'queued quotes must not start after the shared deadline');
    assert.equal(f.maximumQuotes(), 2);
    assert(f.quoteSignals.every(signal => signal.aborted));
    const expired = model.getSnapshot();
    held.resolve(); await settle();
    assert.strictEqual(model.getSnapshot(), expired);
    assert.equal(expired.rows[0]?.status, 'available');
    assert.equal(expired.rows[0]?.price, null);
    assert(expired.rows[0]?.tokens.every(token => token.units === '250' && token.price === null));
  } finally { held.resolve(); stop(); context.mock.timers.reset(); }
});

test('account changes abort held quotes and old results cannot price the new owner', async () => {
  const f = fixture(), held = Promise.withResolvers<void>();
  f.holdQuote(held.promise); f.holdTokenQuote(held.promise);
  const model = f.make(), stop = model.connect();
  try {
    await settle();
    const oldSignals = [...f.quoteSignals];
    assert.equal(oldSignals.length, 2);
    f.holdQuote(Promise.resolve()); f.holdTokenQuote(Promise.resolve());
    f.select(14); await settle();
    assert(oldSignals.every(signal => signal.aborted));
    const current = model.getSnapshot();
    assert.equal(current.accountId, 'hd:60:14');
    assert.equal(current.refreshing, false);
    assert.equal(current.knownValue, 15);
    held.resolve(); await settle();
    assert.strictEqual(model.getSnapshot(), current);
  } finally { held.resolve(); stop(); }
});
