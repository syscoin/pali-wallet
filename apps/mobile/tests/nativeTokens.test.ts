import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers/abi';
import {
  NativeTokens,
  type CollectibleQuery,
  type NativeTokenRuntime,
} from '../src/portfolio/nativeTokens.ts';
import { createNftOwnershipReader } from '../src/portfolio/nftOwnershipReadRpc.ts';
import type { Erc20Reader } from '../src/portfolio/erc20ReadRpc.ts';
import type {
  OwnedTokenReader,
  OwnedTokenSuggestions,
} from '../src/portfolio/ownedTokenReader.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';
import {
  createNativeNetwork,
  getNativeNetwork,
} from '../src/custody/networkContext.ts';
import type { NativeWalletCatalogueSnapshot } from '../src/custody/walletCatalogue.ts';
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const metadata = {
  contractAddress: '0x3333333333333333333333333333333333333333',
  decimals: 255,
  name: 'Token',
  symbol: 'TOKEN',
};
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function fixture(
  options: {
    items?: (typeof metadata)[];
    reader?: Erc20Reader;
    readHoldings?: OwnedTokenReader;
    readNft?: ReturnType<typeof createNftOwnershipReader>;
    getCatalogue?: () => NativeWalletCatalogueSnapshot | null;
  } = {}
) {
  let state: CustodySnapshot = {
    phase: 'ready',
    revision: 1,
    presence: 'existing',
    backup: 'confirmed',
    account: { address: A, network: 'ethereum' },
    error: null,
  };
  const listeners = new Set<(snapshot: CustodySnapshot) => void>();
  const mutations: { kind: string; address: string }[] = [];
  let items = options.items ?? [];
  let revision = 0;
  const source = {
    getSnapshot: () => state,
    getCatalogue: options.getCatalogue,
    subscribe: (listener: (snapshot: CustodySnapshot) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const runtime: NativeTokenRuntime = {
    async load(guard) {
      guard();
      return { revision, items };
    },
    async add(expected, token, guard) {
      guard();
      assert.equal(expected, revision);
      mutations.push({ kind: 'add', address: state.account!.address });
      items = [...items, token];
      return { revision: ++revision, items };
    },
    async remove(expected, contract, guard) {
      guard();
      assert.equal(expected, revision);
      mutations.push({ kind: 'remove', address: state.account!.address });
      items = items.filter((item) => item.contractAddress !== contract);
      return { revision: ++revision, items };
    },
  };
  const reader = options.reader ?? {
    async readToken() {
      return { metadata, units: '0' };
    },
    async readBalance() {
      return { units: '0' };
    },
  };
  const model = new NativeTokens(
    source,
    () => runtime,
    reader,
    () => 123,
    undefined,
    options.readHoldings,
    options.readNft
  );
  const change = (
    address: string | null,
    notify = true,
    network: 'ethereum' | 'base' = 'ethereum'
  ) => {
    state = {
      ...state,
      revision: state.revision + 1,
      phase: address ? 'ready' : 'locked',
      account: address ? { address, network } : null,
    };
    if (notify) for (const listener of [...listeners]) listener(state);
  };
  return {
    model,
    source,
    change,
    mutations,
    listenerCount: () => listeners.size,
  };
}

test('manual collectible checks use the selected registered RPC without an explorer or token mutation', async () => {
  const selected = createNativeNetwork({
    ...getNativeNetwork('ethereum'),
    rpcUrl: 'https://manual-collectible.invalid/rpc',
  });
  const abi = new Interface([
    'function balanceOf(address,uint256) view returns (uint256)',
    'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
  ]);
  const max = (1n << 256n) - 1n;
  const calls: string[] = [];
  const block = { number: '0x100', hash: `0x${'a'.repeat(64)}` };
  const readNft = createNftOwnershipReader({
    registrations: () => [selected],
    async fetch(url, init) {
      assert.equal(url, selected.rpcUrl);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      const { id, method, params } = JSON.parse(String(init.body));
      const respond = (result: unknown) => Response.json({ jsonrpc: '2.0', id, result });
      calls.push(method);
      if (method === 'eth_chainId') return respond('0x1');
      if (method === 'eth_getBlockByNumber') return respond(block);
      if (method === 'eth_getCode') {
        assert.deepEqual(params, [B, block.number]);
        return respond('0x6000');
      }
      assert.equal(method, 'eth_call');
      assert.equal(params[0].to, B);
      assert.equal(params[1], block.number);
      const call = abi.parseTransaction(params[0])!;
      if (call.name === 'balanceOf') {
        assert.equal(call.args[0], A);
        assert.notEqual(call.args[1], max);
        return respond(abi.encodeFunctionResult(call.name, [0]));
      }
      assert.equal(call.name, 'balanceOfBatch');
      assert.deepEqual(Array.from(call.args[0]), [A]);
      assert.deepEqual(Array.from(call.args[1]), [max]);
      return respond(abi.encodeFunctionResult(call.name, [[max]]));
    },
  });
  const f = fixture({
    getCatalogue: () => ({
      revision: 0, accounts: [], networks: [selected],
      active: { accountId: 'hd:60:0', networkId: selected.id },
    }),
    async readHoldings() { assert.fail('Manual ownership must not use the explorer'); },
    readNft,
  });
  const disconnect = f.model.connect();
  await tick();
  const { account, canCheckCollectible, discovery } = f.model.getSnapshot();
  assert.ok(account);
  assert.equal(canCheckCollectible, true);
  assert.equal(discovery, null);
  assert.deepEqual(calls, []);
  const query: CollectibleQuery = { contractAddress: B, tokenStandard: 'ERC-1155', tokenId: `0x${max.toString(16)}` };
  const signal = new AbortController().signal;
  for (const invalid of [
    { ...query, contractAddress: 'example.eth' },
    { ...query, contractAddress: `0x${'0'.repeat(40)}` },
    { ...query, tokenId: '1e2' },
    { ...query, tokenStandard: 'ERC-20' as CollectibleQuery['tokenStandard'] },
  ]) {
    await assert.rejects(f.model.view.checkManualCollectible(account, invalid, signal), { code: 'INVALID_INPUT' });
  }
  await assert.rejects(f.model.view.checkManualCollectible({ ...account }, query, signal), /CANCELLED/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await f.model.view.checkManualCollectible(account, query, signal), {
    tokenId: max.toString(), units: max.toString(),
  });
  assert.deepEqual(calls, [
    'eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_call',
    'eth_getBlockByNumber', 'eth_chainId',
  ]);
  assert.deepEqual(f.mutations, []);
  disconnect();
});

test('manual collectible checks reject stale account capabilities and cancel on scope revocation', async () => {
  const original = getNativeNetwork('ethereum');
  const replacement = createNativeNetwork({ ...original, rpcUrl: 'https://replacement.invalid' });
  const query: CollectibleQuery = { contractAddress: B, tokenStandard: 'ERC-721', tokenId: '7' };
  for (const retire of ['edit', 'lock', 'account', 'registration', 'catalogue'] as const) {
    let selected = original;
    let hasCatalogue = true;
    const held = deferred<{ tokenId: string; units: string }>();
    let operation: AbortSignal | undefined;
    let reads = 0;
    const f = fixture({
      getCatalogue: () => hasCatalogue ? {
        revision: 0, accounts: [], networks: [selected],
        active: { accountId: 'hd:60:0', networkId: selected.id },
      } : null,
      readNft(input, signal, current) {
        current();
        assert.deepEqual(input, { ...query, networkId: selected.id, owner: A });
        operation = signal;
        return ++reads === 1 ? held.promise : Promise.resolve({ tokenId: '7', units: '1' });
      },
    });
    const disconnect = f.model.connect();
    await tick();
    const { account } = f.model.getSnapshot();
    assert.ok(account);
    const abort = new AbortController();
    const lookup = f.model.view.checkManualCollectible(account, query, abort.signal);
    const cancelled = assert.rejects(lookup, /CANCELLED/);
    if (retire === 'edit') abort.abort();
    else if (retire === 'lock') f.change(null);
    else if (retire === 'account') { f.change(B); f.change(A); }
    else if (retire === 'registration') {
      selected = replacement;
      f.model.getSnapshot();
      selected = original;
    } else {
      hasCatalogue = false;
      assert.equal(f.model.getSnapshot().canCheckCollectible, undefined);
      hasCatalogue = true;
    }
    assert.equal(operation?.aborted, true, retire);
    if (retire === 'lock') f.change(A);
    const current = f.model.getSnapshot().account!;
    if (retire !== 'edit')
      await assert.rejects(f.model.view.checkManualCollectible(account, query, new AbortController().signal), /CANCELLED/);
    assert.deepEqual(await f.model.view.checkManualCollectible(current, query, new AbortController().signal), { tokenId: '7', units: '1' });
    held.resolve({ tokenId: '7', units: '0' });
    await cancelled;
    assert.equal(reads, 2);
    disconnect();
  }
});

test('manual and explorer ownership checks share admission without relaxing suggestion membership', async () => {
  const item = Object.freeze({
    contractAddress: B, name: 'Example', tokenStandard: 'ERC-1155' as const, tokenId: '7', units: '99',
  });
  const query: CollectibleQuery = { contractAddress: B, tokenStandard: 'ERC-1155', tokenId: '7' };
  const held = deferred<{ tokenId: string; units: string }>();
  let reads = 0;
  const f = fixture({
    async readHoldings() { return { tokens: [], collectibles: [item], limited: false }; },
    readNft() { return ++reads === 1 ? held.promise : Promise.resolve({ tokenId: '7', units: '0' }); },
  });
  const disconnect = f.model.connect();
  await tick();
  await f.model.discover('collectibles');
  const { account } = f.model.getSnapshot();
  assert.ok(account);
  const signal = new AbortController().signal;
  await assert.rejects(f.model.view.checkCollectible({ ...item }, '7', signal), /CANCELLED/);
  await assert.rejects(f.model.view.checkCollectible(item, '8', signal), /CANCELLED/);
  const selected = f.model.view.checkCollectible(item, '7', signal);
  await assert.rejects(f.model.view.checkManualCollectible(account, query, signal), /CANCELLED/);
  held.resolve({ tokenId: '7', units: '1' });
  assert.deepEqual(await selected, { tokenId: '7', units: '1' });
  assert.deepEqual(await f.model.view.checkManualCollectible(account, query, signal), { tokenId: '7', units: '0' });
  assert.equal(reads, 2);
  disconnect();
});

test('explicit holdings lookup reserves one request and cannot add or replace verified preview metadata', async () => {
  const held = deferred<OwnedTokenSuggestions>();
  let requests = 0;
  const f = fixture({
    readHoldings(scope) {
      requests++;
      assert.equal(scope.address, A);
      assert.equal(scope.chainId, 1);
      assert.equal(new URL(scope.apiUrl).hostname, 'api.routescan.io');
      return held.promise;
    },
  });
  const disconnect = f.model.connect();
  await tick();
  assert.equal(requests, 0);
  assert.equal(f.model.getSnapshot().discovery?.status, 'idle');
  f.model.subscribe(() => {
    if (f.model.getSnapshot().discovery?.status === 'loading')
      void f.model.discover();
  });
  const lookup = f.model.discover();
  await f.model.discover();
  assert.equal(requests, 1);
  f.model.cancelPreview(); // Typing a manual contract neither starts nor cancels discovery.
  held.resolve({
    tokens: [
      {
        contractAddress: metadata.contractAddress,
        name: 'Provider suggestion',
        symbol: 'HINT',
      },
    ],
    limited: false,
  });
  await lookup;
  assert.equal(f.model.getSnapshot().discovery?.status, 'ready');
  assert.equal(f.model.getSnapshot().preview, null);
  await f.model.confirmPreview();
  assert.equal(f.mutations.length, 0);
  await f.model.preview(metadata.contractAddress);
  assert.deepEqual(f.model.getSnapshot().preview?.metadata, metadata);
  assert.equal(f.mutations.length, 0);
  await f.model.confirmPreview();
  assert.equal(f.mutations.length, 1);
  disconnect();
});

test('Back, account A-B-A, lock and disconnect abort discovery and discard late results', async () => {
  for (const retire of ['back', 'aba', 'lock', 'disconnect'] as const) {
    const held = deferred<OwnedTokenSuggestions>();
    let signal: AbortSignal | undefined;
    let requests = 0;
    const f = fixture({
      readHoldings(_scope, _saved, requestSignal) {
        requests++;
        signal = requestSignal;
        return held.promise;
      },
    });
    const disconnect = f.model.connect();
    await tick();
    const lookup = f.model.discover();
    if (retire === 'back') f.model.closeDiscovery();
    if (retire === 'lock') f.change(null);
    if (retire === 'disconnect') disconnect();
    if (retire === 'aba') {
      f.change(B, true, 'base');
      await tick();
      await f.model.discover();
      assert.equal(f.model.getSnapshot().discovery, null);
      f.change(A);
      await tick();
    }
    assert.equal(signal?.aborted, true, retire);
    assert.equal(requests, 1, retire);
    await lookup;
    held.resolve({ tokens: [metadata], limited: false });
    await tick();
    assert.equal(
      f.model.getSnapshot().discovery?.status ?? null,
      retire === 'back' || retire === 'aba' ? 'idle' : null,
      retire
    );
    assert.equal(f.mutations.length, 0);
    disconnect();
  }
});

test('discovery failure leaves manual preview usable and a later explicit retry can show an empty result', async () => {
  let requests = 0;
  const f = fixture({
    async readHoldings() {
      if (++requests === 1) throw new Error('Public indexer unavailable');
      return { tokens: [], limited: false };
    },
  });
  const disconnect = f.model.connect();
  await tick();
  await f.model.discover();
  assert.equal(f.model.getSnapshot().discovery?.status, 'error');
  await f.model.preview(metadata.contractAddress);
  assert.equal(
    f.model.getSnapshot().preview?.metadata.contractAddress,
    metadata.contractAddress
  );
  f.model.cancelPreview();
  await f.model.discover();
  assert.deepEqual(f.model.getSnapshot().discovery, {
    status: 'ready',
    tokens: [],
    limited: false,
  });
  disconnect();
});

test('no explorer fallback for an edited endpoint or missing current catalogue', async () => {
  const ethereum = getNativeNetwork('ethereum');
  const edited = createNativeNetwork({
    ...ethereum,
    rpcUrl: 'https://custom-rpc.invalid',
  });
  const held = deferred<OwnedTokenSuggestions>();
  let requests = 0;
  let signal: AbortSignal | undefined;
  let catalogue: NativeWalletCatalogueSnapshot | null = {
    revision: 0,
    accounts: [],
    networks: [getNativeNetwork('ethereum')],
    active: { accountId: 'hd:60:0', networkId: 'ethereum' },
  };
  const f = fixture({
    getCatalogue: () => catalogue,
    readHoldings(_scope, _saved, owned) {
      requests++;
      signal = owned;
      return held.promise;
    },
  });
  const disconnect = f.model.connect();
  await tick();
  const lookup = f.model.discover();
  catalogue = { ...catalogue, networks: [edited] };
  assert.equal(f.model.getSnapshot().discovery, null);
  assert.equal(signal?.aborted, true);
  held.resolve({ tokens: [metadata], limited: false });
  await lookup;
  await f.model.refresh();
  await f.model.discover();
  catalogue = null;
  await f.model.refresh();
  await f.model.discover();
  assert.equal(requests, 1);
  assert.equal(f.model.getSnapshot().discovery, null);
  await f.model.preview(metadata.contractAddress);
  assert.equal(
    f.model.getSnapshot().preview?.metadata.contractAddress,
    metadata.contractAddress
  );
  disconnect();
});
test('connected token import persists only after confirmation, zero is available, removal works', async () => {
  const f = fixture();
  const disconnect = f.model.connect();
  await tick();
  assert.equal(f.model.getSnapshot().status, 'ready');
  assert.deepEqual(f.model.getSnapshot().items, []);
  await f.model.preview(metadata.contractAddress);
  assert.equal(f.mutations.length, 0);
  assert.equal(f.model.getSnapshot().preview?.units, '0');
  await f.model.confirmPreview();
  await tick();
  assert.deepEqual(f.mutations, [{ kind: 'add', address: A }]);
  assert.equal(f.model.getSnapshot().items[0]?.status, 'available');
  assert.equal(f.model.getSnapshot().items[0]?.units, '0');
  await f.model.remove(metadata.contractAddress);
  await tick();
  assert.deepEqual(f.model.getSnapshot().items, []);
  disconnect();
});
for (const mutation of ['confirm', 'remove'] as const)
  test(`silent account switch cannot apply old ${mutation} to the new account`, async () => {
    const f = fixture({ items: mutation === 'remove' ? [metadata] : [] });
    f.model.connect();
    await tick();
    if (mutation === 'confirm') await f.model.preview(metadata.contractAddress);
    f.change(B, false);
    if (mutation === 'confirm') await f.model.confirmPreview();
    else await f.model.remove(metadata.contractAddress);
    assert.equal(f.mutations.length, 0);
    assert.equal(f.model.getSnapshot().account?.address, B);
  });
test('lock and A-B-A discard late previews even when the reader ignores cancellation', async () => {
  const pending = deferred<{ metadata: typeof metadata; units: string }>();
  const f = fixture({
    reader: {
      readToken: () => pending.promise,
      async readBalance() {
        return { units: '0' };
      },
    },
  });
  f.model.connect();
  await tick();
  const preview = f.model.preview(metadata.contractAddress);
  f.change(B);
  f.change(A);
  await tick();
  pending.resolve({ metadata, units: '999' });
  await preview;
  assert.equal(f.model.getSnapshot().preview, null);
  f.change(null);
  assert.equal(f.model.getSnapshot().account, null);
  assert.deepEqual(f.model.getSnapshot().items, []);
});
test('read failure is unavailable, not zero, and unmount clears observations', async () => {
  const f = fixture({
    items: [metadata],
    reader: {
      async readToken() {
        throw Error('RAW_SECRET_ERROR');
      },
      async readBalance() {
        throw Error('RAW_SECRET_ERROR');
      },
    },
  });
  const disconnect = f.model.connect();
  await tick();
  const snapshot = f.model.getSnapshot();
  assert.equal(snapshot.items[0]?.status, 'error');
  assert.equal(snapshot.items[0]?.units, null);
  assert(!JSON.stringify(snapshot).includes('RAW_SECRET_ERROR'));
  disconnect();
  assert.equal(f.model.getSnapshot().status, 'unavailable');
  assert.equal(f.listenerCount(), 0);
});
test('observer context switch during preview admission cannot redirect the request', async () => {
  const calls: string[] = [];
  const f = fixture({
    reader: {
      async readToken(_network, address) {
        calls.push(address);
        return { metadata, units: '0' };
      },
      async readBalance() {
        return { units: '0' };
      },
    },
  });
  f.model.connect();
  await tick();
  let changed = false;
  f.model.subscribe(() => {
    if (!changed && f.model.getSnapshot().previewStatus === 'loading') {
      changed = true;
      f.change(B);
    }
  });
  await f.model.preview(metadata.contractAddress);
  assert.deepEqual(calls, []);
  assert.equal(f.model.getSnapshot().preview, null);
});
test('reentrant source subscription cannot steal replacement cleanup', async () => {
  const f = fixture();
  const old = f.source.subscribe;
  let recurse = true;
  let replacement!: () => void;
  f.source.subscribe = (listener) => {
    if (recurse) {
      recurse = false;
      replacement = f.model.connect();
    }
    return old(listener);
  };
  const stale = f.model.connect();
  await tick();
  stale();
  assert.equal(f.listenerCount(), 1);
  replacement();
  assert.equal(f.listenerCount(), 0);
  assert.equal(f.model.getSnapshot().status, 'unavailable');
});
test('new refresh cannot resurrect a removed row from an old balance read', async () => {
  const pending = deferred<{ units: string }>();
  let calls = 0;
  const f = fixture({
    items: [metadata],
    reader: {
      async readToken() {
        return { metadata, units: '0' };
      },
      readBalance() {
        return ++calls === 1
          ? pending.promise
          : Promise.resolve({ units: '0' });
      },
    },
  });
  f.model.connect();
  await tick();
  await f.model.remove(metadata.contractAddress);
  await tick();
  pending.resolve({ units: '123' });
  await tick();
  assert.deepEqual(f.model.getSnapshot().items, []);
});

for (const refresh of ['list', 'selected'] as const)
  test(`opening and leaving import preserves a pending ${refresh} balance refresh`, async () => {
    const other = { ...metadata, contractAddress: B };
    const pending = deferred<{ units: string }>();
    let hold = false;
    const f = fixture({
      items: [metadata, other],
      reader: {
        async readToken() {
          throw Error('Opening import must not read token metadata');
        },
        readBalance() {
          return hold ? pending.promise : Promise.resolve({ units: '0' });
        },
      },
    });
    const disconnect = f.model.connect();
    await tick();
    hold = true;
    const refreshing = f.model.refresh(
      refresh === 'selected' ? metadata.contractAddress : undefined
    );
    await tick();
    assert.equal(f.model.getSnapshot().items[0]?.status, 'loading');

    // The screen clears preview state both when opening Import and on Back.
    f.model.cancelPreview();
    f.model.cancelPreview();
    pending.resolve({ units: '42' });
    await refreshing;

    const snapshot = f.model.getSnapshot();
    assert.equal(snapshot.items[0]?.status, 'available');
    assert.equal(snapshot.items[0]?.units, '42');
    assert.equal(snapshot.items[1]?.status, 'available');
    assert.equal(snapshot.items[1]?.units, refresh === 'list' ? '42' : '0');
    assert.equal(snapshot.preview, null);
    assert.equal(snapshot.previewStatus, 'idle');
    assert.equal(f.mutations.length, 0);
    disconnect();
  });

test('connection replay drains an old registry read before starting the new scope', async () => {
  const f = fixture();
  const hold = deferred<void>();
  let calls = 0;
  let active = 0;
  let maximum = 0;
  const runtime: NativeTokenRuntime = {
    async load(guard) {
      active++;
      maximum = Math.max(maximum, active);
      const call = ++calls;
      try {
        if (call === 1) await hold.promise;
        guard();
        return { revision: 0, items: [] };
      } finally {
        active--;
      }
    },
    async add() {
      throw Error('unused');
    },
    async remove() {
      throw Error('unused');
    },
  };
  const model = new NativeTokens(f.source, () => runtime);
  const first = model.connect();
  await tick();
  f.change(B);
  const second = model.connect();
  first();
  await tick();
  assert.equal(calls, 1);
  hold.resolve();
  await tick();
  assert.equal(maximum, 1);
  assert.equal(model.getSnapshot().status, 'ready');
  assert.equal(model.getSnapshot().account?.address, B);
  second();
});

test('list deadline preserves unattempted rows as unknown and selected refresh preserves other observations', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const items = Array.from({ length: 12 }, (_, i) => ({
    ...metadata,
    contractAddress: '0x' + (i + 1).toString(16).padStart(40, '0'),
  }));
  const f = fixture({
    items,
    reader: {
      async readToken() {
        return { metadata, units: '0' };
      },
      async readBalance() {
        if (++calls <= 2) return new Promise(() => undefined);
        return { units: '42' };
      },
    },
  });
  const disconnect = f.model.connect();
  await tick();
  assert.equal(calls, 2);
  t.mock.timers.tick(15_000);
  await tick();
  const prior = f.model.getSnapshot();
  assert.equal(prior.items.filter((item) => item.status === 'error').length, 2);
  assert.equal(
    prior.items.filter((item) => item.status === 'unknown').length,
    10
  );
  await f.model.refresh(items[11]!.contractAddress);
  assert.equal(calls, 3);
  assert.equal(f.model.getSnapshot().items[11]!.units, '42');
  assert.deepEqual(
    f.model.getSnapshot().items.slice(0, 11),
    prior.items.slice(0, 11)
  );
  disconnect();
});
