import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEther, toQuantity } from 'ethers/utils';
import {
  advanceMerkleWork,
  createMerkleWork,
} from '../../../source/utils/privacy/merkle.ts';
import {
  PRIVACY_POOL_ABI,
  PRIVACY_SERVICE_URL,
} from '../../../source/utils/privacy/publicSyncProtocol.ts';
import { getPrivacyPool } from '../../../source/utils/privacy/registry.ts';
import type { PrivacySnapshot } from '../../../source/utils/privacy/types.ts';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import { createNativePrivacyPoolSync } from '../src/privacy/nativePrivacyPoolSync.ts';
import type { WalletHttpFetch } from '../src/platform/httpPolicy.ts';

const poolId = 'eth-0.1';
const pool = getPrivacyPool(poolId);
const indexUrl = `${PRIVACY_SERVICE_URL}/pools/${poolId}/snapshot`;
const rpcUrl = 'https://registered-ethereum.example/rpc';
const network = createNativeNetwork({
  id: 'saved-ethereum',
  name: 'Saved Ethereum',
  kind: 'evm',
  chainId: '1',
  slip44: 60,
  rpcUrl,
  symbol: 'ETH',
  decimals: 18,
  testnet: false,
});
const word = (number: number) => `0x${number.toString(16).padStart(64, '0')}`;
const block = {
  number: '0x1301dd0',
  hash: word(100),
  timestamp: toQuantity(Math.floor(Date.now() / 1000)),
};
const note = { poolId, commitment: word(1), nullifierHash: word(200) } as const;

function snapshot(count = 24): PrivacySnapshot {
  const leaves = Array.from({ length: count }, (_, i) => word(i + 1));
  const work = createMerkleWork();
  while (!work.complete) advanceMerkleWork(work, leaves);
  return {
    version: 1,
    chainId: 1,
    poolAddress: pool.address,
    asOfBlockNumber: Number(block.number),
    asOfBlockHash: block.hash,
    root: work.root!,
    leafCount: leaves.length,
    leaves,
    withdrawnNullifiers: [note.nullifierHash],
  };
}
function response(
  url: string,
  body: BodyInit | null,
  status = 200,
  headers?: HeadersInit
): Response {
  const value = new Response(body, { status, headers });
  Object.defineProperty(value, 'url', { value: url });
  return value;
}
function json(url: string, value: unknown, status = 200) {
  return response(url, JSON.stringify(value), status);
}
function fixture(
  data = snapshot(),
  options: {
    alterBlock?: (count: number) => object;
    index?: (count: number) => Response;
  } = {}
) {
  let indexes = 0,
    blocks = 0;
  const requests: { url: string; method: string; args: unknown[] }[] = [];
  const transport: WalletHttpFetch = async (url, init) => {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('Cache-Control'), 'no-store, no-cache');
    assert.equal(headers.get('Cookie'), null);
    assert.equal(headers.get('Referer'), null);
    assert.equal(init.signal?.aborted, false);
    if (url === indexUrl) {
      assert.equal(init.body, undefined);
      requests.push({ url, method: 'GET', args: [] });
      return options.index?.(++indexes) ?? json(url, data);
    }
    assert.equal(url, rpcUrl);
    assert.equal(init.method, 'POST');
    const rpc = JSON.parse(String(init.body));
    assert.deepEqual(Object.keys(rpc).sort(), [
      'id',
      'jsonrpc',
      'method',
      'params',
    ]);
    assert.equal(rpc.jsonrpc, '2.0');
    const { id, method, params } = rpc;
    requests.push({ url, method, args: params });
    const result = (() => {
      if (method === 'eth_chainId') {
        assert.deepEqual(params, []);
        return '0x1';
      }
      if (method === 'eth_getBlockByNumber') {
        assert.deepEqual(params, [block.number, false]);
        return options.alterBlock?.(++blocks) ?? block;
      }
      assert.equal(method, 'eth_call');
      assert.equal(params.length, 2);
      assert.deepEqual(Object.keys(params[0]).sort(), ['data', 'to']);
      assert.equal(params[0].to, pool.address);
      const call = PRIVACY_POOL_ABI.parseTransaction({ data: params[0].data })!;
      if (call.name === 'isKnownRoot') {
        assert.equal(params[1], 'latest');
        assert.deepEqual(Array.from(call.args), [data.root]);
        return PRIVACY_POOL_ABI.encodeFunctionResult(call.name, [true]);
      }
      assert.equal(params[1], block.number);
      assert.deepEqual(Array.from(call.args), []);
      const values: Record<string, string | number | bigint> = {
        nextIndex: data.leafCount,
        getLastRoot: data.root,
        levels: 20,
        denomination: parseEther(pool.amount),
      };
      assert.ok(Object.hasOwn(values, call.name));
      return PRIVACY_POOL_ABI.encodeFunctionResult(call.name, [
        values[call.name],
      ]);
    })();
    return json(url, { jsonrpc: '2.0', id, result });
  };
  return { requests, transport };
}
function create(transport: WalletHttpFetch, owner = new AbortController()) {
  return {
    owner,
    sync: createNativePrivacyPoolSync({
      network,
      poolId,
      lifetime: owner.signal,
      transport,
    }),
  };
}

test('explicit native sync verifies the same root and two anchors and reads note/path status locally', async () => {
  const data = snapshot();
  const provider = fixture(data);
  const { owner, sync } = create(provider.transport);
  assert.deepEqual(sync.getStatus(), { poolId, phase: 'idle' });
  assert.deepEqual(await sync.readNote(note), { phase: 'waiting' });
  await assert.rejects(sync.readSnapshot(poolId), {
    message: 'privacy_verification_pending',
  });
  assert.equal(provider.requests.length, 0);
  const refresh = sync.refresh();
  assert.equal(sync.refresh(), refresh);
  assert.equal((await refresh).phase, 'ready');
  assert.equal(provider.requests.length, 17);
  assert.equal(
    provider.requests.filter((r) => r.method === 'eth_getBlockByNumber').length,
    4
  );
  assert.equal(
    provider.requests.filter((r) => r.method === 'eth_chainId').length,
    2
  );
  assert.deepEqual(await sync.readNote(note), {
    phase: 'spent',
    blockNumber: data.asOfBlockNumber,
  });
  assert.deepEqual(await sync.readNote({ ...note, nullifierHash: word(201) }), {
    phase: 'verified',
    blockNumber: data.asOfBlockNumber,
  });
  assert.deepEqual(await sync.readNote({ ...note, commitment: word(201) }), {
    phase: 'not-found',
    blockNumber: data.asOfBlockNumber,
  });
  await assert.rejects(sync.readNote({ ...note, poolId: 'eth-1' }), {
    message: 'privacy_verification_pending',
  });
  const lease = await sync.readSnapshot(poolId);
  assert.equal(lease.snapshot.root, data.root);
  assert.ok(Object.isFrozen(lease.snapshot.leaves));
  const path = await lease.getPath(0);
  assert.equal(path.pathElements.length, 20);
  assert.equal(path.pathElements[0], data.leaves[1]);
  assert.equal(provider.requests.length, 17);
  owner.abort();
  assert.throws(() => lease.assertSnapshotCurrent(lease.snapshot), {
    message: 'privacy_verification_pending',
  });
  await assert.rejects(lease.getPath(0), {
    message: 'privacy_verification_pending',
  });
  await assert.rejects(sync.readNote(note), { message: 'privacy_cancelled' });
  await sync.dispose();
});

test('index progress never auto-polls and only an explicit second refresh reads again', async () => {
  const data = snapshot();
  const provider = fixture(data, {
    index: (count) =>
      count === 1
        ? json(
            indexUrl,
            {
              phase: 'syncing',
              startBlock: pool.deploymentBlock,
              scannedBlock: pool.deploymentBlock + 1,
              targetBlock: pool.deploymentBlock + 5,
            },
            202
          )
        : json(indexUrl, data),
  });
  const { sync } = create(provider.transport);
  assert.deepEqual(await sync.refresh(), {
    phase: 'syncing',
    poolId,
    errorCode: undefined,
    completed: 2,
    total: 6,
  });
  assert.equal(sync.getStatus().phase, 'syncing');
  assert.deepEqual(await sync.readNote(note), { phase: 'waiting' });
  assert.equal(provider.requests.length, 1);
  assert.equal((await sync.refresh()).phase, 'ready');
  assert.equal(provider.requests.length, 18);
  await sync.dispose();
});

test('second anchor disagreement and locally wrong roots never become ready', async () => {
  const reorg = fixture(snapshot(), {
    alterBlock: (count) =>
      count === 4 ? { ...block, hash: word(101) } : block,
  });
  const first = create(reorg.transport).sync;
  assert.equal((await first.refresh()).errorCode, 'privacy_anchor_changed');
  assert.deepEqual(await first.readNote(note), { phase: 'waiting' });
  await assert.rejects(first.readSnapshot(poolId), {
    message: 'privacy_verification_pending',
  });
  await first.dispose();
  const forgedRoot = create(
    fixture({ ...snapshot(), root: word(60) }).transport
  ).sync;
  assert.equal(
    (await forgedRoot.refresh()).errorCode,
    'privacy_verification_failed'
  );
  await forgedRoot.dispose();
});

test('refuses wrong registrations, wrong pool payloads, and response URL substitutions', async () => {
  const provider = fixture();
  assert.throws(
    () =>
      createNativePrivacyPoolSync({
        poolId,
        lifetime: new AbortController().signal,
        network: createNativeNetwork({
          id: 'other',
          name: 'Other EVM',
          kind: 'evm',
          chainId: '56',
          slip44: 60,
          rpcUrl,
          symbol: 'BNB',
          decimals: 18,
          testnet: false,
        }),
        transport: provider.transport,
      }),
    { message: 'privacy_wrong_chain' }
  );
  assert.equal(provider.requests.length, 0);
  const wrong = create(
    fixture({ ...snapshot(), poolAddress: getPrivacyPool('eth-1').address })
      .transport
  ).sync;
  assert.equal((await wrong.refresh()).errorCode, 'privacy_data_invalid');
  await wrong.dispose();
  const redirected = create(async () =>
    json('https://other.example/', snapshot())
  ).sync;
  assert.equal(
    (await redirected.refresh()).errorCode,
    'privacy_service_unavailable'
  );
  await redirected.dispose();
});

test('requires a stream and stops on length, chunk and aggregate budgets', async () => {
  let fallbackCalled = false;
  const noStream = response(indexUrl, null);
  noStream.text = async () => {
    fallbackCalled = true;
    return '{}';
  };
  const missing = create(async () => noStream).sync;
  assert.equal((await missing.refresh()).phase, 'error');
  assert.equal(fallbackCalled, false);
  await missing.dispose();
  let cancelledStream = false;
  const oversized = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
    },
    cancel() {
      cancelledStream = true;
    },
  });
  const chunk = create(async () => response(indexUrl, oversized)).sync;
  assert.equal((await chunk.refresh()).errorCode, 'privacy_data_too_large');
  assert.equal(cancelledStream, true);
  await chunk.dispose();
  const declared = create(async () =>
    response(indexUrl, '{}', 200, { 'content-length': '2097153' })
  ).sync;
  assert.equal((await declared.refresh()).errorCode, 'privacy_data_too_large');
  await declared.dispose();
  const padded = create(
    fixture(snapshot(), {
      alterBlock: () => ({ ...block, padding: 'a'.repeat(1024 * 1024) }),
    }).transport
  ).sync;
  assert.equal((await padded.refresh()).errorCode, 'privacy_data_too_large');
  await padded.dispose();
});

test('owner replacement aborts held headers and a late response cannot publish into a fresh owner', async () => {
  let signal!: AbortSignal;
  let release!: (result: Response) => void;
  let dispatched!: () => void;
  const entered = new Promise<void>((resolve) => {
    dispatched = resolve;
  });
  const first = create(
    async (_url, init) =>
      new Promise<Response>((resolve) => {
        signal = init.signal!;
        release = resolve;
        dispatched();
      })
  );
  const stale = first.sync.refresh();
  await entered;
  first.owner.abort();
  assert.equal(signal.aborted, true);
  await assert.rejects(stale, { message: 'privacy_cancelled' });
  await first.sync.dispose();
  const second = create(fixture().transport).sync;
  let discarded = false;
  release(
    response(
      indexUrl,
      new ReadableStream({
        cancel() {
          discarded = true;
        },
      })
    )
  );
  assert.equal((await second.refresh()).phase, 'ready');
  assert.equal(discarded, true);
  await assert.rejects(first.sync.refresh(), { message: 'privacy_cancelled' });
  await second.dispose();
});

test('Merkle processing yields to owner cancellation before a final anchor request', async () => {
  const provider = fixture(snapshot(64));
  const { owner, sync } = create(provider.transport);
  let partial = 0;
  const watcher = setInterval(() => {
    const status = sync.getStatus();
    if (
      status.phase === 'verifying' &&
      (status.completed ?? 0) > 0 &&
      status.completed! < 64
    ) {
      partial = status.completed!;
      clearInterval(watcher);
      owner.abort();
    }
  }, 0);
  try {
    await assert.rejects(sync.refresh(), { message: 'privacy_cancelled' });
    assert.ok(partial > 0 && partial < 64);
    assert.equal(provider.requests.length, 9);
  } finally {
    clearInterval(watcher);
    await sync.dispose();
  }
});

test('a monotonic elapsed deadline rejects even before its delayed timer callback runs', async (context) => {
  let now = 0;
  context.mock.method(performance, 'now', () => now);
  let read = false;
  const { sync } = create(async () => {
    now = 45001;
    return response(
      indexUrl,
      new ReadableStream(
        {
          pull() {
            read = true;
          },
        },
        { highWaterMark: 0 }
      )
    );
  });
  await assert.rejects(sync.refresh(), { message: 'privacy_cancelled' });
  assert.equal(read, false);
  assert.equal(sync.getStatus().phase, 'idle');
  await sync.dispose();
});

test('a transport ignoring its request deadline cannot accumulate another dispatch on the same owner', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let release!: (result: Response) => void;
  let entered!: () => void;
  const admitted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let requests = 0;
  const { sync } = create(async (_url, init) => {
    requests++;
    if (requests !== 1)
      return json(
        indexUrl,
        {
          phase: 'syncing',
          startBlock: pool.deploymentBlock,
          scannedBlock: pool.deploymentBlock,
          targetBlock: pool.deploymentBlock,
        },
        202
      );
    return new Promise<Response>((resolve) => {
      release = resolve;
      assert.equal(init.signal?.aborted, false);
      entered();
    });
  });
  const refresh = sync.refresh();
  await admitted;
  context.mock.timers.tick(25_000);
  assert.equal((await refresh).phase, 'error');
  await assert.rejects(sync.refresh(), {
    message: 'privacy_verification_pending',
  });
  assert.equal(requests, 1);
  let discarded!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    discarded = resolve;
  });
  release(response(indexUrl, new ReadableStream({ cancel: discarded })));
  await cancelled;
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal((await sync.refresh()).phase, 'syncing');
  assert.equal(requests, 2);
  await sync.dispose();
});

test('an elapsed owner cannot publish the verified cache after the final RPC decoded', async (context) => {
  let clock = 0;
  context.mock.method(performance, 'now', () => clock);
  const provider = fixture();
  let knownRootReads = 0;
  let expiryReached = false;
  let readAtDeadline: unknown;
  const { sync } = create(async (url, init) => {
    const result = await provider.transport(url, init);
    if (
      url === rpcUrl &&
      JSON.parse(String(init.body)).params[1] === 'latest' &&
      ++knownRootReads === 2
    ) {
      Object.defineProperty(result, 'status', {
        get() {
          clock = 45_001;
          expiryReached = true;
          queueMicrotask(() => {
            try {
              readAtDeadline = sync.getStatus();
            } catch (error) {
              readAtDeadline = error instanceof Error ? error.message : error;
            }
          });
          return 200;
        },
      });
    }
    return result;
  });
  await assert.rejects(sync.refresh(), { message: 'privacy_cancelled' });
  assert.equal(expiryReached, true);
  assert.equal(readAtDeadline, 'privacy_cancelled');
  assert.equal(provider.requests.length, 17);
  assert.equal(sync.getStatus().phase, 'idle');
  assert.deepEqual(await sync.readNote(note), { phase: 'waiting' });
  await assert.rejects(sync.readSnapshot(poolId), {
    message: 'privacy_verification_pending',
  });
  await sync.dispose();
});
