import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import {
  NATIVE_PRIVACY_RUN_BYTES,
  NATIVE_PRIVACY_SNAPSHOT_BYTES,
} from '../src/privacy/nativePrivacySnapshotBudget.ts';
import {
  createPublicSnapshotTransport,
  type PublicSnapshotModule,
} from '../src/privacy/publicSnapshotTransport.ts';

const origin = 'https://snapshot.example';
const current = () => undefined;

test('both native snapshot ceilings match the shared bounded budget', async () => {
  const ios = await readFile(
    new NodeURL(
      '../modules/pali-wallet-storage/ios/PaliPublicSnapshotDownload.swift',
      import.meta.url
    ),
    'utf8'
  );
  const android = await readFile(
    new NodeURL(
      '../modules/pali-wallet-storage/android/src/main/java/org/syscoin/pali/storage/PaliPublicSnapshotDownload.kt',
      import.meta.url
    ),
    'utf8'
  );
  const iosMaximum = ios.match(
    /return try reserve\(endpoint, timeout: 25, snapshotLimit: (\d+) \* 1024 \* 1024, completion: completion\)/
  );
  const androidMaximum = android.match(
    /private const val SNAPSHOT_BYTES = (\d+) \* 1024 \* 1024/
  );
  assert.ok(iosMaximum);
  assert.ok(androidMaximum);
  assert.equal(
    Number(iosMaximum[1]) * 1024 * 1024,
    NATIVE_PRIVACY_SNAPSHOT_BYTES
  );
  assert.equal(
    Number(androidMaximum[1]) * 1024 * 1024,
    NATIVE_PRIVACY_SNAPSHOT_BYTES
  );
  assert.equal(
    NATIVE_PRIVACY_RUN_BYTES,
    NATIVE_PRIVACY_SNAPSHOT_BYTES + 4 * 1024 * 1024
  );
});

function fixture(overrides: Partial<PublicSnapshotModule> = {}) {
  const calls: unknown[][] = [];
  const native: PublicSnapshotModule = {
    preparePublicSnapshot(...args) {
      calls.push(['prepareSnapshot', ...args]);
      return 'snapshot';
    },
    preparePublicSnapshotAnchor(...args) {
      calls.push(['prepareAnchor', ...args]);
      return 'anchor';
    },
    async startPublicSnapshot(token) {
      calls.push(['start', token]);
      return { status: 200, byteCount: 1 };
    },
    async pullPublicSnapshot(token) {
      calls.push(['pull', token]);
      return Uint8Array.of(42).buffer;
    },
    async releasePublicSnapshot(token) {
      calls.push(['release', token]);
    },
    ...overrides,
  };
  return { calls, transport: createPublicSnapshotTransport(native) };
}

test('the current owner reserves on start and uses the exact native token until release', async () => {
  const { calls, transport } = fixture();
  const signal = new AbortController().signal;
  const snapshot = transport.prepareSnapshot('eth-1', origin, signal);
  const anchor = transport.prepareAnchor(
    { rpcUrl: 'https://rpc.example', poolAddress: 'pool', blockNumber: 7, root: 'root' },
    'block',
    2,
    signal
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(await snapshot.start(current), { status: 200, byteCount: 1 });
  await assert.rejects(anchor.start(current), /privacy_cancelled/);
  assert.deepEqual(await snapshot.pull(current), Uint8Array.of(42));
  const released = snapshot.release();
  assert.equal(snapshot.release(), released);
  await released;
  await anchor.start(current);
  await anchor.release();
  assert.deepEqual(calls, [
    ['prepareSnapshot', 'eth-1', origin], ['start', 'snapshot'], ['pull', 'snapshot'],
    ['release', 'snapshot'], ['prepareAnchor', 'https://rpc.example', 'pool', 7, 'root', 'block', 2],
    ['start', 'anchor'], ['release', 'anchor'],
  ]);
});

test('late start completion cannot publish or release a replacement slot', async () => {
  const pending = Promise.withResolvers<{ status: number; byteCount: number }>();
  const nativeRelease = Promise.withResolvers<void>();
  const releases: string[] = [];
  const { transport } = fixture({
    startPublicSnapshot: () => pending.promise,
    releasePublicSnapshot: (token) => { releases.push(token); return nativeRelease.promise; },
  });
  const controller = new AbortController();
  const first = transport.prepareSnapshot('eth-1', origin, controller.signal);
  const second = transport.prepareSnapshot('eth-1', origin, new AbortController().signal);
  const starting = first.start(current);
  controller.abort();
  const retired = first.release();
  await Promise.resolve();
  assert.deepEqual(releases, ['snapshot']);
  nativeRelease.resolve();
  await assert.rejects(second.start(current), /privacy_cancelled/);
  pending.resolve({ status: 200, byteCount: 1 });
  await assert.rejects(starting, /privacy_cancelled/);
  await retired;
  await second.start(current);
  await second.release();
});

test('a retired pending pull cannot publish bytes and must drain before reuse', async () => {
  const pending = Promise.withResolvers<Uint8Array>();
  const { transport } = fixture({ pullPublicSnapshot: () => pending.promise });
  const signal = new AbortController().signal;
  const first = transport.prepareSnapshot('eth-1', origin, signal);
  const next = transport.prepareSnapshot('eth-1', origin, signal);
  await first.start(current);
  const reading = first.pull(current);
  await assert.rejects(first.pull(current), /privacy_cancelled/);
  const retired = first.release();
  await assert.rejects(next.start(current), /privacy_cancelled/);
  pending.resolve(Uint8Array.of(42));
  await assert.rejects(reading, /privacy_cancelled/);
  await retired;
  await next.start(current);
  await next.release();
});

test('retirement during synchronous reservation cleans the exact reservation without dispatch', async () => {
  const releases: string[] = [];
  let retire!: () => Promise<void>;
  const { calls, transport } = fixture({
    preparePublicSnapshot() { void retire(); return 'old'; },
    async releasePublicSnapshot(token) { releases.push(token); },
  });
  const handle = transport.prepareSnapshot('eth-1', origin, new AbortController().signal);
  retire = handle.release;
  await assert.rejects(handle.start(current), /privacy_cancelled/);
  await handle.release();
  assert.deepEqual(releases, ['old']);
  assert.deepEqual(calls, []);
});

test('an asynchronous guard and a lost release acknowledgement both fail closed', async () => {
  const { calls, transport } = fixture({
    async releasePublicSnapshot() { throw new Error('release unavailable'); },
  });
  const signal = new AbortController().signal;
  const first = transport.prepareSnapshot('eth-1', origin, signal);
  await assert.rejects(first.start(async () => { throw new Error('stale'); }), /privacy_cancelled/);
  assert.deepEqual(calls, []);
  await first.start(current);
  await assert.rejects(first.release(), /release unavailable/);
  await assert.rejects(transport.prepareSnapshot('eth-1', origin, signal).start(current), /privacy_cancelled/);
});
