import test from 'node:test';
import assert from 'node:assert/strict';
import { NativePortfolioController } from '../src/portfolio/nativePortfolio.ts';
import type { PublicCustodySource } from '../src/portfolio/nativePortfolio.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';
import type { BalanceReader } from '../src/core/watchOnlyAuthority.ts';
import { NATIVE_NETWORKS } from '../src/custody/networkContext.ts';
import type { UtxoBalance } from '../src/core/utxoBalanceReader.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { UTXO_ADDRESSES } from './publicWatchFixtures.ts';
import { createBalanceReader, RPC_ENDPOINTS } from '../src/platformRpc.ts';

const A = '0x52908400098527886E0F7030069857D2E4169EE7';
const B = '0x8617E340B3D01FA5F11F306F4090FD50E238070D';
const ready = (address = A, revision = 1): CustodySnapshot => ({
  phase: 'ready', revision, presence: 'existing', backup: 'confirmed',
  account: { network: 'ethereum', address }, error: null,
});
class Source implements PublicCustodySource {
  value: CustodySnapshot;
  reads = 0;
  listeners = new Set<(snapshot: CustodySnapshot) => void>();
  constructor(value = ready()) { this.value = value; }
  getSnapshot = () => { this.reads++; return this.value; };
  subscribe = (listener: (snapshot: CustodySnapshot) => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  set(value: CustodySnapshot, notify = true) {
    this.value = value;
    if (notify) for (const listener of [...this.listeners]) listener(value);
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(source = new Source(), now: () => number = () => 1000) {
  const calls: (ReturnType<typeof deferred<{ chainId: number; units: string }>> & {
    network: string; address: string; signal: AbortSignal;
  })[] = [];
  const reader: BalanceReader = {
    readBalance(network, address, signal) {
      const call = { ...deferred<{ chainId: number; units: string }>(), network, address, signal };
      calls.push(call);
      return call.promise;
    },
  };
  return { source, calls, controller: new NativePortfolioController(source, reader, now) };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const response = (id: number, result: unknown) => new Response(
  JSON.stringify({ jsonrpc: '2.0', id, result }),
  { headers: { 'Content-Type': 'application/json' } }
);

test('construction and detached reads have no source or network side effects; zero is known', async () => {
  const f = fixture();
  const { getSnapshot, subscribe } = f.controller;
  assert.deepEqual(getSnapshot(), { account: null, status: 'unavailable', units: null, updatedAt: null });
  assert.equal(f.source.reads, 0);
  assert.equal(f.source.listeners.size, 0);
  const statuses: string[] = [];
  const stop = subscribe(value => statuses.push(value.status));
  const disconnect = f.controller.connect();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.network, 'ethereum');
  assert.equal(f.calls[0]!.address, A);
  assert.equal(getSnapshot().status, 'loading');
  f.calls[0]!.resolve({ chainId: 1, units: '0' }); await tick();
  const value = getSnapshot();
  assert.deepEqual(value, { account: { address: A, network: 'ethereum', revision: 1 }, status: 'available', units: '0', updatedAt: 1000 });
  assert.equal(value, getSnapshot());
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.account), true);
  assert.equal(f.controller.isCurrent(value.account), true);
  assert.deepEqual(statuses, ['unknown', 'loading', 'available']);
  stop(); disconnect();
});

test('all non-ready or invalid public custody states stay unavailable without requests', async () => {
  const values: CustodySnapshot[] = [
    ...(['opening', 'empty', 'locked', 'authenticating', 'backup-required', 'unavailable', 'disposed'] as const).map(phase => ({ ...ready(), phase })),
    { ...ready(), account: null },
    ready('not-an-address'), ready('0x' + '0'.repeat(40)), ready(` ${A}`),
    ready('0x52908400098527886e0F7030069857D2E4169EE7'),
    ready(A, -1), ready(A, 0.5), ready(A, NaN), ready(A, Number.MAX_SAFE_INTEGER + 1),
    { ...ready(), account: { network: 'syscoin', address: A } } as unknown as CustodySnapshot,
    { ...ready(), account: { network: 'unknown', address: A } } as unknown as CustodySnapshot,
  ];
  for (const value of values) {
    const f = fixture(new Source(value)); const disconnect = f.controller.connect();
    await f.controller.refresh();
    assert.equal(f.calls.length, 0);
    assert.equal(f.controller.getSnapshot().status, 'unavailable');
    assert.equal(f.controller.getActiveAccount(), null);
    assert.equal(f.controller.isCurrent({ address: A, network: 'ethereum', revision: 1 }), false);
    disconnect();
  }
});

for (const outcome of ['success', 'failure'] as const) {
  test(`lock aborts and clears synchronously; late ${outcome} is ignored even if the reader ignores abort`, async () => {
    const f = fixture(); const disconnect = f.controller.connect();
    const original = f.controller.getActiveAccount();
    f.source.set({ ...ready(), phase: 'locked', account: null, revision: 2 });
    assert.equal(f.calls[0]!.signal.aborted, true);
    assert.deepEqual(f.controller.getSnapshot(), { account: null, status: 'unavailable', units: null, updatedAt: null });
    assert.equal(f.controller.isCurrent(original), false);
    if (outcome === 'success') f.calls[0]!.resolve({ chainId: 1, units: '999' });
    else f.calls[0]!.reject(new Error('SECRET transport credentials'));
    await tick();
    assert.equal(f.controller.getSnapshot().status, 'unavailable'); disconnect();
  });
}

test('an earlier custody observer sees no old balance or address before this source listener runs', async () => {
  const source = new Source(); const f = fixture(source);
  let observed: ReturnType<typeof f.controller.getSnapshot> | undefined;
  source.subscribe(() => { observed = f.controller.getSnapshot(); });
  const disconnect = f.controller.connect(); f.calls[0]!.resolve({ chainId: 1, units: '77' }); await tick();
  source.set(ready(B, 2));
  assert.equal(observed?.account?.address, B);
  assert.equal(observed?.status, 'unknown');
  assert.equal(observed?.units, null);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1]!.address, B); disconnect();
});

for (const outcome of ['success', 'failure'] as const) {
  test(`completion revalidates a silent source change before publishing ${outcome}`, async () => {
    const f = fixture(); const disconnect = f.controller.connect();
    f.source.set({ ...ready(), phase: 'locked', account: null, revision: 2 }, false);
    if (outcome === 'success') f.calls[0]!.resolve({ chainId: 1, units: '88' });
    else f.calls[0]!.reject(new Error('private reader failure'));
    await tick();
    assert.equal(f.calls[0]!.signal.aborted, true);
    assert.equal(f.controller.getSnapshot().status, 'unavailable'); disconnect();
  });
}

test('address changes, revision-only changes, and A-B-A switches cannot publish stale observations', async () => {
  const f = fixture(); const disconnect = f.controller.connect();
  const first = f.controller.getActiveAccount();
  f.source.set(ready(B, 2));
  assert.equal(f.calls[0]!.signal.aborted, true);
  f.source.set(ready(A, 3));
  assert.equal(f.calls[1]!.signal.aborted, true);
  f.calls[0]!.resolve({ chainId: 1, units: '100' });
  f.calls[1]!.reject(new Error('stale B')); await tick();
  assert.equal(f.controller.getSnapshot().status, 'loading');
  assert.equal(f.controller.isCurrent(first), false);
  f.calls[2]!.resolve({ chainId: 1, units: '300' }); await tick();
  assert.equal(f.controller.getSnapshot().units, '300');
  f.source.set(ready(A, 4));
  assert.equal(f.controller.getSnapshot().status, 'loading');
  assert.equal(f.controller.getSnapshot().units, null);
  assert.equal(f.calls.length, 4); disconnect();
});

test('an unchanged canonical scope does not restart the read', () => {
  const f = fixture(new Source(ready(A.toLowerCase()))); const disconnect = f.controller.connect();
  const account = f.controller.getActiveAccount();
  f.source.set(ready(A)); f.source.set(ready(A.toLowerCase()));
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.getActiveAccount(), account); disconnect();
});

for (const outcome of ['success', 'failure'] as const) {
  test(`newer manual refresh wins over an old ${outcome}`, async () => {
    const f = fixture(); const disconnect = f.controller.connect();
    const next = f.controller.refresh();
    assert.equal(f.calls[0]!.signal.aborted, true);
    f.calls[1]!.resolve({ chainId: 1, units: '9007199254740993' }); await next;
    if (outcome === 'success') f.calls[0]!.resolve({ chainId: 1, units: '1' });
    else f.calls[0]!.reject(new Error('stale private error'));
    await tick();
    assert.equal(f.controller.getSnapshot().units, '9007199254740993'); disconnect();
  });
}

test('disconnect clears synchronously and replayed connections ignore old cleanup and responses', async () => {
  const f = fixture(); const oldCleanup = f.controller.connect();
  oldCleanup();
  assert.equal(f.calls[0]!.signal.aborted, true);
  assert.equal(f.source.listeners.size, 0);
  assert.equal(f.controller.getSnapshot().status, 'unavailable');
  await f.controller.refresh(); assert.equal(f.calls.length, 1);
  const cleanup = f.controller.connect(); oldCleanup();
  assert.equal(f.source.listeners.size, 1);
  assert.equal(f.calls[1]!.signal.aborted, false);
  f.calls[0]!.resolve({ chainId: 1, units: '100' }); await tick();
  assert.equal(f.controller.getSnapshot().status, 'loading');
  f.calls[1]!.resolve({ chainId: 1, units: '200' }); await tick();
  assert.equal(f.controller.getSnapshot().units, '200'); cleanup();
});

test('locking from a loading observer prevents even the initial reader call', () => {
  const f = fixture();
  f.controller.subscribe(value => { if (value.status === 'loading') f.source.set({ ...ready(), phase: 'locked', account: null, revision: 2 }); });
  const disconnect = f.controller.connect();
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.getSnapshot().status, 'unavailable'); disconnect();
});

test('current failures expose error state without raw error text or a false zero', async () => {
  const f = fixture(); const disconnect = f.controller.connect();
  f.calls[0]!.reject(new Error('SECRET RPC URL or credential')); await tick();
  assert.deepEqual(f.controller.getSnapshot(), { account: { network: 'ethereum', address: A, revision: 1 }, status: 'error', units: null, updatedAt: null });
  assert.equal(JSON.stringify(f.controller.getSnapshot()).includes('SECRET'), false); disconnect();
});

test('wrong chain identity and non-canonical or out-of-range units fail closed', async () => {
  const invalid: unknown[] = [
    { chainId: 8453, units: '1' }, { chainId: '1', units: '1' }, null,
    ...['', '00', '01', '+1', '-1', '1.0', '1e3', ' 1', '1 ', '0x1', (1n << 256n).toString(), 1, 1n, null].map(units => ({ chainId: 1, units })),
  ];
  for (const result of invalid) {
    const f = fixture(); const disconnect = f.controller.connect();
    f.calls[0]!.resolve(result as { chainId: number; units: string }); await tick();
    assert.equal(f.controller.getSnapshot().status, 'error');
    assert.equal(f.controller.getSnapshot().units, null); disconnect();
  }
  const f = fixture(); const disconnect = f.controller.connect();
  const max = ((1n << 256n) - 1n).toString();
  f.calls[0]!.resolve({ chainId: 1, units: max }); await tick();
  assert.equal(f.controller.getSnapshot().units, max); disconnect();
});

test('invalid observation clocks do not produce an available balance', async () => {
  for (const now of [() => NaN, () => -1, () => Infinity]) {
    const f = fixture(new Source(), now); const disconnect = f.controller.connect();
    f.calls[0]!.resolve({ chainId: 1, units: '0' }); await tick();
    assert.equal(f.controller.getSnapshot().status, 'error'); disconnect();
  }
});

test('response fields are captured once and custody is checked again after validation', async () => {
  const f = fixture(); const disconnect = f.controller.connect(); let reads = 0;
  f.calls[0]!.resolve({ chainId: 1, get units() { reads++; return reads === 1 ? '7' : 'bad'; } }); await tick();
  assert.equal(reads, 1); assert.equal(f.controller.getSnapshot().units, '7');
  const next = f.controller.refresh();
  f.calls[1]!.resolve({ chainId: 1, get units() { f.source.set({ ...ready(), phase: 'locked', account: null, revision: 2 }, false); return '8'; } }); await next;
  assert.equal(f.controller.getSnapshot().status, 'unavailable'); disconnect();
});

test('actual balance reader checks chain before sending the canonical public address and preserves exact units', async () => {
  const requests: { url: string; method: string; params: unknown[] }[] = [];
  const reader = createBalanceReader({ fetch: async (url, init) => {
    const call = JSON.parse(String(init.body)); requests.push({ url, method: call.method, params: call.params });
    return response(call.id, call.method === 'eth_chainId' ? '0x1' : '0x20000000000001');
  } });
  const source = new Source(ready(A.toLowerCase()));
  const controller = new NativePortfolioController(source, reader, () => 10);
  const disconnect = controller.connect(); await controller.refresh();
  assert.equal(controller.getSnapshot().status, 'available');
  assert.equal(controller.getSnapshot().units, '9007199254740993');
  const balance = requests.find(call => call.method === 'eth_getBalance');
  assert.deepEqual(balance, { url: RPC_ENDPOINTS.ethereum, method: 'eth_getBalance', params: [A, 'latest'] });
  assert.equal(requests[0]!.method, 'eth_chainId'); disconnect();
});

test('actual reader wrong-chain, malformed responses and ignored cancellation never become a balance', async () => {
  for (const reply of ['0x2105', '0x01']) {
    let requests = 0;
    const reader = createBalanceReader({ fetch: async (_, init) => { requests++; const { id } = JSON.parse(String(init.body)); return response(id, reply); } });
    const controller = new NativePortfolioController(new Source(), reader);
    const disconnect = controller.connect(); await controller.refresh();
    assert.equal(controller.getSnapshot().status, 'error');
    assert.equal(requests, 2); // cancelled first refresh and one explicit refresh: chain calls only
    disconnect();
  }
  let requests = 0;
  const delayed = deferred<Response>();
  const reader = createBalanceReader({ fetch: async () => { requests++; return delayed.promise; } });
  const source = new Source(); const controller = new NativePortfolioController(source, reader);
  const disconnect = controller.connect();
  source.set({ ...ready(), phase: 'locked', account: null, revision: 2 });
  delayed.resolve(response(1, '0x1')); await tick();
  assert.equal(requests, 1);
  assert.equal(controller.getSnapshot().status, 'unavailable'); disconnect();
});


for (const outcome of ['success', 'failure'] as const) {
  test(`a disconnected request's late ${outcome} cannot restore public state`, async () => {
    const f = fixture(); const disconnect = f.controller.connect();
    disconnect();
    if (outcome === 'success') f.calls[0]!.resolve({ chainId: 1, units: '42' });
    else f.calls[0]!.reject(new Error('private disconnected failure'));
    await tick();
    assert.deepEqual(f.controller.getSnapshot(), { account: null, status: 'unavailable', units: null, updatedAt: null });
  });

  test(`a silent address change invalidates late ${outcome} before publication`, async () => {
    const f = fixture(); const disconnect = f.controller.connect();
    const previous = f.controller.getActiveAccount();
    f.source.set(ready(B, 2), false);
    if (outcome === 'success') f.calls[0]!.resolve({ chainId: 1, units: '42' });
    else f.calls[0]!.reject(new Error('private old address failure'));
    await tick();
    assert.equal(f.calls[0]!.signal.aborted, true);
    assert.deepEqual(f.controller.getSnapshot(), { account: { address: B, network: 'ethereum', revision: 2 }, status: 'unknown', units: null, updatedAt: null });
    assert.equal(f.controller.isCurrent(previous), false);
    disconnect();
  });
}

test('ready balance clears synchronously on lock, and observer exceptions do not block invalidation', async () => {
  const f = fixture();
  f.controller.subscribe(() => { throw new Error('observer failure'); });
  const disconnect = f.controller.connect();
  f.calls[0]!.resolve({ chainId: 1, units: '100' }); await tick();
  assert.equal(f.controller.getSnapshot().status, 'available');
  f.source.set({ ...ready(), phase: 'locked', account: null, revision: 2 });
  assert.equal(f.controller.getActiveAccount(), null);
  assert.deepEqual(f.controller.getSnapshot(), { account: null, status: 'unavailable', units: null, updatedAt: null });
  disconnect();
});

test('actual balance reader zero remains available rather than unknown or failed', async () => {
  const reader = createBalanceReader({ fetch: async (_, init) => {
    const call = JSON.parse(String(init.body));
    return response(call.id, call.method === 'eth_chainId' ? '0x1' : '0x0');
  } });
  const controller = new NativePortfolioController(new Source(), reader, () => 0);
  const disconnect = controller.connect(); await controller.refresh();
  assert.equal(controller.getSnapshot().status, 'available');
  assert.equal(controller.getSnapshot().units, '0');
  assert.equal(controller.getSnapshot().updatedAt, 0); disconnect();
});

test('an address rendered before an unannounced source change cannot authorize a public action', () => {
  const f = fixture(); const disconnect = f.controller.connect();
  const rendered = f.controller.getSnapshot().account;
  assert.equal(rendered?.address, A);
  f.source.set(ready(B, 2), false);
  const disclosed: string[] = [];
  // A UI action must use its rendered account, never substitute a newer one.
  if (rendered && f.controller.isCurrent(rendered)) disclosed.push(rendered.address);
  assert.deepEqual(disclosed, []);
  assert.equal(f.calls[0]!.signal.aborted, true);
  assert.equal(f.controller.getSnapshot().account?.address, B);
  assert.equal(f.controller.getSnapshot().status, 'unknown');
  assert.equal(f.calls.length, 1); // Reading the gate itself starts no request.
  f.source.set(ready(B, 2));
  assert.equal(f.calls.length, 2); disconnect();
});


test('every registered EVM chain reads the selected network and refuses a wrong-chain observation', async () => {
  for (const network of NATIVE_NETWORKS) {
    const source = new Source({ ...ready(), account: { network: network.id, address: A } });
    const f = fixture(source);
    const stop = f.controller.connect();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0]!.network, network.id);
    f.calls[0]!.resolve({ chainId: Number(network.chainId), units: '1500000000000000000' });
    await tick();
    assert.equal(f.controller.getSnapshot().status, 'available');
    const current = f.controller.getActiveAccount();
    assert.equal(current?.network, network.id);
    assert.equal(current?.address, A);
    const pending = f.controller.refresh();
    f.calls[1]!.resolve({ chainId: Number(network.chainId) + 1, units: '0' });
    await pending;
    assert.equal(f.controller.getSnapshot().status, 'error');
    assert.equal(f.controller.getSnapshot().units, null);
    stop();
  }
});

test('network A-B-A discards old balances even with identical address and a reused public revision', async () => {
  const f = fixture(); const stop = f.controller.connect();
  const original = f.controller.getActiveAccount();
  f.source.set({ ...ready(), account: { network: 'base', address: A } });
  assert.equal(f.calls[0]!.signal.aborted, true);
  assert.equal(f.controller.isCurrent(original), false);
  f.source.set(ready());
  assert.equal(f.calls[1]!.signal.aborted, true);
  assert.equal(f.calls.length, 3);
  f.calls[0]!.resolve({ chainId: 1, units: '10' });
  f.calls[1]!.resolve({ chainId: 8453, units: '20' });
  await tick();
  assert.equal(f.controller.getSnapshot().status, 'loading');
  f.calls[2]!.resolve({ chainId: 1, units: '30' }); await tick();
  assert.equal(f.controller.getSnapshot().units, '30');
  stop();
});


test('UTXO portfolio exposes exact native and SYSX units only for the selected registration', async () => {
  const network = getUtxoNetwork('syscoin');
  const address = UTXO_ADDRESSES.syscoin;
  const source = new Source({ ...ready(), account: { network: network.id, address } });
  const calls: (ReturnType<typeof deferred<UtxoBalance>> & { signal: AbortSignal })[] = [];
  const controller = new NativePortfolioController(source, {
    async readBalance() { assert.fail('UTXO balance must not enter EVM transport'); },
    readUtxoBalance(id, selectedAddress, signal) {
      assert.equal(id, network.id);
      assert.equal(selectedAddress, address);
      const call = { ...deferred<UtxoBalance>(), signal };
      calls.push(call);
      return call.promise;
    },
  }, () => 1000);
  const disconnect = controller.connect();
  try {
    const result: UtxoBalance = { networkId: network.id, kind: 'utxo', chainId: network.chainId,
      genesisHash: network.genesisHash, confirmedUnits: '9007199254740993', pendingDeltaUnits: '-123',
      unconfirmedTransactions: 1, observedHeight: 42,
      sysx: { confirmedUnits: '9007199254740995', pendingDeltaUnits: '-1' } };
    calls[0]!.resolve({ ...result, genesisHash: '0'.repeat(64) });
    await tick();
    assert.equal(controller.getSnapshot().status, 'error');
    const good = controller.refresh();
    calls[1]!.resolve(result);
    await good;
    assert.equal(controller.getSnapshot().units, '9007199254740993');
    assert.equal(controller.getSnapshot().pendingDeltaUnits, '-123');
    assert.deepEqual(controller.getSnapshot().sysx, result.sysx);
    const late = controller.refresh();
    source.set({ ...ready(address, 2), phase: 'locked', account: null });
    assert.equal(calls[2]!.signal.aborted, true);
    calls[2]!.resolve(result);
    await late;
    assert.deepEqual(controller.getSnapshot(), { account: null, status: 'unavailable', units: null, updatedAt: null });
  } finally { disconnect(); }
});
