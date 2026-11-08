import { emptyNoncePlanner } from './noncePlannerFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { EvmTransferReadRpc, type NativeAutomaticNoncePlanner } from '../src/custody/evmTransferReadRpc.ts';
import { EvmAutoNonceAcceptance } from '../../../source/shared/evmAutoNonce.ts';

type RpcRequest = { id: number; method: string; params: unknown[] };
const sender = '0x52908400098527886E0F7030069857D2E4169EE7';
const contract = '0x2222222222222222222222222222222222222222';
const intent = {
  kind: 'erc20-transfer' as const,
  chainId: '1',
  token: { contractAddress: contract, name: 'Fixture', symbol: 'FIX', decimals: 2 },
  recipient: '0x1111111111111111111111111111111111111111',
  amountUnits: '123',
};
const word = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(options: { holdBalance?: boolean } = {}) {
  const requests: RpcRequest[] = [];
  const balanceStarted = deferred();
  const releaseBalance = deferred();
  const firstPlanCompleted = deferred();
  const canonicalStarted = deferred();
  const releaseCanonical = deferred();
  let heads = 0;
  let latestNonce = 0;
  let latestReads = 0;
  let switchAtLatest: number | undefined;
  let chainId = '0x1';
  let hasPending = false;
  let changedBlockHash = false;
  let holdCanonical = false;
  let emptyBlock = false;
  const acceptance = new EvmAutoNonceAcceptance(() => 0);
  const snapshot = {
    owner: 'owned-test', minimumNonce: 0,
    retained: [],
    readAssetDebit: async () => 0n, readMaximumCost: async () => 0n,
  };
  const automatic: NativeAutomaticNoncePlanner = async (input) => {
    const result = await acceptance.plan({
      ...input,
      chainId: '1',
      from: sender,
      endpoint: 'fixture',
      snapshot,
    });
    firstPlanCompleted.resolve();
    return result;
  };
  const fetcher = async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RpcRequest;
      requests.push(request);
      let result: unknown;
      switch (request.method) {
        case 'eth_chainId':
          result = chainId;
          break;
        case 'eth_getBlockByNumber': {
          let block = request.params[0];
          if (block === 'latest') block = !emptyBlock && (++heads === 1 || !latestNonce) ? '0x123' : '0x124';
          else if (holdCanonical && block === '0x123') {
            holdCanonical = false;
            canonicalStarted.resolve();
            await releaseCanonical.promise;
          }
          result = {
            number: block,
            hash: `0x${(block === '0x123' ? changedBlockHash ? 'c' : 'a' : 'b').repeat(64)}`,
            gasLimit: '0x1c9c380',
            baseFeePerGas: '0x1',
          };
          break;
        }
        case 'eth_getCode': result = '0x6000'; break;
        case 'eth_getTransactionCount':
          if (request.params[1] === 'latest' && ++latestReads === switchAtLatest) chainId = '0x2';
          result = request.params[1] === 'latest' ? `0x${latestNonce}` : request.params[1] === 'pending' ? `0x${latestNonce + (hasPending ? 1 : 0)}` : '0x0';
          break;
        case 'eth_getBalance': result = '0xde0b6b3a7640000'; break;
        case 'eth_gasPrice': result = '0x1'; break;
        case 'eth_feeHistory': result = { oldestBlock: '0x123', baseFeePerGas: ['0x1', '0x1'] }; break;
        case 'eth_maxPriorityFeePerGas': result = '0x1'; break;
        // A false-returning ERC20 executes without reverting at the new block.
        case 'eth_estimateGas': result = '0xc350'; break;
        case 'eth_call': {
          const call = request.params[0] as { data: string };
          const block = request.params[1];
          if (options.holdBalance && call.data.startsWith('0x70a08231')) {
            balanceStarted.resolve();
            await releaseBalance.promise;
          }
          result = call.data === '0x313ce567' ? word(2)
            : call.data.startsWith('0x70a08231') ? word(emptyBlock || block === '0x123' ? 123 : 0)
            : word(emptyBlock || block === '0x123' || block === 'pending' ? 1 : 0);
          break;
        }
        default: throw new Error(`Unexpected fixture RPC method: ${request.method}`);
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
        headers: { 'content-type': 'application/json' },
      });
    };
  const rpc = new NativeTransferRpc({ networkId: 'ethereum', fetch: fetcher });
  const reader = new EvmTransferReadRpc('ethereum', { fetch: fetcher });
  return {
    rpc, reader, automatic, requests,
    balanceStarted: balanceStarted.promise,
    firstPlanCompleted: firstPlanCompleted.promise,
    releaseBalance: releaseBalance.resolve,
    canonicalStarted: canonicalStarted.promise,
    releaseCanonical: releaseCanonical.resolve,
    advance: () => { latestNonce = 1; },
    addPending: () => { hasPending = true; },
    advanceEmptyBlock: () => { emptyBlock = true; },
    orphanBlock: () => { changedBlockHash = true; },
    holdNextCanonicalRead: () => { holdCanonical = true; },
    switchChainOnFinalLatest: () => { switchAtLatest = latestReads + 2; },
  };
}

function tokenQuote(f: ReturnType<typeof fixture>) {
  return f.rpc.prepareToken(sender, intent, new AbortController().signal, undefined, undefined, f.automatic);
}

test('unrelated pending predecessor preserves automatic token queueing', async () => {
  const f = fixture(); f.addPending();
  const quote = await tokenQuote(f);
  assert.equal(quote.transaction.nonce, '1');
  await f.rpc.verifyForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, quote.intent);
  assert(f.requests.some((r) => r.method === 'eth_call' && r.params[1] === 'pending'));
});

test('token quote rejects block advancement between asset and nonce reads', async () => {
  const f = fixture();
  f.advance();
  await assert.rejects(tokenQuote(f), { code: 'REVIEW_REQUIRED', reason: 'asset-state' });
  assert.ok(f.requests.some((request) => request.method === 'eth_getTransactionCount' && request.params[1] === '0x123'));
});

test('a block mined after the initial nonce check but before asset reads finish rejects the quote', async () => {
  const f = fixture({ holdBalance: true });
  const quote = tokenQuote(f);
  await f.balanceStarted;
  f.advance();
  f.releaseBalance();
  await assert.rejects(quote, { code: 'REVIEW_REQUIRED', reason: 'asset-state' });
});

test('an owned quote stays usable until the sender nonce advances before dispatch', async () => {
  const f = fixture();
  const quote = await tokenQuote(f);
  assert.equal(quote.transaction.nonce, '0');
  assert.equal(f.requests.filter((request) => request.method === 'eth_getTransactionCount' && request.params[1] === '0x123').length, 1);
  const start = f.requests.length;
  await f.rpc.verifyForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, quote.intent);
  const preflight = f.requests.slice(start);
  assert.equal(preflight.filter((request) => request.method === 'eth_getTransactionCount' && request.params[1] === '0x123').length, 1);
  assert.equal(preflight.filter((request) => request.method === 'eth_getTransactionCount' && request.params[1] === 'latest').length, 2);
  assert.equal(preflight.filter((request) => request.method === 'eth_chainId').length, 2);
  const fresh = await f.rpc.requote(quote.transaction, new AbortController().signal, quote.intent, undefined, f.automatic);
  await f.rpc.verifyForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, fresh.intent);
  f.advance();
  await assert.rejects(f.rpc.verifyForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, quote.intent));
});

test('asset-state pending at held dispatch retains its actionable reason', async () => {
  const f = fixture();
  const quote = await tokenQuote(f);
  f.addPending();
  await assert.rejects(
    f.rpc.verifyForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, quote.intent),
    { code: 'REVIEW_REQUIRED' }
  );
});

test('a block mined during the held dispatch canonical check rejects preflight', async () => {
  const f = fixture();
  const quote = await tokenQuote(f);
  f.holdNextCanonicalRead();
  const preflight = f.rpc.verifyForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, quote.intent);
  const first = await Promise.race([
    f.canonicalStarted.then(() => 'canonical-started'),
    preflight.then(() => 'preflight-completed', () => 'preflight-rejected'),
  ]);
  assert.equal(first, 'canonical-started');
  f.advance();
  f.releaseCanonical();
  await assert.rejects(preflight, { code: 'REVIEW_REQUIRED' });
});

test('dispatch requires matching immutable asset intent', async () => {
  const f = fixture();
  const quote = await tokenQuote(f);
  await assert.rejects(f.rpc.verifyForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic));
  await assert.rejects(f.rpc.verifyForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined,
    { ...intent, amountUnits: '124' }));
  await assert.rejects(f.rpc.verifyForDispatch({ ...quote.transaction, value: '1' }, new AbortController().signal, () => {}, f.automatic, undefined, quote.intent));
});

test('native-currency quote binds its nonce to the canonical balance block', async () => {
  const f = fixture();
  const quote = await f.rpc.prepare(sender, intent.recipient, '1000', new AbortController().signal, undefined, f.automatic);
  assert.equal(quote.transaction.nonce, '0');
  assert.equal(f.requests.filter((request) => request.method === 'eth_getTransactionCount' && request.params[1] === '0x123').length, 1);
});

for (const phase of ['quote', 'dispatch'] as const) {
  test(`token ${phase} rejects a chain switch during the final nonce read`, async () => {
    const f = fixture();
    const quote = phase === 'dispatch' ? await tokenQuote(f) : undefined;
    f.switchChainOnFinalLatest();
    const operation = quote
      ? f.rpc.verifyForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, quote.intent)
      : tokenQuote(f);
    await assert.rejects(operation, { code: 'INVALID_RESPONSE' });
    assert.equal(f.requests.some((request) => request.method === 'eth_sendRawTransaction'), false);
  });
}

test('simulation at dispatch includes the exact approved gas and nonce', async () => {
  const f = fixture(); const quote = await tokenQuote(f);
  await f.rpc.verifyForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, quote.intent);
  const call = f.requests.filter((r) => r.method === 'eth_call' && (r.params[0] as { data: string }).data.startsWith('0xa9059cbb')).at(-1)!;
  const simulated = call.params[0] as Record<string, string>;
  assert.equal(BigInt(simulated.gas!), BigInt(quote.transaction.gasLimit));
  assert.equal(BigInt(simulated.nonce!), BigInt(quote.transaction.nonce));
});

for (const manual of [false, true]) {
  test(`token ${manual ? 'manual' : 'non-automatic'} quote uses one coherent asset snapshot`, async () => {
    const f = fixture();
    await f.rpc.prepareToken(sender, intent, new AbortController().signal, undefined, manual ? 0 : undefined, emptyNoncePlanner);
    assert.equal(f.requests.filter((request) => request.method === 'eth_chainId').length, 2);
    assert.equal(f.requests.filter((request) => request.method === 'eth_getTransactionCount' && request.params[1] === '0x123').length, 1);
  });
}

test('a healthy new block before held dispatch preserves the reviewed transfer', async () => {
  const f = fixture(); const quote = await tokenQuote(f);
  f.advanceEmptyBlock(); const start = f.requests.length;
  await f.rpc.verifyForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, quote.intent);
  const requests = f.requests.slice(start);
  assert.equal(requests.filter((r) => r.method === 'eth_getBlockByNumber' && r.params[0] === 'latest').length, 1);
  assert.equal(requests.filter((r) => r.method === 'eth_call' && (r.params[0] as { data: string }).data === '0x313ce567').length, 0);
  assert(requests.some((r) => r.method === 'eth_call' && r.params[1] === '0x124'));
});
