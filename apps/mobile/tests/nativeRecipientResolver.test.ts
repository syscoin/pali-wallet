import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface } from 'ethers/abi';
import { ENS_RECIPIENT_TTL_MS, selectEnsResolutionNetwork } from '../../../source/shared/ensRecipient.ts';
import { createNativeRecipientResolver } from '../src/portfolio/nativeRecipientResolver.ts';
import { createNativeNetwork, getNativeNetwork, getNativeSendContext } from '../src/custody/networkContext.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';
import type { NativeWalletCatalogueSnapshot } from '../src/custody/walletCatalogue.ts';

const address = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const resolverAddress = '0x3333333333333333333333333333333333333333';
const universal = new Interface(['function requireResolver(bytes) view returns ((bytes name, uint256 offset, bytes32 node, address resolver, bool extended))']);
const resolverAbi = new Interface([
  'function addr(bytes32) view returns (address)',
  'function finish(bytes,bytes) view returns (bytes)',
  'error OffchainLookup(address sender,string[] urls,bytes callData,bytes4 callbackFunction,bytes extraData)',
]);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(options: { ccip?: boolean; timeoutMs?: number; lookupChainId?: string } = {}) {
  // Deliberately use a non-default registration ID and endpoint for ENS, while
  // the transfer destination is a different EVM chain.
  const mainnet = createNativeNetwork({ ...getNativeNetwork('ethereum'), id: 'configured-mainnet', rpcUrl: 'https://configured.example/rpc' });
  const destination = getNativeNetwork('base');
  let state: CustodySnapshot = { phase: 'ready', revision: 3, presence: 'existing', backup: 'confirmed',
    account: { address, network: destination.id }, error: null };
  let catalogue: NativeWalletCatalogueSnapshot = { revision: 5, active: { accountId: 'hd:60:0', networkId: destination.id },
    accounts: [], networks: [destination, mainnet], utxoNetworks: [] };
  const listeners = new Set<(snapshot: CustodySnapshot) => void>();
  const calls: { url: string; init: RequestInit }[] = [];
  let now = 1000, active = true, hold: ((url: string, init: RequestInit) => Promise<Response>) | undefined, holdGatewayOnly = false;
  let gateway = 'https://gateway.example/{data}';
  let sourceChainId = '0x1';
  let identityReads = 0;
  let finalIdentity: ((url: string, id: number) => Promise<Response>) | undefined;
  const response = (url: string, value: unknown, status = 200) => {
    const result = new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    Object.defineProperty(result, 'url', { value: url });
    return result;
  };
  const source = { getSnapshot: () => state, getCatalogue: () => catalogue,
    subscribe(listener: (snapshot: CustodySnapshot) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    assert(init.signal instanceof AbortSignal);
    if (hold && (!holdGatewayOnly || url.startsWith('https://gateway.example/'))) return hold(url, init);
    if (url.startsWith('https://gateway.example/')) return response(url, { data: '0xbeef' });
    assert.equal(url, mainnet.rpcUrl);
    const wire = JSON.parse(new TextDecoder().decode(init.body as Uint8Array));
    let result: unknown;
    if (wire.method === 'eth_chainId') {
      if (++identityReads > 1 && finalIdentity) return finalIdentity(url, wire.id);
      result = sourceChainId;
    }
    else {
      assert.equal(wire.method, 'eth_call');
      const transaction = wire.params[0];
      if (transaction.data.startsWith(universal.getFunction('requireResolver')!.selector)) {
        result = universal.encodeFunctionResult('requireResolver', [['0x', 0, '0x' + '00'.repeat(32), resolverAddress, false]]);
      } else if (transaction.data.startsWith(resolverAbi.getFunction('finish')!.selector)) {
        result = resolverAbi.encodeFunctionResult('addr', [recipient]);
      } else {
        assert.equal(transaction.to.toLowerCase(), resolverAddress);
        assert(transaction.data.startsWith(resolverAbi.getFunction('addr')!.selector));
        // The configured endpoint honestly reports its new chain after the
        // registry lookup, before answering the final address lookup.
        if (options.lookupChainId) sourceChainId = options.lookupChainId;
        if (options.ccip) return response(url, { jsonrpc: '2.0', id: wire.id, error: { code: 3, message: 'execution reverted',
          data: resolverAbi.encodeErrorResult('OffchainLookup', [resolverAddress, [gateway], '0xabcd', resolverAbi.getFunction('finish')!.selector, '0x']) } });
        result = resolverAbi.encodeFunctionResult('addr', [recipient]);
      }
    }
    return response(url, { jsonrpc: '2.0', id: wire.id, result });
  }) as typeof fetch;
  const resolver = createNativeRecipientResolver({ source, fetch: fetcher, now: () => now, timeoutMs: options.timeoutMs });
  const owner = { account: { address, network: destination.id, revision: 3 }, context: getNativeSendContext(destination) };
  const abort = new AbortController();
  const resolve = () => resolver.resolve('recipient.eth', owner, abort.signal, () => { if (!active) throw new Error('RECIPIENT_EXPIRED'); });
  return { resolve, calls, abort, source, response, mainnet, owner,
    advance: () => { now += ENS_RECIPIENT_TTL_MS; },
    setGateway: (value: string) => { gateway = value; },
    hold: (value: typeof hold) => { hold = value; },
    holdGateway: (value: typeof hold) => { hold = value; holdGatewayOnly = true; },
    holdFinalIdentity: (value: NonNullable<typeof finalIdentity>) => { finalIdentity = value; },
    change(kind: 'account' | 'network' | 'lock' | 'registration' | 'request') {
      if (kind === 'account') state = { ...state, revision: 4, account: { address: recipient, network: destination.id } };
      if (kind === 'network') state = { ...state, revision: 4, account: { address, network: mainnet.id } };
      if (kind === 'lock') state = { ...state, phase: 'locked', revision: 4 };
      if (kind === 'registration') catalogue = { ...catalogue, networks: [destination, createNativeNetwork({ ...mainnet, rpcUrl: 'https://changed.example' })] };
      if (kind === 'request') active = false;
      for (const listener of listeners) listener(state);
    },
    removeMainnet() { catalogue = { ...catalogue, networks: [destination] }; },
    listenerCount: () => listeners.size,
  };
}

test('shared ENS source selection uses configured mainnet, independently of active transfer chain', async () => {
  assert.equal(selectEnsResolutionNetwork([{ chain: 57 }, { chain: '1' }], (value) => value.chain)?.chain, '1');
  const f = fixture(); const ticket = await f.resolve();
  try {
    assert.equal(ticket.address, recipient); assert.equal(ticket.input, 'recipient.eth');
    assert.equal(ticket.expiresAt, 1000 + ENS_RECIPIENT_TTL_MS); ticket.assertCurrent();
    assert(f.calls.length >= 3); assert(f.calls.every((call) => call.url === f.mainnet.rpcUrl));
    const methods = f.calls.map(call => JSON.parse(new TextDecoder().decode(call.init.body as Uint8Array)).method);
    assert.equal(methods[0], 'eth_chainId'); assert.equal(methods.at(-1), 'eth_chainId');
    assert.equal(methods.filter(method => method === 'eth_chainId').length, 2);
    const reads = f.calls.length; ticket.assertCurrent(); assert.equal(f.calls.length, reads, 'synchronous lifetime checks cannot query RPC');
    f.advance(); assert.throws(ticket.assertCurrent, /RECIPIENT_EXPIRED/);
  } finally { ticket.dispose(); }
  assert.equal(f.listenerCount(), 0);
});

test('an ENS source that changes chain during lookup cannot publish a recipient ticket', async () => {
  const f = fixture({ lookupChainId: '0x2' });
  let ticket: Awaited<ReturnType<typeof f.resolve>> | undefined;
  try {
    await assert.rejects(f.resolve().then(result => { ticket = result; return result; }), /ENS_UNAVAILABLE/);
    assert.equal(f.listenerCount(), 0);
  } finally { ticket?.dispose(); }
});

for (const kind of ['account', 'request'] as const) test(`${kind} retirement during the final source identity query cannot publish a late ticket`, async () => {
  const f = fixture();
  let started!: () => void, complete!: (response: Response) => void, responseId = 0;
  const ready = new Promise<void>(resolve => { started = resolve; });
  f.holdFinalIdentity((_url, id) => new Promise(resolve => { responseId = id; complete = resolve; started(); }));
  const pending = f.resolve();
  await ready;
  f.change(kind);
  await assert.rejects(pending, /RECIPIENT_EXPIRED/);
  assert.equal(f.calls.at(-1)!.init.signal!.aborted, true);
  complete(f.response(f.mainnet.rpcUrl, { jsonrpc: '2.0', id: responseId, result: '0x1' }));
  await tick();
  assert.equal(f.listenerCount(), 0);
});

test('real ethers OffchainLookup uses the request-local bounded transport before first gateway send', async () => {
  const f = fixture({ ccip: true }); const ticket = await f.resolve();
  try {
    assert.equal(ticket.address, recipient);
    const gateway = f.calls.find((call) => call.url === 'https://gateway.example/0xabcd');
    assert(gateway); assert.equal(gateway.init.method, 'GET');
    assert.equal(gateway.init.signal, f.calls[0]!.init.signal);
    assert(f.calls.some((call) => call.url === f.mainnet.rpcUrl));
  } finally { ticket.dispose(); }
});

test('ethers retains POST-style CCIP requests and their callback verification', async () => {
  const f = fixture({ ccip: true }); f.setGateway('https://gateway.example/resolve');
  const ticket = await f.resolve();
  try {
    assert.equal(ticket.address, recipient);
    const gateway = f.calls.find((call) => call.url === 'https://gateway.example/resolve')!;
    assert.equal(gateway.init.method, 'POST');
    assert.deepEqual(JSON.parse(new TextDecoder().decode(gateway.init.body as Uint8Array)), { data: '0xabcd', sender: resolverAddress });
  } finally { ticket.dispose(); }
});

test('a CCIP gateway redirect is refused without a second destination fetch', async () => {
  const f = fixture({ ccip: true });
  f.holdGateway(async (url) => {
    const response = f.response(url, {}, 302);
    response.headers.set('location', 'https://redirect.example');
    return response;
  });
  await assert.rejects(f.resolve(), /ENS_UNAVAILABLE/);
  assert.equal(f.calls.filter((call) => call.url.startsWith('https://gateway.example/')).length, 1);
  assert(f.calls.every((call) => !call.url.startsWith('https://redirect.example')));
});

for (const kind of ['account', 'network', 'lock', 'registration', 'request'] as const)
  test(`${kind} changes invalidate the held address without adopting later results`, async () => {
    const f = fixture(); const ticket = await f.resolve();
    f.change(kind);
    assert.throws(ticket.assertCurrent); assert.equal(ticket.signal.aborted, true); ticket.dispose();
  });

test('missing configured mainnet refuses instead of falling back to any built-in endpoint', async () => {
  const f = fixture(); f.removeMainnet(); await assert.rejects(f.resolve(), /ENS_UNAVAILABLE/); assert.equal(f.calls.length, 0);
});

test('request cancellation aborts actual transport and rejects a late response', async () => {
  const f = fixture(); let complete!: (value: Response) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  f.hold(() => new Promise((resolve) => { complete = resolve; started(); }));
  const pending = f.resolve(); await ready; f.abort.abort();
  await assert.rejects(pending, /RECIPIENT_EXPIRED/);
  assert.equal(f.calls[0]!.init.signal!.aborted, true);
  let cancelled = 0;
  const late = new Response(new ReadableStream({ cancel() { cancelled++; } }));
  Object.defineProperty(late, 'url', { value: f.mainnet.rpcUrl });
  complete(late); await tick(); assert.equal(cancelled, 1);
  assert.equal(f.calls.length, 1); assert.equal(f.listenerCount(), 0);
});

test('actual CCIP gateway transport aborts on owner change and cannot publish a late result', async () => {
  const f = fixture({ ccip: true }); let complete!: (value: Response) => void, started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  f.holdGateway(() => new Promise((resolve) => { complete = resolve; started(); }));
  const pending = f.resolve(); await ready; f.change('account');
  await assert.rejects(pending, /RECIPIENT_EXPIRED/);
  const call = f.calls.find((value) => value.url.startsWith('https://gateway.example/'))!;
  assert.equal(call.init.signal!.aborted, true);
  complete(f.response(call.url, { data: '0xbeef' })); await tick();
  assert.equal(f.listenerCount(), 0);
});

test('lookup deadline aborts actual transport', async () => {
  const f = fixture({ timeoutMs: 5 }); f.hold(() => new Promise(() => undefined));
  await assert.rejects(f.resolve(), /RECIPIENT_EXPIRED/);
  assert.equal(f.calls[0]!.init.signal!.aborted, true);
});

for (const gateway of ['http://untrusted.example/{data}', 'data:application/json,{}', 'https://user:secret@gateway.example/{data}'])
  test(`CCIP URL policy refuses ${gateway.split(':')[0]} before any gateway fetch`, async () => {
    const f = fixture({ ccip: true }); f.setGateway(gateway);
    await assert.rejects(f.resolve(), /ENS_UNAVAILABLE/);
    assert(f.calls.every((call) => call.url === f.mainnet.rpcUrl));
  });

test('redirected and oversized actual responses cannot resolve a recipient', async () => {
  for (const mode of ['redirect', 'size']) {
    const f = fixture();
    f.hold(async (url) => {
      const response = mode === 'size' ? f.response(url, { value: 'x'.repeat(256 * 1024) }) : f.response('https://other.example', {});
      return response;
    });
    await assert.rejects(f.resolve()); assert.equal(f.calls.length, 1);
  }
});
