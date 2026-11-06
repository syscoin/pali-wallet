import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPrivacyServiceSettings,
  DEFAULT_PRIVACY_SERVICE_ORIGIN,
} from '../../../source/shared/privacyServiceOrigin.ts';
import { getBytes, hexlify, parseEther, toQuantity } from 'ethers/utils';
import {
  advanceMerkleWork,
  createMerkleWork,
  hashPair,
} from '../../../source/utils/privacy/merkle.ts';
import { PRIVACY_POOL_ABI } from '../../../source/utils/privacy/publicSyncProtocol.ts';
import { getPrivacyPool } from '../../../source/utils/privacy/registry.ts';
import type { PrivacySnapshot } from '../../../source/utils/privacy/types.ts';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import {
  createNativePrivacyPoolSync,
  type OwnedPrivacyPullTransport,
} from '../src/privacy/nativePrivacyPoolSync.ts';

const poolId = 'eth-0.1';
const pool = getPrivacyPool(poolId);
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
type Handle = ReturnType<OwnedPrivacyPullTransport['prepareSnapshot']>;
function json(value: unknown, status = 200): Handle {
  const body = new TextEncoder().encode(JSON.stringify(value));
  let offset = 0;
  return {
    async start(check) {
      check();
      return { status, byteCount: body.length };
    },
    async pull(check) {
      check();
      if (offset === body.length) return null;
      const end = Math.min(body.length, offset + 64 * 1024);
      const chunk = body.slice(offset, end);
      offset = end;
      return chunk;
    },
    async release() {},
  };
}
function snapshots(
  prepareSnapshot: OwnedPrivacyPullTransport['prepareSnapshot']
): OwnedPrivacyPullTransport {
  return {
    prepareSnapshot,
    prepareAnchor() {
      throw new Error('Unexpected anchor read');
    },
  };
}
function fixture(
  data = snapshot(),
  options: {
    alterBlock?: (count: number) => object;
    index?: (count: number) => Handle;
    release?: (kind: string, count: number) => Promise<void>;
    serviceOrigin?: string;
  } = {}
) {
  let indexes = 0,
    blocks = 0,
    occupied = false;
  const requests: string[] = [],
    released: string[] = [];
  const ids = new Set<number>();
  const wrap = (kind: string, handle: Handle, signal: AbortSignal): Handle => {
    assert.equal(occupied, false, 'one native slot');
    assert.equal(signal.aborted, false);
    occupied = true;
    let started = false;
    return {
      async start(check) {
        check();
        assert.equal(started, false);
        started = true;
        requests.push(kind);
        return handle.start(check);
      },
      async pull(check) {
        check();
        return handle.pull(check);
      },
      async release() {
        assert.equal(occupied, true);
        await options.release?.(kind, requests.length);
        await handle.release();
        released.push(kind);
        occupied = false;
      },
    };
  };
  const transport: OwnedPrivacyPullTransport = {
    prepareSnapshot(selected, serviceOrigin, signal) {
      assert.equal(selected, poolId);
      assert.equal(
        serviceOrigin,
        options.serviceOrigin ?? DEFAULT_PRIVACY_SERVICE_ORIGIN
      );
      return wrap('snapshot', options.index?.(++indexes) ?? json(data), signal);
    },
    prepareAnchor(binding, read, id, signal) {
      assert.deepEqual(binding, {
        rpcUrl,
        poolAddress: pool.address,
        blockNumber: data.asOfBlockNumber,
        root: data.root,
      });
      assert.equal(ids.has(id), false);
      ids.add(id);
      const values = {
        nextIndex: data.leafCount,
        getLastRoot: data.root,
        levels: 20,
        denomination: parseEther(pool.amount),
        isKnownRoot: true,
      };
      const result =
        read === 'chainId'
          ? '0x1'
          : read === 'block'
          ? options.alterBlock?.(++blocks) ?? block
          : PRIVACY_POOL_ABI.encodeFunctionResult(read, [values[read]]);
      return wrap(read, json({ jsonrpc: '2.0', id, result }), signal);
    },
  };
  return { requests, released, transport };
}
function create(
  transport: OwnedPrivacyPullTransport,
  owner = new AbortController(),
  executeMerkleBatch = evaluateMerkleBatch,
  service = { origin: DEFAULT_PRIVACY_SERVICE_ORIGIN, assertCurrent() {} }
) {
  return {
    owner,
    sync: createNativePrivacyPoolSync({
      network,
      poolId,
      lifetime: owner.signal,
      transport,
      executeMerkleBatch,
      service,
    }),
  };
}

async function evaluateMerkleBatch(
  program: Uint8Array,
  signal: AbortSignal,
  check: () => void
): Promise<Uint8Array> {
  check();
  assert.equal(signal.aborted, false);
  const view = new DataView(
    program.buffer,
    program.byteOffset,
    program.byteLength
  );
  const count = view.getUint16(1);
  assert.equal(program[0], 1);
  assert.equal(program.length, 3 + 66 * count);
  assert(count > 0 && count <= 296);
  const output = new Uint8Array(32 * count);
  for (let index = 0; index < count; index++) {
    const operands = [3 + 66 * index, 36 + 66 * index].map((offset) => {
      if (program[offset] === 0)
        return hexlify(program.subarray(offset + 1, offset + 33));
      assert.equal(program[offset], 1);
      const reference = view.getUint16(offset + 1);
      assert(reference < index);
      assert.deepEqual(
        program.subarray(offset + 3, offset + 33),
        new Uint8Array(30)
      );
      return hexlify(output.subarray(reference * 32, (reference + 1) * 32));
    });
    output.set(getBytes(hashPair(operands[0]!, operands[1]!)), 32 * index);
  }
  check();
  return output;
}

test('a retired native batch drains without publishing its checkpoint, paths or second anchor', async () => {
  const provider = fixture();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { sync, owner } = create(
    provider.transport,
    new AbortController(),
    async (program, signal, check) => {
      const bytes = await evaluateMerkleBatch(program, signal, check);
      entered();
      await held;
      return bytes;
    }
  );
  const pending = sync.refresh();
  await started;
  owner.abort();
  release();
  await assert.rejects(pending, { message: 'privacy_cancelled' });
  assert.equal(
    provider.requests.filter((kind) => kind === 'chainId').length,
    1
  );
  await assert.rejects(sync.readSnapshot(poolId));
  await sync.dispose();
});

test('a dense malformed native snapshot drains before contacting the anchor or executing Merkle work', async () => {
  const provider = fixture(snapshot(), {
    index: () => json({ leaves: Array.from({ length: 4096 }, () => ({})) }),
  });
  const { sync } = create(provider.transport, undefined, async () => {
    assert.fail('unexpected Merkle work');
  });
  assert.equal((await sync.refresh()).phase, 'error');
  assert.deepEqual(provider.requests, ['snapshot']);
  assert.deepEqual(provider.released, ['snapshot']);
  await assert.rejects(sync.readSnapshot(poolId));
  await sync.dispose();
});

test('invalid native batch output cannot produce a verified snapshot or run its second anchor', async () => {
  const provider = fixture();
  const { sync } = create(
    provider.transport,
    new AbortController(),
    async (program, signal, check) => {
      const bytes = await evaluateMerkleBatch(program, signal, check);
      return bytes.subarray(0, bytes.length - 1);
    }
  );
  assert.equal((await sync.refresh()).phase, 'error');
  assert.equal(
    provider.requests.filter((kind) => kind === 'chainId').length,
    1
  );
  assert.deepEqual(await sync.readNote(note), { phase: 'waiting' });
  await assert.rejects(sync.readSnapshot(poolId));
  await sync.dispose();
});

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
  assert.equal(provider.requests.filter((kind) => kind === 'block').length, 4);
  assert.equal(
    provider.requests.filter((kind) => kind === 'chainId').length,
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
  assert.deepEqual(provider.released, provider.requests);
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
            {
              phase: 'syncing',
              startBlock: pool.deploymentBlock,
              scannedBlock: pool.deploymentBlock + 1,
              targetBlock: pool.deploymentBlock + 5,
            },
            202
          )
        : json(data),
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

test('native snapshots use the captured custom service origin', async () => {
  for (const origin of [
    'https://privacy.example:8443',
    'http://localhost:8800',
  ]) {
    const provider = fixture(snapshot(), { serviceOrigin: origin });
    const { sync } = create(provider.transport, undefined, undefined, {
      origin: origin + '/',
      assertCurrent() {},
    });
    assert.equal((await sync.refresh()).phase, 'ready');
    await sync.dispose();
  }
});

test('invalid service origins cannot reserve a native snapshot', () => {
  const provider = fixture();
  for (const origin of [
    'http://remote.example',
    'https://privacy.example/path',
    'https://user@privacy.example',
    'https://privacy.example?override=1',
    'https://privacy.example#fragment',
  ]) {
    assert.throws(
      () =>
        create(provider.transport, undefined, undefined, {
          origin,
          assertCurrent() {},
        }),
      /privacy_service_origin_invalid/
    );
  }
  assert.deepEqual(provider.requests, []);
});

test('changing the service retires an admitted native response before anchors or publication', async () => {
  let saved: string | undefined;
  const settings = createPrivacyServiceSettings({
    async read() {
      return saved;
    },
    async write(_key, origin) {
      saved = origin;
    },
  });
  const captured = await settings.capture();
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<{ status: number; byteCount: number }>();
  let releases = 0;
  const transport = snapshots((selected, origin) => {
    assert.equal(selected, poolId);
    assert.equal(origin, captured.origin);
    return {
      async start(check) {
        check();
        entered.resolve();
        return finish.promise;
      },
      async pull() {
        assert.fail('retired response must not be read');
      },
      async release() {
        releases++;
      },
    };
  });
  const { sync } = create(transport, undefined, undefined, captured);
  const pending = sync.refresh();
  await entered.promise;
  await settings.changeOrigin(
    'https://new-privacy.example',
    async () => undefined
  );
  finish.resolve({ status: 200, byteCount: 4 });
  await assert.rejects(pending, /privacy_cancelled/);
  assert.equal(releases, 1);
  assert.throws(() => sync.getStatus(), /privacy_cancelled/);
  await assert.rejects(sync.readSnapshot(poolId), /privacy_cancelled/);
  await sync.dispose();
});

test('refuses wrong registrations and wrong pool payloads before any anchor reservation', async () => {
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
        executeMerkleBatch: evaluateMerkleBatch,
        service: { origin: DEFAULT_PRIVACY_SERVICE_ORIGIN, assertCurrent() {} },
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
});

test('the snapshot handle fully releases before the first sequential anchor can reserve', async () => {
  const reached = Promise.withResolvers<void>(),
    drain = Promise.withResolvers<void>();
  const provider = fixture(snapshot(), {
    async release(kind) {
      if (kind === 'snapshot') {
        reached.resolve();
        await drain.promise;
      }
    },
  });
  const { sync } = create(provider.transport);
  const pending = sync.refresh();
  await reached.promise;
  assert.deepEqual(provider.requests, ['snapshot']);
  drain.resolve();
  assert.equal((await pending).phase, 'ready');
  const anchorOrder = [
    'chainId',
    'block',
    'nextIndex',
    'getLastRoot',
    'levels',
    'denomination',
    'block',
    'isKnownRoot',
  ];
  assert.deepEqual(provider.requests, [
    'snapshot',
    ...anchorOrder,
    ...anchorOrder,
  ]);
  assert.deepEqual(provider.released, provider.requests);
  await sync.dispose();
});

test('requires exact EOF and enforces retained byte count, 64 KiB pulls and aggregate budgets', async () => {
  for (const [size, chunk, errorCode] of [
    [4, new Uint8Array(3), 'privacy_data_invalid'],
    [4, new Uint8Array(5), 'privacy_data_invalid'],
    [64 * 1024 + 1, new Uint8Array(64 * 1024 + 1), 'privacy_data_invalid'],
    [2 * 1024 * 1024 + 1, new Uint8Array(4), 'privacy_data_too_large'],
  ] as const) {
    let pulls = 0,
      releases = 0;
    const { sync } = create(
      snapshots(() => ({
        async start(check) {
          check();
          return { status: 200, byteCount: size };
        },
        async pull(check) {
          check();
          return pulls++ ? null : chunk;
        },
        async release() {
          releases++;
        },
      }))
    );
    assert.equal((await sync.refresh()).errorCode, errorCode);
    assert.equal(releases, 1);
    if (size > 2 * 1024 * 1024) assert.equal(pulls, 0);
    await sync.dispose();
  }
  const padded = create(
    fixture(snapshot(), {
      alterBlock: () => ({ ...block, padding: 'a'.repeat(1024 * 1024) }),
    }).transport
  ).sync;
  assert.equal((await padded.refresh()).errorCode, 'privacy_data_too_large');
  await padded.dispose();
});

test('owner replacement releases a held native pull and rejects its late bytes', async () => {
  const pulled = Promise.withResolvers<void>(),
    late = Promise.withResolvers<Uint8Array | null>();
  let releases = 0,
    pulls = 0;
  let signal!: AbortSignal;
  const first = create(
    snapshots((_pool, _serviceOrigin, ownerSignal) => {
      signal = ownerSignal;
      return {
        async start(check) {
          check();
          return { status: 200, byteCount: 4 };
        },
        async pull(check) {
          check();
          pulls++;
          pulled.resolve();
          return late.promise;
        },
        async release() {
          releases++;
        },
      };
    })
  );
  const stale = first.sync.refresh();
  await pulled.promise;
  first.owner.abort();
  await assert.rejects(stale, { message: 'privacy_cancelled' });
  await first.sync.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(releases, 1);
  const second = create(fixture().transport).sync;
  late.resolve(new Uint8Array(4));
  assert.equal((await second.refresh()).phase, 'ready');
  assert.equal(pulls, 1);
  await assert.rejects(first.sync.refresh(), { message: 'privacy_cancelled' });
  await second.dispose();
});

test('Merkle processing yields to owner cancellation before a final anchor request', async () => {
  const leafCount = 256;
  const provider = fixture(snapshot(leafCount));
  const { owner, sync } = create(provider.transport);
  let partial = 0;
  const watcher = setInterval(() => {
    const status = sync.getStatus();
    if (
      status.phase === 'verifying' &&
      (status.completed ?? 0) > 0 &&
      status.completed! < leafCount
    ) {
      partial = status.completed!;
      clearInterval(watcher);
      owner.abort();
    }
  }, 0);
  try {
    await assert.rejects(sync.refresh(), { message: 'privacy_cancelled' });
    assert.ok(partial > 0 && partial < leafCount);
    assert.equal(provider.requests.length, 9);
  } finally {
    clearInterval(watcher);
    await sync.dispose();
  }
});

test('a monotonic elapsed deadline rejects native admission before pulls', async (context) => {
  let now = 0,
    pulls = 0,
    releases = 0;
  context.mock.method(performance, 'now', () => now);
  const { sync } = create(
    snapshots(() => ({
      async start(check) {
        check();
        now = 45001;
        return { status: 200, byteCount: 4 };
      },
      async pull() {
        pulls++;
        return null;
      },
      async release() {
        releases++;
      },
    }))
  );
  await assert.rejects(sync.refresh(), { message: 'privacy_cancelled' });
  assert.equal(pulls, 0);
  assert.equal(releases, 1);
  assert.equal(sync.getStatus().phase, 'idle');
  await sync.dispose();
});

test('deadline retires held start without letting a replacement reserve before release ACK', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const admitted = Promise.withResolvers<void>(),
    started = Promise.withResolvers<{ status: number; byteCount: number }>();
  const releasing = Promise.withResolvers<void>(),
    released = Promise.withResolvers<void>();
  let reservations = 0,
    pulls = 0,
    releases = 0;
  const { sync } = create(
    snapshots((_pool, _serviceOrigin, signal) => {
      if (++reservations !== 1)
        return json(
          {
            phase: 'syncing',
            startBlock: pool.deploymentBlock,
            scannedBlock: pool.deploymentBlock,
            targetBlock: pool.deploymentBlock,
          },
          202
        );
      return {
        async start(check) {
          check();
          admitted.resolve();
          return started.promise;
        },
        async pull() {
          pulls++;
          return null;
        },
        async release() {
          assert.equal(signal.aborted, true);
          releases++;
          releasing.resolve();
          await released.promise;
        },
      };
    })
  );
  const refresh = sync.refresh();
  await admitted.promise;
  context.mock.timers.tick(25_000);
  assert.equal((await refresh).phase, 'error');
  await releasing.promise;
  await assert.rejects(sync.refresh(), {
    message: 'privacy_verification_pending',
  });
  assert.equal(reservations, 1);
  started.resolve({ status: 200, byteCount: 4 });
  released.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal((await sync.refresh()).phase, 'syncing');
  assert.equal(reservations, 2);
  assert.equal(pulls, 0);
  assert.equal(releases, 1);
  await sync.dispose();
});

test('a failed exact release does not admit another snapshot or any anchor', async () => {
  let reservations = 0;
  const { sync } = create(
    snapshots(() => {
      reservations++;
      return {
        ...json(snapshot()),
        async release() {
          throw new Error('Release unconfirmed');
        },
      };
    })
  );
  assert.equal((await sync.refresh()).phase, 'error');
  await assert.rejects(sync.refresh(), {
    message: 'privacy_verification_pending',
  });
  assert.equal(reservations, 1);
  await sync.dispose();
});

test('an elapsed owner cannot publish the verified cache after the final RPC decoded', async (context) => {
  let clock = 0;
  context.mock.method(performance, 'now', () => clock);
  let readAtDeadline: unknown;
  const provider = fixture(snapshot(), {
    async release(kind, count) {
      if (kind === 'isKnownRoot' && count === 17) {
        clock = 45_001;
        try {
          sync.getStatus();
        } catch (error) {
          readAtDeadline = error instanceof Error ? error.message : error;
        }
      }
    },
  });
  const { sync } = create(provider.transport);
  await assert.rejects(sync.refresh(), { message: 'privacy_cancelled' });
  assert.equal(readAtDeadline, 'privacy_cancelled');
  assert.equal(provider.requests.length, 17);
  assert.equal(sync.getStatus().phase, 'idle');
  assert.deepEqual(await sync.readNote(note), { phase: 'waiting' });
  await assert.rejects(sync.readSnapshot(poolId), {
    message: 'privacy_verification_pending',
  });
  await sync.dispose();
});
