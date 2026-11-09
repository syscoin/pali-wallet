import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { bytesToHex, hexToBytes } from '../../../../source/utils/slhDsa/hex.ts';
import type {
  SlhDsaExecutionHost,
  SlhDsaLeafLane,
} from '../../../../source/wallet/slhDsaExecution.ts';

export interface NativeSlhKey {
  destroy(): void;
}
export interface NativeSlhTree {
  release(erase: boolean): Promise<void>;
}
export interface NativeSlhOperation<T> {
  cancel(): void;
  run(): Promise<T>;
}
export interface NativeSlhContext {
  isRetired(): boolean;
  close(): void;
  dispose(): Promise<void>;
  importSlhKeyHex(value: string): NativeSlhKey;
  importSlhSeedHex(value: string): NativeSlhKey;
  allocateTree(): NativeSlhOperation<NativeSlhTree>;
  loadTree(keyId: string): NativeSlhOperation<NativeSlhTree | null>;
  publishTree(tree: NativeSlhTree, keyId: string): NativeSlhOperation<void>;
  readTreeRoot(tree: NativeSlhTree): NativeSlhOperation<string>;
  writeTreeLeaves(
    tree: NativeSlhTree,
    start: number,
    value: string
  ): NativeSlhOperation<void>;
  treeChunk(
    key: NativeSlhKey,
    tree: NativeSlhTree,
    level: number,
    start: number,
    count: number
  ): NativeSlhOperation<number>;
  leafChunk(
    key: NativeSlhKey,
    start: number,
    count: number
  ): NativeSlhOperation<string>;
  prelude(
    key: NativeSlhKey,
    message: string,
    optrand: string
  ): NativeSlhOperation<string>;
  fors(
    key: NativeSlhKey,
    prelude: string,
    index: number
  ): NativeSlhOperation<string>;
  finish(
    key: NativeSlhKey,
    message: string,
    prelude: string,
    fors: string,
    roots: string,
    tree: NativeSlhTree
  ): NativeSlhOperation<string>;
  cached(
    key: NativeSlhKey,
    message: string,
    optrand: string,
    tree: NativeSlhTree
  ): NativeSlhOperation<string>;
  prepareVerify(
    publicKey: string,
    rawAction: string,
    signature: string
  ): NativeSlhOperation<boolean>;
}
export interface NativeSlhExecutionModule {
  createSlhContext(namespace: string): NativeSlhContext;
  prepareSlhCachePurge(namespace: string): NativeSlhOperation<void>;
}
export type NativeSlhExecutionOptions = Readonly<{
  namespace: string;
  signal: AbortSignal;
  assertCurrent(): void;
  randomFill(bytes: Uint8Array): void;
  yield(): Promise<void>;
}>;
export type OwnedNativeSlhExecution = Readonly<{
  host: SlhDsaExecutionHost<NativeSlhTree, NativeSlhKey>;
  verify(
    publicKey: Uint8Array,
    rawAction: Uint8Array,
    signature: Uint8Array
  ): Promise<boolean>;
  retire(): Promise<void>;
  isRetired(): boolean;
}>;

const TREE_BYTES = 134_217_712,
  LEAVES = 4_194_304,
  CHUNK = 8192;
const failure = () => new Error('SLH_NATIVE_EXECUTION_UNAVAILABLE');
const integer = (value: number, low: number, high: number) => {
  if (!Number.isSafeInteger(value) || value < low || value > high)
    throw failure();
};
const keyId = (value: string) => {
  if (
    typeof value !== 'string' ||
    !/^SLH-DSA-SHA2-128-24:0x[0-9a-f]{32}0{32}:0x[0-9a-f]{32}0{32}$/.test(value)
  )
    throw failure();
};
const encode = (value: Uint8Array, length: number): string => {
  if (!(value instanceof Uint8Array) || value.length !== length)
    throw failure();
  // Fixed hex avoids Expo's unsafe generic typed-array offset conversion.
  // Owned mutable copies are erased; immutable bridge strings remain GC-owned.
  const owned = new Uint8Array(value);
  try {
    return bytesToHex(owned);
  } finally {
    owned.fill(0);
  }
};
const decode = (value: string, length: number): Uint8Array => {
  if (
    typeof value !== 'string' ||
    value.length !== 2 + 2 * length ||
    !/^0x[0-9a-f]+$/.test(value)
  )
    throw failure();
  return hexToBytes(value);
};
const messageHex = (value: Uint8Array) => {
  const result = encode(value, 34);
  if (!result.startsWith('0x0000')) throw failure();
  return result;
};

/** Dedicated wallet-session capability; never disposes the bootstrap WebCrypto provider. */
export function createNativeSlhExecution(
  module: NativeSlhExecutionModule,
  options: NativeSlhExecutionOptions
): OwnedNativeSlhExecution {
  const owner = Object.freeze({ ...options });
  if (
    !/^0x[0-9a-f]{64}$/.test(owner.namespace) ||
    typeof module?.createSlhContext !== 'function' ||
    typeof owner.randomFill !== 'function' ||
    typeof owner.yield !== 'function' ||
    typeof owner.signal?.addEventListener !== 'function' ||
    typeof owner.signal.removeEventListener !== 'function'
  )
    throw failure();
  let retired = false,
    retirement: Promise<void> | undefined;
  const check = () => {
    assertSynchronousEvmFeeGuard(owner.assertCurrent);
    if (retired || owner.signal.aborted) throw failure();
  };
  check();
  const context = module.createSlhContext(owner.namespace);
  const operations = new Set<NativeSlhOperation<unknown>>();
  const pending = new Set<Promise<unknown>>();
  const keys = new WeakSet<NativeSlhKey>(),
    trees = new WeakSet<NativeSlhTree>();
  const ownedKey = (key: NativeSlhKey) => {
    check();
    if (!keys.has(key)) throw failure();
  };
  const ownedTree = (tree: NativeSlhTree) => {
    check();
    if (!trees.has(tree)) throw failure();
  };
  const run = async <T>(prepare: () => NativeSlhOperation<T>): Promise<T> => {
    check();
    let operation: NativeSlhOperation<T>;
    try {
      operation = prepare();
    } catch {
      check();
      throw failure();
    }
    operations.add(operation);
    const work = Promise.resolve().then(async () => {
      check();
      const result = await operation.run();
      check();
      return result;
    });
    pending.add(work);
    try {
      return await work;
    } catch {
      check();
      throw failure();
    } finally {
      pending.delete(work);
      operations.delete(operation);
    }
  };
  const runTree = <T extends NativeSlhTree | null>(
    prepare: () => NativeSlhOperation<T>
  ): Promise<T> => {
    const work = (async () => {
      let produced: T | undefined;
      try {
        return await run(() => {
          const operation = prepare();
          return {
            cancel: () => operation.cancel(),
            async run() {
              produced = await operation.run();
              return produced;
            },
          };
        });
      } catch (error) {
        // Expo may already have registered this handle before our final wallet
        // guard rejects it. Retirement must not depend on the wrapper's GC.
        if (produced) await produced.release(false);
        throw error;
      }
    })();
    pending.add(work);
    return work.finally(() => {
      pending.delete(work);
    });
  };
  const retire = (): Promise<void> => {
    if (retirement) return retirement;
    retired = true;
    owner.signal.removeEventListener('abort', abort);
    let closeFailed = false;
    try {
      context.close();
    } catch {
      closeFailed = true;
    }
    for (const operation of operations) {
      try {
        operation.cancel();
      } catch {
        closeFailed = true;
      }
    }
    retirement = (async () => {
      await Promise.allSettled([...pending]);
      try {
        await context.dispose();
      } catch {
        throw failure();
      }
      if (closeFailed) throw failure();
    })();
    return retirement;
  };
  const abort = () => {
    void retire().catch(() => undefined);
  };
  owner.signal.addEventListener('abort', abort, { once: true });
  try {
    check();
  } catch (error) {
    void retire().catch(() => undefined);
    throw error;
  }
  const importSeed = (seed: Uint8Array) => {
    check();
    const key = context.importSlhSeedHex(encode(seed, 48));
    keys.add(key);
    check();
    return key;
  };
  const releaseKey = (key: NativeSlhKey) => {
    if (!keys.has(key)) throw failure();
    keys.delete(key);
    key.destroy();
  };
  const host: SlhDsaExecutionHost<NativeSlhTree, NativeSlhKey> = {
    // The native engine owns one serialized execution slot, independently of CPU count.
    hardwareConcurrency: 1,
    forsConcurrency: 1,
    importKey(secret) {
      check();
      const key = context.importSlhKeyHex(encode(secret, 64));
      keys.add(key);
      check();
      return key;
    },
    releaseKey,
    async allocateTree() {
      const tree = await runTree(() => context.allocateTree());
      trees.add(tree);
      return tree;
    },
    async loadTree(id) {
      keyId(id);
      const tree = await runTree(() => context.loadTree(id));
      if (!tree) return null;
      trees.add(tree);
      return { keyId: id, bytes: TREE_BYTES, tree };
    },
    saveTree(treeId, tree) {
      keyId(treeId);
      ownedTree(tree);
      return run(() => context.publishTree(tree, treeId));
    },
    async releaseTree(tree, erase) {
      if (!trees.has(tree) || typeof erase !== 'boolean') throw failure();
      trees.delete(tree);
      await tree.release(erase);
    },
    async readTree(tree, offset, length) {
      ownedTree(tree);
      if (offset !== TREE_BYTES - 16 || length !== 16) throw failure();
      return decode(await run(() => context.readTreeRoot(tree)), 16);
    },
    writeTree(tree, offset, bytes) {
      ownedTree(tree);
      integer(bytes.length, 16, CHUNK * 16);
      integer(offset, 0, LEAVES * 16 - bytes.length);
      if (offset % 16 || bytes.length % 16) throw failure();
      const value = encode(bytes, bytes.length);
      return run(() => context.writeTreeLeaves(tree, offset / 16, value));
    },
    openSetup(seed) {
      const key = importSeed(seed);
      let closed = false;
      return {
        async buildChunk(tree, level, start, count) {
          if (closed) throw failure();
          ownedKey(key);
          ownedTree(tree);
          integer(level, 0, 22);
          integer(count, 1, 16384);
          integer(start, 0, (LEAVES >> level) - count);
          for (let offset = 0; offset < count; offset += CHUNK) {
            const size = Math.min(CHUNK, count - offset);
            const result = await run(() =>
              context.treeChunk(key, tree, level, start + offset, size)
            );
            if (result !== size) throw failure();
          }
          return count;
        },
        dispose() {
          if (!closed) {
            closed = true;
            releaseKey(key);
          }
        },
      };
    },
    createLeafLanes(count): SlhDsaLeafLane[] {
      check();
      integer(count, 1, 1);
      return Array.from({ length: count }, () => {
        let key: NativeSlhKey | undefined,
          identity: string | undefined,
          closed = false;
        const active = new Set<Promise<unknown>>();
        return {
          async buildLeaves(seed, start, size) {
            check();
            if (closed) throw failure();
            integer(size, 1, CHUNK);
            integer(start, 0, LEAVES - size);
            const current = encode(seed, 48);
            if (!key) {
              key = importSeed(seed);
              identity = current;
            }
            if (current !== identity) throw failure();
            const owned = key;
            const work = run(() => context.leafChunk(owned, start, size));
            active.add(work);
            try {
              return {
                start,
                count: size,
                leaves: decode(await work, size * 16),
              };
            } finally {
              active.delete(work);
            }
          },
          async dispose() {
            closed = true;
            await Promise.allSettled([...active]);
            if (key) {
              releaseKey(key);
              key = undefined;
            }
          },
        };
      });
    },
    async signPrelude(key, message, optrand) {
      ownedKey(key);
      const text = messageHex(message),
        random = encode(optrand, 16);
      return decode(await run(() => context.prelude(key, text, random)), 46);
    },
    async signForsTree(key, prelude, index) {
      ownedKey(key);
      integer(index, 0, 5);
      const text = encode(prelude, 46);
      return {
        treeIndex: index,
        shard: decode(await run(() => context.fors(key, text, index)), 416),
      };
    },
    async finishSignature(key, message, prelude, fors, roots, tree) {
      ownedKey(key);
      ownedTree(tree);
      const text = messageHex(message),
        prefix = encode(prelude, 46),
        signature = encode(fors, 2400),
        publicRoots = encode(roots, 96);
      return decode(
        await run(() =>
          context.finish(key, text, prefix, signature, publicRoots, tree)
        ),
        3856
      );
    },
    async signCached(key, message, optrand, tree) {
      ownedKey(key);
      ownedTree(tree);
      const text = messageHex(message),
        random = encode(optrand, 16);
      return decode(
        await run(() => context.cached(key, text, random, tree)),
        3856
      );
    },
    randomFill(bytes) {
      check();
      assertSynchronousEvmFeeGuard(() => owner.randomFill(bytes));
      check();
    },
    async yield() {
      check();
      await owner.yield();
      check();
    },
  };
  return Object.freeze({
    host: Object.freeze(host),
    retire,
    isRetired() {
      return retired || context.isRetired();
    },
    async verify(
      publicKey: Uint8Array,
      rawAction: Uint8Array,
      signature: Uint8Array
    ) {
      const key = encode(publicKey, 32),
        action = encode(rawAction, 32),
        text = encode(signature, 3856);
      const result = await run(() => context.prepareVerify(key, action, text));
      if (typeof result !== 'boolean') throw failure();
      return result;
    },
  });
}

/** Called only by the confirmed, retired-owner removal callback, never its preview. */
export async function purgeNativeSlhPublicCache(
  module: NativeSlhExecutionModule,
  namespace: string,
  assertCleanupCurrent: () => void
): Promise<void> {
  assertSynchronousEvmFeeGuard(assertCleanupCurrent);
  if (
    !/^0x[0-9a-f]{64}$/.test(namespace) ||
    typeof module?.prepareSlhCachePurge !== 'function'
  )
    throw failure();
  const operation = module.prepareSlhCachePurge(namespace);
  try {
    assertSynchronousEvmFeeGuard(assertCleanupCurrent);
    await operation.run();
    assertSynchronousEvmFeeGuard(assertCleanupCurrent);
  } catch {
    operation.cancel();
    assertSynchronousEvmFeeGuard(assertCleanupCurrent);
    throw failure();
  }
}
