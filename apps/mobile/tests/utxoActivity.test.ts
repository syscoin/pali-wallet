import assert from 'node:assert/strict';
import test from 'node:test';
import { createUtxoActivityReader, parseUtxoActivityTransaction, UtxoWatchActivity, type UtxoActivityContext } from '../src/core/utxoActivity.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { normalizeUtxoAddress } from '../src/core/utxoAddresses.ts';
import { WatchOnlyAuthority } from '../src/core/watchOnlyAuthority.ts';
const BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', SYS = 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58';
const H = 'a'.repeat(64), BLOCK = 'b'.repeat(64), ID = (n: number) => n.toString(16).padStart(64, '0');
const owner: UtxoActivityContext = { accountId: 'watch', networkId: 'bitcoin', address: BTC, generation: 1 };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const status = (network = getUtxoNetwork('bitcoin')) => ({ blockbook: { coin: network.blockbookCoin, network: network.symbol, decimals: 8, initialSync: false, inSync: true, inSyncMempool: true, bestHeight: 200 }, backend: { chain: 'main' } });
function tx(id = ID(1), address = BTC) {
  return { txid: id, blockHeight: 190, blockHash: BLOCK, confirmations: 12, blockTime: 1700000000, valueIn: '1100000000', value: '1000000000', fees: '100000000',
    vin: [{ n: 0, txid: ID(900), isAddress: true, addresses: [address], value: '1100000000' }],
    vout: [{ n: 0, isAddress: true, addresses: [address], value: '100000000' }, { n: 1, isAddress: true, addresses: ['1OtherLegacyScript'], value: '900000000' }] };
}
function fixture(options: { count?: number; replace?: (path: string, value: any, calls: string[]) => unknown; network?: 'bitcoin' | 'syscoin'; address?: string; hold?: (path: string) => Promise<void> } = {}) {
  const calls: string[] = [], signals: AbortSignal[] = [];
  const network = getUtxoNetwork(options.network ?? 'bitcoin'), address = options.address ?? (network.id === 'bitcoin' ? BTC : SYS);
  const count = options.count ?? 23;
  let active = 0, maximum = 0;
  const fetch = async (url: string, init: RequestInit) => {
    assert.ok(url.startsWith(network.endpoint));
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    const path = url.slice(network.endpoint.length); calls.push(path); signals.push(init.signal!);
    active++; maximum = Math.max(maximum, active);
    try {
      await options.hold?.(path);
      let value: any;
      if (path === '/api/') value = status(network);
      else if (path === '/api/v2/block-index/0') value = { blockHash: network.genesisHash };
      else if (path.startsWith('/api/v2/block-index/')) value = { blockHash: path.endsWith('/200') ? H : BLOCK };
      else if (path.startsWith('/api/v2/address/')) {
        const query = new URL(url).searchParams, page = Number(query.get('page'));
        assert.equal(query.get('to'), '200'); assert.equal(query.get('details'), 'txids'); assert.equal(query.get('pageSize'), '20');
        value = { address, txs: count, unconfirmedTxs: 0, page, totalPages: Math.max(1, Math.ceil(count / 20)), itemsOnPage: 20,
          txids: Array.from({ length: Math.min(20, Math.max(0, count - (page - 1) * 20)) }, (_, i) => ID((page - 1) * 20 + i + 1)) };
      } else if (path.startsWith('/api/v2/tx/')) value = tx(path.split('/').at(-1), address);
      else throw Error('Unplanned URL');
      const replacement = options.replace?.(path, value, calls);
      return replacement instanceof Response ? replacement : json(replacement ?? value);
    } finally { active--; }
  };
  return { calls, signals, fetch, maximum: () => maximum };
}
const signal = () => new AbortController().signal;

test('explicit reader validates identity before disclosure, hydrates twenty with two workers and anchors every page', async () => {
  const f = fixture({ hold: async () => { await new Promise(r => setImmediate(r)); } }), reader = createUtxoActivityReader(f);
  assert.equal(f.calls.length, 0);
  const page = await reader.readPage(owner, { page: 1 }, signal());
  assert.deepEqual(f.calls.slice(0, 4), ['/api/', '/api/v2/block-index/0', '/api/v2/block-index/200', `/api/v2/address/${BTC}?details=txids&pageSize=20&page=1&to=200`]);
  assert.equal(page.rows.length, 20); assert.equal(page.rows[0]?.netUnits, '-1000000000'); assert.equal(page.rows[0]?.observedConfirmations, 11);
  assert.equal(page.hasMore, true); assert.equal(f.maximum(), 2); assert.ok(f.signals.every(s => s.aborted));
  assert.equal(f.calls.filter(p => p === '/api/v2/block-index/190').length, 1);
  const second = await reader.readPage(owner, { page: 2, anchor: page.anchor }, signal());
  assert.equal(second.rows.length, 3); assert.equal(second.hasMore, false); assert.deepEqual(second.anchor, page.anchor);
  assert.ok(Object.isFrozen(page) && Object.isFrozen(page.rows) && Object.isFrozen(page.rows[0]?.block));
});

test('Syscoin uses its own fixed registration and never interprets SPT amounts or metadata', async () => {
  const f = fixture({ network: 'syscoin', count: 1, replace(path, value) { if (path.includes('/tx/')) return { ...value, tokenType: 'SPT', memo: 'secret-looking text', tokenTransfers: [{ value: '999999999999' }], vout: value.vout.map((v: any) => ({ ...v, assetInfo: { symbol: '<img>', value: '999999999999' } })) }; } });
  const page = await createUtxoActivityReader(f).readPage({ ...owner, networkId: 'syscoin', address: SYS }, { page: 1 }, signal());
  assert.equal(page.rows[0]?.hasUnsupportedAssetData, true); assert.equal(page.rows[0]?.netUnits, '-1000000000');
  assert.ok(!JSON.stringify(page).includes('999999') && !JSON.stringify(page).includes('<img>') && !JSON.stringify(page).includes('memo'));
});

test('zero results require valid paging; missing txids is an empty indexed range, not an error', async () => {
  const f = fixture({ count: 0, replace(path, value) { if (path.includes('/address/')) { delete value.txids; return value; } } });
  const page = await createUtxoActivityReader(f).readPage(owner, { page: 1 }, signal());
  assert.equal(page.rows.length, 0); assert.equal(page.hasMore, false); assert.equal(f.calls.some(p => p.includes('/tx/')), false);
});

test('bad local context or paging rejects before any HTTP', async () => {
  const f = fixture(), reader = createUtxoActivityReader(f);
  for (const bad of [{ ...owner, networkId: 'ethereum' }, { ...owner, address: SYS }, { ...owner, generation: -1 }]) await assert.rejects(reader.readPage(bad as UtxoActivityContext, { page: 1 }, signal()));
  for (const request of [{ page: 0 }, { page: 6 }, { page: 2 }, { page: 1, anchor: { height: 200, hash: H } }]) await assert.rejects(reader.readPage(owner, request, signal()));
  assert.equal(f.calls.length, 0);
});

test('metadata/genesis mismatch and zero-height sentinel never disclose the address', async () => {
  for (const kind of ['coin', 'sync', 'genesis', 'height']) {
    const f = fixture({ replace(path, value) {
      if (path === '/api/' && kind === 'coin') value.blockbook.coin = 'Other';
      if (path === '/api/' && kind === 'sync') value.blockbook.inSyncMempool = false;
      if (path === '/api/' && kind === 'height') value.blockbook.bestHeight = 0;
      if (path.endsWith('/0') && kind === 'genesis') value.blockHash = H;
      return value;
    } });
    await assert.rejects(createUtxoActivityReader(f).readPage(owner, { page: 1 }, signal()));
    assert.equal(f.calls.some(p => p.includes('/address/')), false);
  }
});

test('page capacity, count, identity, clamping and duplicate-ID anomalies reject atomically', async () => {
  for (const change of [(v: any) => { v.address = SYS; }, (v: any) => { v.page = 2; }, (v: any) => { v.itemsOnPage = 19; },
    (v: any) => { v.totalPages = 0; }, (v: any) => { v.txids = [ID(1), ID(1)]; }, (v: any) => { v.txids = [ID(1).toUpperCase() + 'x']; },
    (v: any) => { v.txids = Array.from({ length: 21 }, (_, i) => ID(i)); }, (v: any) => { delete v.unconfirmedTxs; }]) {
    const f = fixture({ replace(path, value) { if (path.includes('/address/')) change(value); return value; } });
    await assert.rejects(createUtxoActivityReader(f).readPage(owner, { page: 1 }, signal())); assert.ok(f.signals.every(s => s.aborted));
  }
});

test('unknown total pages stays bounded and page five reports the display cap', async () => {
  const f = fixture({ count: 120, replace(path, value) { if (path.includes('/address/')) value.totalPages = -1; return value; } });
  const value = await createUtxoActivityReader(f).readPage(owner, { page: 5, anchor: { height: 200, hash: H } }, signal());
  assert.equal(value.rows.length, 20); assert.equal(value.hasMore, false); assert.equal(value.limitReached, true);
});

test('native arithmetic distinguishes input/output/fee/net, large exact amounts, zero net and coinbase', () => {
  const at = { height: 200, hash: H }, source = tx();
  const original = parseUtxoActivityTransaction(source, ID(1), owner, at);
  assert.equal(original.spentUnits, '1100000000'); assert.equal(original.receivedUnits, '100000000'); assert.equal(original.transactionFeeUnits, '100000000');
  const large = '900719925474099300'; source.vin[0]!.value = large; source.vout[0]!.value = large; source.vout.pop(); source.valueIn = large; source.value = large; source.fees = '0';
  const equal = parseUtxoActivityTransaction(source, ID(1), owner, at); assert.equal(equal.netUnits, '0'); assert.equal(equal.receivedUnits, large);
  const coinbase = { ...tx(), vin: [{ n: 0, isAddress: false, coinbase: '0102' }], valueIn: '0', fees: '0' };
  const reward = parseUtxoActivityTransaction(coinbase, ID(1), owner, at); assert.equal(reward.spentUnits, '0'); assert.equal(reward.netUnits, '100000000'); assert.equal(reward.transactionFeeUnits, null);
});

test('missing input/native values and unverified unrelated transaction do not become zero', () => {
  for (const change of [(v: any) => { delete v.vin[0].value; }, (v: any) => { v.fees = '0'; }, (v: any) => { v.valueIn = '01'; },
    (v: any) => { v.value = '1'; }, (v: any) => { v.vin[0].n = 1; }, (v: any) => { v.vout[0].addresses = ['other']; v.vin[0].addresses = ['other']; },
    (v: any) => { v.vin[0].value = '1'; v.valueIn = '1'; v.fees = '0'; }, (v: any) => { v.vout[0].addresses.push('other'); }]) {
    const value = tx(); change(value); assert.throws(() => parseUtxoActivityTransaction(value, ID(1), owner, { height: 200, hash: H }));
  }
});

test('wrong tx identity, pending/above-anchor rows and block reorg invalidate the page', async () => {
  for (const mode of ['id', 'pending', 'future', 'block', 'anchor']) {
    const f = fixture({ count: 1, replace(path, value, calls) {
      if (path.includes('/tx/') && mode === 'id') value.txid = ID(99);
      if (path.includes('/tx/') && mode === 'pending') value.confirmations = 0;
      if (path.includes('/tx/') && mode === 'future') value.blockHeight = 201;
      if (path.endsWith('/190') && mode === 'block') value.blockHash = H;
      if (path.endsWith('/200') && mode === 'anchor' && calls.filter(p => p.endsWith('/200')).length > 1) value.blockHash = BLOCK;
      return value;
    } });
    await assert.rejects(createUtxoActivityReader(f).readPage(owner, { page: 1 }, signal()));
  }
});

test('later pages verify original anchor before disclosing address and reject changed chain', async () => {
  const f = fixture({ replace(path, value) { if (path.endsWith('/199')) value.blockHash = BLOCK; return value; } });
  await assert.rejects(createUtxoActivityReader(f).readPage(owner, { page: 2, anchor: { height: 199, hash: H } }, signal()));
  assert.equal(f.calls.some(p => p.includes('/address/')), false);
});

test('response ceilings, bad JSON and HTTP errors are not empty history', async () => {
  for (const response of [new Response('x'.repeat(32769)), new Response('{bad'), new Response('not found', { status: 404 })]) {
    const f = fixture({ replace(path) { if (path.includes('/address/')) return response; } });
    await assert.rejects(createUtxoActivityReader(f).readPage(owner, { page: 1 }, signal())); assert.ok(f.signals.every(s => s.aborted));
  }
});

test('aggregate byte limit includes ignored padding across detail and block reads', async () => {
  const f = fixture({ count: 20, replace(path, value) {
    if (path.includes('/tx/')) value.blockHeight = 150 + Number(BigInt('0x' + value.txid));
    if (path.includes('/tx/') || path.includes('/block-index/')) value.padding = 'x'.repeat(30000);
    return value;
  } });
  await assert.rejects(createUtxoActivityReader(f).readPage(owner, { page: 1 }, signal())); assert.ok(f.signals.every(s => s.aborted));
});

function authority() {
  return new WatchOnlyAuthority([{ id: 'a', name: 'First', addresses: { bitcoin: BTC } }, { id: 'b', name: 'Second', addresses: { syscoin: SYS } }], { async readBalance() { throw Error(); } });
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test('controller has no I/O on activation, explicit loads only, and successful page appends without duplicates', async () => {
  const a = authority(); a.unlock(); const f = fixture(); const c = new UtxoWatchActivity(a, createUtxoActivityReader(f), () => true); c.activate();
  assert.equal(f.calls.length, 0); await c.refresh(); await c.loadMore(); assert.equal(f.calls.length, 0);
  await c.load(); assert.equal(c.getSnapshot().rows.length, 20); await c.loadMore(); assert.equal(c.getSnapshot().rows.length, 23);
  c.dispose(); assert.equal(c.getSnapshot().status, 'consent'); assert.equal(c.getSnapshot().rows.length, 0);
});

test('failed more retains only previous page as stale and requires explicit refresh', async () => {
  let fail = false; const a = authority(); a.unlock();
  const f = fixture({ replace(path) { if (fail && path.includes('/address/')) return new Response('', { status: 503 }); } });
  const c = new UtxoWatchActivity(a, createUtxoActivityReader(f), () => true); c.activate(); await c.load(); fail = true; await c.loadMore();
  assert.equal(c.getSnapshot().status, 'stale'); assert.equal(c.getSnapshot().rows.length, 20); assert.equal(c.getSnapshot().hasMore, false);
  const calls = f.calls.length; await c.loadMore(); assert.equal(f.calls.length, calls); fail = false; await c.refresh(); assert.equal(c.getSnapshot().status, 'ready'); c.dispose();
});

test('cross-page duplicate rejection never appends or pretends the history ended', async () => {
  const a = authority(); a.unlock(); const f = fixture({ replace(path, value) { if (path.includes('page=2&')) value.txids = [ID(1)]; return value; } });
  const c = new UtxoWatchActivity(a, createUtxoActivityReader(f), () => true); c.activate(); await c.load(); await c.loadMore();
  assert.equal(c.getSnapshot().status, 'stale'); assert.equal(c.getSnapshot().rows.length, 20); c.dispose();
});

test('A-B-A, lock and screen revocation cancel ignored-signal work and never reactivate it', async () => {
  for (const mode of ['aba', 'lock', 'screen']) {
    const a = authority(); a.unlock(); const hold = gate(), entered = gate();
    const f = fixture({ async hold(path) { if (path.includes('/address/')) { entered.resolve(); await hold.promise; } } });
    const c = new UtxoWatchActivity(a, createUtxoActivityReader(f), () => true); c.activate(); const pending = c.load(); await entered.promise;
    if (mode === 'aba') { a.selectAccount('b'); a.selectAccount('a'); } else if (mode === 'lock') { a.lock(); a.unlock(); } else c.revoke();
    hold.resolve(); await pending; assert.equal(c.getSnapshot().status, 'consent'); assert.equal(c.getSnapshot().rows.length, 0); c.dispose();
  }
});

test('foreground gate denies dispatch and a synchronous observer can revoke publication', async () => {
  const a = authority(); a.unlock(); let active = false; const f = fixture(); const c = new UtxoWatchActivity(a, createUtxoActivityReader(f), () => active); c.activate(); await c.load(); assert.equal(f.calls.length, 0);
  active = true; c.subscribe(() => { if (c.getSnapshot().status === 'ready') a.lock(); }); await c.load(); assert.equal(c.getSnapshot().rows.length, 0); c.dispose();
});

test('page request is detached before the first asynchronous read', async () => {
  const pause = gate(), entered = gate();
  const f = fixture({ count: 1, async hold(path) { if (path === '/api/') { entered.resolve(); await pause.promise; } } });
  const request = { page: 1 };
  const pending = createUtxoActivityReader(f).readPage(owner, request, signal());
  await entered.promise; request.page = 999999; pause.resolve();
  assert.equal((await pending).page, 1); assert.ok(f.calls.some(path => path.includes('page=1&')));
});

test('timeout settles ignored transport and does not accept its late response', async () => {
  let finish!: (response: Response) => void;
  const reader = createUtxoActivityReader({ timeoutMs: 5, fetch: () => new Promise(resolve => { finish = resolve; }) });
  await assert.rejects(reader.readPage(owner, { page: 1 }, signal()));
  finish(json(status())); await new Promise(r => setImmediate(r));
});

test('redirect and response URL mismatch fail before any address disclosure', async () => {
  for (const changed of [{ redirected: true }, { url: 'https://different.invalid/api/' }]) {
    let calls = 0;
    const reader = createUtxoActivityReader({ async fetch() {
      calls++; return Object.assign({ ok: true, headers: new Headers(), body: null, text: async () => JSON.stringify(status()), redirected: false, url: '' }, changed) as Response;
    } });
    await assert.rejects(reader.readPage(owner, { page: 1 }, signal())); assert.equal(calls, 1);
  }
});

test('duplicate load actions share no extra I/O and focus loss requires a fresh action', async () => {
  const a = authority(); a.unlock(); const pause = gate(), entered = gate();
  const f = fixture({ async hold(path) { if (path.includes('/address/')) { entered.resolve(); await pause.promise; } } });
  const c = new UtxoWatchActivity(a, createUtxoActivityReader(f), () => true); c.activate();
  const pending = c.load(); await entered.promise; await c.load(); await c.loadMore();
  assert.equal(f.calls.filter(p => p.includes('/address/')).length, 1);
  c.setFocused(false); pause.resolve(); await pending; assert.equal(c.getSnapshot().status, 'consent');
  const calls = f.calls.length; await c.load(); c.setFocused(true); assert.equal(f.calls.length, calls); c.dispose();
});


const BASE58_OWNERS = [
  ['P2PKH', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
  ['P2SH', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
] as const;
for (const [kind, address] of BASE58_OWNERS) {
  test(`${kind} activity preserves canonical Base58 ownership for outgoing, incoming and zero-net amounts`, () => {
    assert.equal(normalizeUtxoAddress(address, 'bitcoin'), address);
    const scope = { ...owner, address }, at = { height: 200, hash: H };
    const outgoing = parseUtxoActivityTransaction(tx(ID(1), address), ID(1), scope, at);
    assert.equal(outgoing.spentUnits, '1100000000');
    assert.equal(outgoing.receivedUnits, '100000000');
    assert.equal(outgoing.netUnits, '-1000000000');
    const incoming = tx(ID(1), address);
    incoming.vin[0]!.addresses = ['1UnrelatedScript'];
    const received = parseUtxoActivityTransaction(incoming, ID(1), scope, at);
    assert.equal(received.spentUnits, '0'); assert.equal(received.receivedUnits, '100000000'); assert.equal(received.netUnits, '100000000');
    const self = tx(ID(1), address);
    self.vout = [{ ...self.vout[0]!, value: '1100000000' }];
    self.value = self.valueIn; self.fees = '0';
    const same = parseUtxoActivityTransaction(self, ID(1), scope, at);
    assert.equal(same.spentUnits, '1100000000'); assert.equal(same.receivedUnits, '1100000000'); assert.equal(same.netUnits, '0');
  });

  test(`${kind} full activity page uses exact-case address and retains verified transaction direction`, async () => {
    const f = fixture({ address, count: 1 });
    const page = await createUtxoActivityReader(f).readPage({ ...owner, address }, { page: 1 }, signal());
    assert.equal(page.context.address, address);
    assert.equal(page.rows.length, 1); assert.equal(page.rows[0]!.netUnits, '-1000000000');
    assert(f.calls.includes(`/api/v2/address/${address}?details=txids&pageSize=20&page=1&to=200`));
    assert(f.signals.every(value => value.aborted));
  });

  test(`${kind} unrelated addresses and case variants are never attributed to the owner`, () => {
    const scope = { ...owner, address }, at = { height: 200, hash: H };
    const other = BASE58_OWNERS.find(([, value]) => value !== address)![1];
    const caseVariant = address.toLowerCase();
    assert.notEqual(caseVariant, address);
    for (const destination of [other, caseVariant, 'OP_RETURN 0102']) {
      const raw = tx(ID(1), address);
      raw.vout[0]!.addresses = [destination];
      if (destination.startsWith('OP_RETURN')) raw.vout[0]!.isAddress = false;
      const row = parseUtxoActivityTransaction(raw, ID(1), scope, at);
      assert.equal(row.spentUnits, '1100000000'); assert.equal(row.receivedUnits, '0'); assert.equal(row.netUnits, '-1100000000');
    }
  });

  test(`${kind} claimed ownership still requires an address and one bounded source`, () => {
    for (const change of [
      (raw: ReturnType<typeof tx>) => { raw.vin[0]!.isAddress = false; },
      (raw: ReturnType<typeof tx>) => { raw.vin[0]!.addresses.push('unrelated'); },
      (raw: ReturnType<typeof tx>) => { raw.vin[0]!.addresses = [address, ...Array(8).fill('unrelated')]; },
    ]) {
      const raw = tx(ID(1), address); change(raw);
      assert.throws(() => parseUtxoActivityTransaction(raw, ID(1), { ...owner, address }, { height: 200, hash: H }));
    }
  });
}

test('Bech32 uppercase normalizes for ownership while mixed-case ownership still fails closed', () => {
  const at = { height: 200, hash: H };
  const upper = parseUtxoActivityTransaction(tx(ID(1), BTC.toUpperCase()), ID(1), owner, at);
  assert.equal(upper.spentUnits, '1100000000'); assert.equal(upper.receivedUnits, '100000000');
  const mixed = BTC.slice(0, 4).toUpperCase() + BTC.slice(4);
  assert.throws(() => parseUtxoActivityTransaction(tx(ID(1), mixed), ID(1), owner, at));
});
