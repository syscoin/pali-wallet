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
  const acceptance = new EvmAutoNonceAcceptance(() => 0);
  const snapshot = {
    owner: 'owned-test',
    retained: [],
    readMaximumCost: async () => 0n,
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
          if (block === 'latest') block = ++heads === 1 || !latestNonce ? '0x123' : '0x124';
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
            : call.data.startsWith('0x70a08231') ? word(block === '0x123' ? 123 : 0)
            : word(block === '0x123' ? 1 : 0);
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
    orphanBlock: () => { changedBlockHash = true; },
    holdNextCanonicalRead: () => { holdCanonical = true; },
    switchChainOnFinalLatest: () => { switchAtLatest = latestReads + 2; },
  };
}

function tokenQuote(f: ReturnType<typeof fixture>) {
  return f.rpc.prepareToken(sender, intent, new AbortController().signal, undefined, undefined, f.automatic);
}

test('pending predecessor remains fenced even without a journal record', async () => {
  const f = fixture();
  f.addPending();
  await assert.rejects(tokenQuote(f), { code: 'REVIEW_REQUIRED', reason: 'asset-state' });
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
  await Promise.all([f.balanceStarted, f.firstPlanCompleted]);
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
  await f.rpc.verifyAutomaticForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, quote);
  const preflight = f.requests.slice(start);
  assert.equal(preflight.filter((request) => request.method === 'eth_getTransactionCount' && request.params[1] === '0x123').length, 0);
  assert.equal(preflight.filter((request) => request.method === 'eth_getTransactionCount' && request.params[1] === 'latest').length, 2);
  assert.equal(preflight.filter((request) => request.method === 'eth_chainId').length, 2);
  const fresh = await f.rpc.requote(quote.transaction, new AbortController().signal, quote.intent, undefined, f.automatic);
  await f.rpc.verifyAutomaticForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, fresh);
  f.advance();
  await assert.rejects(f.rpc.verifyAutomaticForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, quote));
});

test('a block mined during the held dispatch canonical check rejects preflight', async () => {
  const f = fixture();
  const quote = await tokenQuote(f);
  f.holdNextCanonicalRead();
  const preflight = f.rpc.verifyAutomaticForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, quote);
  const first = await Promise.race([
    f.canonicalStarted.then(() => 'canonical-started'),
    preflight.then(() => 'preflight-completed', () => 'preflight-rejected'),
  ]);
  assert.equal(first, 'canonical-started');
  f.advance();
  f.releaseCanonical();
  await assert.rejects(preflight, { code: 'REVIEW_REQUIRED' });
});

test('dispatch rejects missing, copied, foreign, altered and orphaned asset proofs', async () => {
  const f = fixture();
  const quote = await tokenQuote(f);
  const verify = (transaction: typeof quote.transaction, proof = quote) =>
    f.rpc.verifyAutomaticForDispatch(transaction, new AbortController().signal, () => {}, f.automatic, undefined, proof);
  await assert.rejects(f.rpc.verifyAutomaticForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic));
  await assert.rejects(verify(quote.transaction, { ...quote }));
  await assert.rejects(verify({ ...quote.transaction, value: '1' }));
  await assert.rejects(verify({ ...quote.transaction, gasLimit: (BigInt(quote.transaction.gasLimit) + 1n).toString() }));
  assert.equal(quote.transaction.type, 2);
  if (quote.transaction.type !== 2) assert.fail('expected EIP-1559 fixture');
  await assert.rejects(verify({ ...quote.transaction, maxFeePerGas: (BigInt(quote.transaction.maxFeePerGas) + 1n).toString() }));
  const { from, to, chainId, nonce, value, gasLimit, data } = quote.transaction;
  await assert.rejects(verify({ from, to, chainId, nonce, value, gasLimit, data, type: 0, gasPrice: '1' }));
  const foreign = fixture();
  await assert.rejects(foreign.rpc.verifyAutomaticForDispatch(quote.transaction, new AbortController().signal, () => {}, foreign.automatic, undefined, quote));
  f.orphanBlock();
  await assert.rejects(verify(quote.transaction));
});

test('native-currency quote does not add asset-block nonce reads', async () => {
  const f = fixture();
  const quote = await f.rpc.prepare(sender, intent.recipient, '1000', new AbortController().signal, undefined, f.automatic);
  assert.equal(quote.transaction.nonce, '0');
  assert.equal(f.requests.filter((request) => request.method === 'eth_getTransactionCount' && request.params[1] === '0x123').length, 0);
});

for (const phase of ['quote', 'dispatch'] as const) {
  test(`token ${phase} rejects a chain switch during the final nonce read`, async () => {
    const f = fixture();
    const quote = phase === 'dispatch' ? await tokenQuote(f) : undefined;
    f.switchChainOnFinalLatest();
    const operation = quote
      ? f.rpc.verifyAutomaticForDispatch(quote.transaction, new AbortController().signal, () => {}, f.automatic, undefined, quote)
      : tokenQuote(f);
    await assert.rejects(operation, { code: 'INVALID_RESPONSE' });
    assert.equal(f.requests.some((request) => request.method === 'eth_sendRawTransaction'), false);
  });
}

test('receipt preflight rejects malformed and mismatched sampled-block nonce bases', async () => {
  const f = fixture();
  const quote = await tokenQuote(f);
  const guard = () => {};
  const signal = new AbortController().signal;
  const basis = { number: '0x123', hash: `0x${'a'.repeat(64)}`, nonce: 0 };
  await assert.rejects(async () => f.reader.verifyAutomaticForDispatch(quote.transaction, signal, guard, f.automatic, { ...basis, nonce: -1 }));
  await assert.rejects(async () => f.reader.verifyAutomaticForDispatch(quote.transaction, signal, guard, f.automatic, { ...basis, nonce: 1 }));
  await assert.rejects(async () => f.reader.verifyAutomaticForDispatch(quote.transaction, signal, guard, f.automatic, { ...basis, hash: `0x${'b'.repeat(64)}` }));
});

for (const manual of [false, true]) {
  test(`token ${manual ? 'manual' : 'non-automatic'} quote retains its chain checks and avoids historical nonce reads`, async () => {
    const f = fixture();
    await f.rpc.prepareToken(sender, intent, new AbortController().signal, undefined, manual ? 0 : undefined);
    assert.equal(f.requests.filter((request) => request.method === 'eth_chainId').length, 4);
    assert.equal(f.requests.filter((request) => request.method === 'eth_getTransactionCount' && request.params[1] === '0x123').length, 0);
  });
}
