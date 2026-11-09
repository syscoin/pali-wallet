import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNativeSlhExecution,
  purgeNativeSlhPublicCache,
  type NativeSlhContext,
  type NativeSlhExecutionModule,
  type NativeSlhKey,
  type NativeSlhOperation,
  type NativeSlhTree,
} from '../src/crypto/slhDsaNativeExecution.ts';

const namespace = `0x${'19'.repeat(32)}`;
const keyId = `SLH-DSA-SHA2-128-24:0x${'13'.repeat(16)}${'00'.repeat(
  16
)}:0x${'17'.repeat(16)}${'00'.repeat(16)}`;
const hex = (size: number, byte = '00') => `0x${byte.repeat(size)}`;
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Native bridge double only: these tests exercise transport/lifetime, never cryptography. */
function fixture() {
  const calls: { name: string; args: unknown[] }[] = [];
  const signal = new AbortController();
  let current = true;
  let nativeRetired = false;
  let result:
    | ((name: string, args: unknown[]) => Promise<unknown> | undefined)
    | undefined;
  const invoke = (name: string, ...args: unknown[]) => {
    calls.push({ name, args });
  };
  const operation = <T>(
    name: string,
    args: unknown[],
    value: T
  ): NativeSlhOperation<T> => {
    invoke(`prepare:${name}`, ...args);
    return {
      cancel: () => invoke(`cancel:${name}`),
      async run() {
        invoke(`run:${name}`);
        return (await (result?.(name, args) ?? Promise.resolve(value))) as T;
      },
    };
  };
  const tree: NativeSlhTree = {
    async release(erase) {
      invoke('releaseTree', erase);
    },
  };
  const key = (): NativeSlhKey => ({ destroy: () => invoke('destroyKey') });
  const context: NativeSlhContext = {
    isRetired: () => nativeRetired,
    close: () => {
      nativeRetired = true;
      invoke('close');
    },
    dispose: async () => {
      invoke('dispose');
    },
    importSlhKeyHex: (value) => {
      invoke('importKey', value);
      return key();
    },
    importSlhSeedHex: (value) => {
      invoke('importSeed', value);
      return key();
    },
    allocateTree: () => operation('allocate', [], tree),
    loadTree: (id) => operation('load', [id], tree),
    publishTree: (value, id) => operation('publish', [value, id], undefined),
    readTreeRoot: (value) => operation('root', [value], hex(16)),
    writeTreeLeaves: (value, start, text) =>
      operation('write', [value, start, text], undefined),
    treeChunk: (material, value, level, start, count) =>
      operation('chunk', [material, value, level, start, count], count),
    leafChunk: (material, start, count) =>
      operation('leaves', [material, start, count], hex(count * 16)),
    prelude: (...args) => operation('prelude', args, hex(46)),
    fors: (...args) => operation('fors', args, hex(416)),
    finish: (...args) => operation('finish', args, hex(3856)),
    cached: (...args) => operation('cached', args, hex(3856)),
    prepareVerify: (...args) => operation('verify', args, false),
  };
  const module: NativeSlhExecutionModule = {
    createSlhContext: (scope) => {
      nativeRetired = false;
      invoke('context', scope);
      return context;
    },
    prepareSlhCachePurge: (scope) => operation('purge', [scope], undefined),
  };
  const check = () => {
    assert(current, 'RETIRED_OWNER');
  };
  const options = {
    namespace,
    signal: signal.signal,
    assertCurrent: check,
    randomFill: (bytes: Uint8Array) => {
      bytes.fill(9);
    },
    yield: async () => {},
  };
  return {
    calls,
    module,
    options,
    signal,
    check,
    retireOwner: () => {
      current = false;
    },
    background: () => {
      nativeRetired = true;
    },
    setResult: (next: typeof result) => {
      result = next;
    },
    count: (name: string) => calls.filter((call) => call.name === name).length,
  };
}

test('SLH dedicated context validates authority synchronously before native ingress', () => {
  for (const patch of [
    { namespace: namespace.toUpperCase() },
    { namespace: '0x19' },
    { assertCurrent: async () => {} },
    { assertCurrent: () => ({ then() {} }) },
  ]) {
    const f = fixture();
    assert.throws(() =>
      createNativeSlhExecution(f.module, { ...f.options, ...patch })
    );
    assert.equal(f.count('context'), 0);
  }
  const f = fixture();
  f.signal.abort();
  assert.throws(() => createNativeSlhExecution(f.module, f.options));
  assert.equal(f.count('context'), 0);
});

test('SLH public verification uses exact raw32 framing and rejects nonboolean bridge results', async () => {
  const f = fixture(),
    owned = createNativeSlhExecution(f.module, f.options);
  assert.equal(
    await owned.verify(
      new Uint8Array(32),
      new Uint8Array(32).fill(3),
      new Uint8Array(3856)
    ),
    false
  );
  const args = f.calls.find((c) => c.name === 'prepare:verify')?.args;
  assert.deepEqual(
    args?.map((v) => (v as string).length),
    [66, 66, 7714]
  );
  f.setResult((name) =>
    name === 'verify' ? Promise.resolve(true) : undefined
  );
  assert.equal(
    await owned.verify(
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(3856)
    ),
    true
  );
  f.setResult((name) => (name === 'verify' ? Promise.resolve(1) : undefined));
  await assert.rejects(
    owned.verify(new Uint8Array(32), new Uint8Array(32), new Uint8Array(3856))
  );
  await assert.rejects(
    owned.verify(new Uint8Array(32), new Uint8Array(34), new Uint8Array(3856))
  );
  await owned.retire();
});

test('SLH fixed ingress and prefixed message transport capture exact owned bytes', async () => {
  const f = fixture(),
    owned = createNativeSlhExecution(f.module, f.options),
    h = owned.host;
  const secret = new Uint8Array(64).fill(0xab),
    key = await h.importKey(secret);
  secret.fill(0);
  assert.deepEqual(f.calls.find((c) => c.name === 'importKey')?.args, [
    hex(64, 'ab'),
  ]);
  const backing = Buffer.alloc(80, 0xcd),
    subview = backing.subarray(8, 72);
  const extraKey = await h.importKey(subview);
  assert.deepEqual(backing, Buffer.alloc(80, 0xcd));
  await h.releaseKey(extraKey);
  const message = new Uint8Array(34);
  message.fill(5, 2);
  const random = new Uint8Array(16).fill(7);
  const pending = h.signPrelude(key, message, random);
  message.fill(8);
  random.fill(8);
  assert.equal((await pending).length, 46);
  assert.deepEqual(
    f.calls.find((c) => c.name === 'prepare:prelude')?.args.slice(1),
    [`0x0000${'05'.repeat(32)}`, hex(16, '07')]
  );
  await assert.rejects(async () =>
    h.signPrelude(key, new Uint8Array(32), random)
  );
  await assert.rejects(async () =>
    h.signPrelude(key, new Uint8Array(34).fill(1), random)
  );
  assert.equal(f.count('prepare:prelude'), 1);
  await owned.retire();
});

test('SLH opaque tree API exposes only fixed root and bounded leaves, not the full cache', async () => {
  const f = fixture(),
    owned = createNativeSlhExecution(f.module, f.options),
    h = owned.host;
  const tree = await h.allocateTree();
  assert.equal((await h.readTree(tree, 134_217_696, 16)).length, 16);
  await assert.rejects(async () => h.readTree(tree, 0, 134_217_712));
  assert.throws(() => h.writeTree(tree, 0, new Uint8Array(8193 * 16)));
  assert.throws(() => h.writeTree(tree, 1, new Uint8Array(16)));
  await h.writeTree(tree, 16, new Uint8Array(32).fill(4));
  assert.deepEqual(
    f.calls.find((c) => c.name === 'prepare:write')?.args.slice(1),
    [1, hex(32, '04')]
  );
  await h.saveTree(keyId, tree);
  await assert.rejects(h.loadTree(keyId.toUpperCase()));
  await h.releaseTree(tree, false);
  await assert.rejects(async () => h.readTree(tree, 134_217_696, 16));
  await owned.retire();
});

test('SLH setup splits common 16384 geometry into two checked native chunks', async () => {
  const f = fixture(),
    owned = createNativeSlhExecution(f.module, f.options),
    h = owned.host;
  assert.equal(h.hardwareConcurrency, 1);
  assert.equal(h.forsConcurrency, 1);
  const tree = await h.allocateTree(),
    setup = await h.openSetup(new Uint8Array(48));
  assert.equal(await setup.buildChunk(tree, 0, 0, 16384), 16384);
  assert.deepEqual(
    f.calls
      .filter((c) => c.name === 'prepare:chunk')
      .map((c) => c.args.slice(2)),
    [
      [0, 0, 8192],
      [0, 8192, 8192],
    ]
  );
  await setup.dispose();
  await owned.retire();
});

test('SLH revocation drains held native work and blocks the next chunk and all delivery', async () => {
  const f = fixture(),
    owned = createNativeSlhExecution(f.module, f.options),
    h = owned.host;
  const tree = await h.allocateTree(),
    setup = await h.openSetup(new Uint8Array(48));
  const wait = held<number>();
  f.setResult((name) => (name === 'chunk' ? wait.promise : undefined));
  const work = setup.buildChunk(tree, 0, 0, 16384);
  await Promise.resolve();
  const rejection = assert.rejects(Promise.resolve(work));
  f.signal.abort();
  const retirement = owned.retire();
  assert.equal(f.count('close'), 1);
  assert.equal(f.count('cancel:chunk'), 1);
  assert.equal(f.count('dispose'), 0);
  wait.resolve(8192);
  await rejection;
  await retirement;
  assert.equal(f.count('prepare:chunk'), 1);
  assert.equal(f.count('dispose'), 1);
  await assert.rejects(async () => h.allocateTree());
  await h.releaseTree(tree, true);
  await setup.dispose();
});

test('SLH wrong key/tree owner, noncanonical native results and invalid index cannot dispatch', async () => {
  const f = fixture(),
    g = fixture(),
    a = createNativeSlhExecution(f.module, f.options),
    b = createNativeSlhExecution(g.module, g.options);
  const key = await a.host.importKey(new Uint8Array(64)),
    tree = await a.host.allocateTree();
  const message = new Uint8Array(34),
    random = new Uint8Array(16);
  await assert.rejects(async () =>
    b.host.signCached(key, message, random, tree)
  );
  assert.equal(g.count('prepare:cached'), 0);
  await assert.rejects(async () =>
    a.host.signForsTree(key, new Uint8Array(46), 6)
  );
  assert.equal(f.count('prepare:fors'), 0);
  f.setResult((name) =>
    name === 'cached' ? Promise.resolve(hex(3856, 'AA')) : undefined
  );
  await assert.rejects(
    Promise.resolve(a.host.signCached(key, message, random, tree))
  );
  await a.retire();
  await b.retire();
});

test('SLH finish retains the original prefixed message and all canonical field lengths', async () => {
  const f = fixture(),
    a = createNativeSlhExecution(f.module, f.options),
    h = a.host;
  const key = await h.importKey(new Uint8Array(64)),
    tree = await h.allocateTree();
  const message = new Uint8Array(34);
  message.fill(3, 2);
  assert.equal(
    (
      await h.finishSignature(
        key,
        message,
        new Uint8Array(46),
        new Uint8Array(2400),
        new Uint8Array(96),
        tree
      )
    ).length,
    3856
  );
  const args = f.calls.find((c) => c.name === 'prepare:finish')?.args;
  assert.equal(args?.[1], `0x0000${'03'.repeat(32)}`);
  assert.deepEqual(
    args?.slice(2, 5).map((v) => (v as string).length),
    [94, 4802, 194]
  );
  await a.retire();
});

test('SLH public purge needs only the confirmed cleanup guard and never opens key execution', async () => {
  const f = fixture();
  f.signal.abort();
  await purgeNativeSlhPublicCache(f.module, namespace, f.check);
  assert.equal(f.count('context'), 0);
  assert.equal(f.count('importKey'), 0);
  assert.equal(f.count('run:purge'), 1);
  const stale = fixture();
  stale.retireOwner();
  await assert.rejects(
    purgeNativeSlhPublicCache(stale.module, namespace, stale.check)
  );
  assert.equal(stale.count('prepare:purge'), 0);
  await assert.rejects(
    purgeNativeSlhPublicCache(f.module, namespace, async () => {})
  );
});

test('SLH held cleanup rechecks its original retired-owner authority after native drain', async () => {
  const f = fixture(),
    wait = held<void>();
  f.setResult((name) => (name === 'purge' ? wait.promise : undefined));
  const pending = purgeNativeSlhPublicCache(f.module, namespace, f.check);
  f.retireOwner();
  wait.resolve();
  await assert.rejects(pending, /RETIRED_OWNER/);
  assert.equal(f.count('cancel:purge'), 1);
  assert.equal(f.count('context'), 0);
});

test('SLH background retirement is observable and a fresh explicit context can serve a live wallet', async () => {
  const f = fixture(),
    old = createNativeSlhExecution(f.module, f.options);
  assert.equal(old.isRetired(), false);
  f.background();
  assert.equal(old.isRetired(), true);
  assert.equal(f.signal.signal.aborted, false);
  // This is a new explicit caller admission, never a retry inside the failed job.
  await old.retire();
  const fresh = createNativeSlhExecution(f.module, f.options);
  assert.equal(fresh.isRetired(), false);
  assert.equal(
    await fresh.verify(
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(3856)
    ),
    false
  );
  assert.equal(old.isRetired(), true);
  await assert.rejects(
    old.verify(new Uint8Array(32), new Uint8Array(32), new Uint8Array(3856))
  );
  await fresh.retire();
});

test('SLH post-native guard rejection joins undelivered allocate/load handle cleanup', async () => {
  for (const name of ['allocate', 'load']) {
    const f = fixture(),
      owned = createNativeSlhExecution(f.module, f.options);
    const cleanup = held<void>();
    let released = 0,
      settled = false;
    const returned: NativeSlhTree = {
      async release() {
        released++;
        await cleanup.promise;
      },
    };
    f.setResult((operation) =>
      operation === name
        ? Promise.resolve().then(() => {
            f.retireOwner();
            return returned;
          })
        : undefined
    );
    const pending = Promise.resolve(
      name === 'allocate'
        ? owned.host.allocateTree()
        : owned.host.loadTree(keyId)
    );
    const rejection = assert.rejects(pending).then(() => {
      settled = true;
    });
    for (let turn = 0; turn < 12 && !released; turn++) await Promise.resolve();
    assert.equal(released, 1);
    assert.equal(settled, false);
    const retirement = owned.retire();
    assert.equal(f.count('dispose'), 0);
    cleanup.resolve();
    await rejection;
    await retirement;
  }
});
