import {
  getSLHDSAKeyId,
  SLH_DSA_FORS_ROOTS_LENGTH,
  SLH_DSA_FORS_SIGNATURE_LENGTH,
  SLH_DSA_FORS_TREE_COUNT,
  SLH_DSA_FORS_TREE_OUTPUT_LENGTH,
  SLH_DSA_FORS_TREE_SIGNATURE_LENGTH,
  SLH_DSA_PUBLIC_KEY_FIELD_LENGTH,
  SLH_DSA_SECRET_KEY_LENGTH,
  SLH_DSA_SIGNATURE_LENGTH,
  SLH_DSA_SIGNING_PRELUDE_LENGTH,
  SLH_DSA_XMSS_TREE_CACHE_LENGTH,
} from '../utils/slhDsa/constants.ts';
import { deriveSLHDSASeedMaterial } from '../utils/slhDsa/derivation.ts';
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  normalizeSLHDSAPublicKeyField,
} from '../utils/slhDsa/hex.ts';

type Result<T> = T | Promise<T>;
type Check = () => void;
type Progress = Readonly<{
  completed: number;
  level: number;
  phase: 'xmss-cache';
  total: number;
}>;
type TreeRecord<Tree> = Readonly<{ bytes: number; keyId: string; tree: Tree }>;
export type SlhDsaLeafLane = Readonly<{
  buildLeaves(
    seed48: Uint8Array,
    start: number,
    count: number
  ): Promise<{
    count: number;
    leaves: Uint8Array;
    start: number;
  }>;
  dispose(): Result<void>;
}>;

/** Primitives operate on owned handles; neither a browser heap nor a native file is policy. */
export type SlhDsaExecutionHost<Tree, Key> = Readonly<{
  allocateTree(): Result<Tree>;
  createLeafLanes(count: number): readonly SlhDsaLeafLane[];
  finishSignature(
    key: Key,
    message: Uint8Array,
    prelude: Uint8Array,
    signature: Uint8Array,
    roots: Uint8Array,
    tree: Tree
  ): Result<Uint8Array>;
  forsConcurrency: number;
  importKey(secretKey: Uint8Array): Result<Key>;
  leafConcurrency: number;
  loadTree(keyId: string): Promise<TreeRecord<Tree> | null>;
  openSetup(seed48: Uint8Array): Result<
    Readonly<{
      buildChunk(
        tree: Tree,
        level: number,
        start: number,
        count: number
      ): Result<number>;
      dispose(): Result<void>;
    }>
  >;
  randomFill(bytes: Uint8Array): void;
  readTree(tree: Tree, offset: number, length: number): Result<Uint8Array>;
  releaseKey(key: Key): Result<void>;
  releaseTree(tree: Tree, erase: boolean): Result<void>;
  saveTree(keyId: string, tree: Tree): Promise<void>;
  signCached(
    key: Key,
    message: Uint8Array,
    optrand: Uint8Array,
    tree: Tree
  ): Result<Uint8Array>;
  signForsTree(
    key: Key,
    prelude: Uint8Array,
    treeIndex: number
  ): Promise<{
    shard: Uint8Array;
    treeIndex: number;
  }>;
  // Message is exactly 00 00 || actionHash (34 bytes), never a second raw-hash API.
  signPrelude(
    key: Key,
    message: Uint8Array,
    optrand: Uint8Array
  ): Result<Uint8Array>;
  writeTree(tree: Tree, offset: number, bytes: Uint8Array): Result<void>;
  yield(): Promise<void>;
}>;

const HEIGHT = 22;
const TOTAL_NODES = (1 << (HEIGHT + 1)) - 1;
const ROOT_OFFSET = (TOTAL_NODES - 1) * SLH_DSA_PUBLIC_KEY_FIELD_LENGTH;
const LEAF_CHUNK = 512;
const PARALLEL_LEAF_CHUNK = 8_192;
const INTERNAL_CHUNK = 16_384;

const checked = (check: Check) => {
  const result: unknown = check();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    throw new Error('SLH-DSA execution is no longer current');
  }
};
const publicFields = (key: Uint8Array) => {
  if (key.length !== SLH_DSA_SECRET_KEY_LENGTH)
    throw new Error('SLH-DSA provisioned secret key has invalid length');
  return {
    pkRoot: normalizeSLHDSAPublicKeyField(bytesToHex(key.subarray(48, 64))),
    pkSeed: normalizeSLHDSAPublicKeyField(bytesToHex(key.subarray(32, 48))),
  };
};
const drain = async (operations: Promise<void>[]) => {
  const outcomes = await Promise.allSettled(operations);
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
};

/** The existing offscreen queue owns serialization; native callers must supply the same ownership. */
export const createSlhDsaExecution = <Tree, Key>(
  ports: SlhDsaExecutionHost<Tree, Key>
) => {
  const host = Object.freeze({ ...ports });
  for (const name of [
    'allocateTree',
    'releaseTree',
    'readTree',
    'writeTree',
    'loadTree',
    'saveTree',
    'openSetup',
    'createLeafLanes',
    'importKey',
    'releaseKey',
    'signPrelude',
    'signForsTree',
    'finishSignature',
    'signCached',
    'randomFill',
    'yield',
  ] as const) {
    if (typeof host[name] !== 'function')
      throw new Error(`SLH-DSA primitive is required: ${name}`);
  }
  if (
    !Number.isInteger(host.leafConcurrency) ||
    host.leafConcurrency < 1 ||
    host.leafConcurrency > 6 ||
    !Number.isInteger(host.forsConcurrency) ||
    host.forsConcurrency < 1 ||
    host.forsConcurrency > SLH_DSA_FORS_TREE_COUNT
  )
    throw new Error('SLH-DSA execution lane count is invalid');
  let activeTree: TreeRecord<Tree> | null = null;
  let busy = false;
  const run = async <T>(check: Check, operation: () => Promise<T>) => {
    checked(check);
    if (busy) throw new Error('SLH-DSA execution is busy');
    busy = true;
    try {
      const result = await operation();
      checked(check);
      return result;
    } finally {
      busy = false;
    }
  };
  const releaseActive = async (erase: boolean) => {
    const previous = activeTree;
    activeTree = null;
    if (previous) await host.releaseTree(previous.tree, erase);
  };
  const ensureTree = async (keyId: string, check: Check) => {
    checked(check);
    if (activeTree?.keyId === keyId) return activeTree.tree;
    await releaseActive(false);
    checked(check);
    const stored = await host.loadTree(keyId);
    let adopted = false;
    try {
      checked(check);
      if (
        !stored ||
        stored.bytes !== SLH_DSA_XMSS_TREE_CACHE_LENGTH ||
        stored.keyId !== keyId
      )
        throw new Error(
          'SLH-DSA XMSS cache is missing. Re-run PQ validator setup so signing stays on the fast cached path.'
        );
      activeTree = { ...stored };
      adopted = true;
      return stored.tree;
    } finally {
      if (stored && !adopted) await host.releaseTree(stored.tree, false);
    }
  };

  const prepareKeypair = (
    setupSecretHex: string,
    check: Check,
    progress: (value: Progress) => void
  ) =>
    run(check, async () => {
      const { seed48Hex } = await deriveSLHDSASeedMaterial(setupSecretHex);
      const seed48 = hexToBytes(seed48Hex);
      let tree: Tree | undefined;
      let allocated = false;
      let retained = false;
      let setup: Awaited<ReturnType<typeof host.openSetup>> | undefined;
      let secretKey: Uint8Array | undefined;
      const report = (completed: number, level: number) => {
        checked(check);
        checked(() =>
          progress({
            completed,
            level,
            phase: 'xmss-cache',
            total: TOTAL_NODES,
          })
        );
      };
      try {
        checked(check);
        setup = await host.openSetup(seed48);
        checked(check);
        tree = await host.allocateTree();
        allocated = true;
        checked(check);
        const handle = tree;
        let completed = 0;
        const leafCount = 1 << HEIGHT;
        const workerCount = host.leafConcurrency;
        if (workerCount > 1) {
          const lanes = host.createLeafLanes(workerCount);
          if (lanes.length !== workerCount) {
            await drain(
              lanes.map(async (lane) => {
                await lane.dispose();
              })
            );
            throw new Error('SLH-DSA XMSS execution lane count differs');
          }
          let nextStart = 0;
          let stopped = false;
          try {
            await drain(
              lanes.map(async (lane) => {
                try {
                  while (!stopped && nextStart < leafCount) {
                    checked(check);
                    const start = nextStart;
                    const count = Math.min(
                      PARALLEL_LEAF_CHUNK,
                      leafCount - start
                    );
                    nextStart += count;
                    const result = await lane.buildLeaves(seed48, start, count);
                    try {
                      checked(check);
                      if (result.count !== count || result.start !== start)
                        throw new Error(
                          'SLH-DSA XMSS worker returned an unexpected leaf range'
                        );
                      if (
                        result.leaves.length !==
                        count * SLH_DSA_PUBLIC_KEY_FIELD_LENGTH
                      )
                        throw new Error(
                          'SLH-DSA XMSS worker returned invalid leaf data'
                        );
                      await host.writeTree(
                        handle,
                        start * SLH_DSA_PUBLIC_KEY_FIELD_LENGTH,
                        result.leaves
                      );
                      checked(check);
                      completed += count;
                      report(completed, 0);
                    } finally {
                      result.leaves.fill(0);
                    }
                  }
                } catch (error) {
                  stopped = true;
                  throw error;
                }
              })
            );
          } finally {
            await drain(
              lanes.map(async (lane) => {
                await lane.dispose();
              })
            );
          }
        } else {
          for (let start = 0; start < leafCount; start += LEAF_CHUNK) {
            checked(check);
            const count = Math.min(LEAF_CHUNK, leafCount - start);
            const result = await setup.buildChunk(handle, 0, start, count);
            checked(check);
            if (result !== count)
              throw new Error(
                `SLH-DSA XMSS cache build failed with code ${result}`
              );
            completed += count;
            if (start % (LEAF_CHUNK * 8) === 0) {
              report(completed, 0);
              await host.yield();
              checked(check);
            }
          }
        }
        for (let level = 1; level <= HEIGHT; level++) {
          const nodes = 1 << (HEIGHT - level);
          for (let start = 0; start < nodes; start += INTERNAL_CHUNK) {
            checked(check);
            const count = Math.min(INTERNAL_CHUNK, nodes - start);
            const result = await setup.buildChunk(handle, level, start, count);
            checked(check);
            if (result !== count)
              throw new Error(
                `SLH-DSA XMSS cache build failed with code ${result}`
              );
            completed += count;
            report(completed, level);
            await host.yield();
            checked(check);
          }
        }
        const root = await host.readTree(
          handle,
          ROOT_OFFSET,
          SLH_DSA_PUBLIC_KEY_FIELD_LENGTH
        );
        checked(check);
        if (root.length !== SLH_DSA_PUBLIC_KEY_FIELD_LENGTH)
          throw new Error('SLH-DSA XMSS root has invalid length');
        const fields = {
          pkRoot: normalizeSLHDSAPublicKeyField(bytesToHex(root)),
          pkSeed: normalizeSLHDSAPublicKeyField(
            bytesToHex(seed48.subarray(32, 48))
          ),
        };
        secretKey = concatBytes(
          seed48.subarray(0, 32),
          seed48.subarray(32, 48),
          root
        );
        const keyId = getSLHDSAKeyId(fields);
        await host.saveTree(keyId, handle);
        checked(check);
        await releaseActive(false);
        checked(check);
        activeTree = {
          bytes: SLH_DSA_XMSS_TREE_CACHE_LENGTH,
          keyId,
          tree: handle,
        };
        retained = true;
        report(TOTAL_NODES, HEIGHT);
        return { ...fields, secretKeyHex: bytesToHex(secretKey) };
      } finally {
        secretKey?.fill(0);
        seed48.fill(0);
        try {
          if (setup) await setup.dispose();
        } finally {
          if (allocated && !retained)
            await host.releaseTree(tree as Tree, false);
        }
      }
    });

  const signActionHash = (
    request: Readonly<{
      actionHash: string;
      keyId: string;
      pkRoot: string;
      pkSeed: string;
      secretKeyHex?: string;
    }>,
    check: Check
  ) =>
    run(check, async () => {
      const payload = { ...request };
      const actionHash = hexToBytes(payload.actionHash);
      if (actionHash.length !== 32)
        throw new Error('SLH-DSA action hash must be 32 bytes');
      const message = concatBytes(new Uint8Array([0, 0]), actionHash);
      const optrand = new Uint8Array(16);
      const secretKey = hexToBytes(payload.secretKeyHex || '');
      let key: Key | undefined;
      let imported = false;
      let signature: Uint8Array | undefined;
      try {
        checked(() => host.randomFill(optrand));
        if (!payload.secretKeyHex)
          throw new Error(
            'SLH-DSA signing requires provisioned local key material'
          );
        const fields = publicFields(secretKey);
        if (
          fields.pkSeed !== normalizeSLHDSAPublicKeyField(payload.pkSeed) ||
          fields.pkRoot !== normalizeSLHDSAPublicKeyField(payload.pkRoot)
        )
          throw new Error(
            'SLH-DSA provisioned secret key does not match validator metadata'
          );
        if (payload.keyId !== getSLHDSAKeyId(fields))
          throw new Error(
            'SLH-DSA XMSS key identifier does not match validator metadata'
          );
        checked(check);
        key = await host.importKey(secretKey);
        imported = true;
        secretKey.fill(0);
        checked(check);
        const handle = key;
        const tree = await ensureTree(payload.keyId, check);
        const root = await host.readTree(
          tree,
          ROOT_OFFSET,
          SLH_DSA_PUBLIC_KEY_FIELD_LENGTH
        );
        checked(check);
        if (
          root.length !== SLH_DSA_PUBLIC_KEY_FIELD_LENGTH ||
          normalizeSLHDSAPublicKeyField(bytesToHex(root)) !== fields.pkRoot
        ) {
          await releaseActive(false);
          checked(check);
          throw new Error(
            'SLH-DSA XMSS cache does not match validator metadata'
          );
        }
        let prelude: Uint8Array | undefined;
        const forsSignature = new Uint8Array(SLH_DSA_FORS_SIGNATURE_LENGTH);
        const roots = new Uint8Array(SLH_DSA_FORS_ROOTS_LENGTH);
        try {
          try {
            checked(check);
            prelude = await host.signPrelude(handle, message, optrand);
            checked(check);
            if (prelude.length !== SLH_DSA_SIGNING_PRELUDE_LENGTH)
              throw new Error(
                'SLH-DSA signing prelude returned invalid length'
              );
            const prefix = prelude;
            let nextIndex = 0;
            let stopped = false;
            await drain(
              Array.from({ length: host.forsConcurrency }, async () => {
                try {
                  while (!stopped && nextIndex < SLH_DSA_FORS_TREE_COUNT) {
                    checked(check);
                    const index = nextIndex++;
                    const result = await host.signForsTree(
                      handle,
                      prefix,
                      index
                    );
                    try {
                      checked(check);
                      if (result.treeIndex !== index)
                        throw new Error(
                          'SLH-DSA FORS shard returned an unexpected tree index'
                        );
                      if (
                        result.shard.length !== SLH_DSA_FORS_TREE_OUTPUT_LENGTH
                      )
                        throw new Error(
                          'SLH-DSA FORS shard returned invalid length'
                        );
                      forsSignature.set(
                        result.shard.subarray(
                          0,
                          SLH_DSA_FORS_TREE_SIGNATURE_LENGTH
                        ),
                        index * SLH_DSA_FORS_TREE_SIGNATURE_LENGTH
                      );
                      roots.set(
                        result.shard.subarray(
                          SLH_DSA_FORS_TREE_SIGNATURE_LENGTH
                        ),
                        index * SLH_DSA_PUBLIC_KEY_FIELD_LENGTH
                      );
                    } finally {
                      result.shard.fill(0);
                    }
                  }
                } catch (error) {
                  stopped = true;
                  throw error;
                }
              })
            );
            checked(check);
            signature = await host.finishSignature(
              handle,
              message,
              prefix,
              forsSignature,
              roots,
              tree
            );
            checked(check);
            if (signature.length !== SLH_DSA_SIGNATURE_LENGTH)
              throw new Error(
                'SLH-DSA signature assembly returned invalid length'
              );
          } catch {
            checked(check);
            signature?.fill(0);
            signature = await host.signCached(handle, message, optrand, tree);
            checked(check);
            if (signature.length !== SLH_DSA_SIGNATURE_LENGTH)
              throw new Error(
                'SLH-DSA cached signature returned invalid length'
              );
          }
        } finally {
          prelude?.fill(0);
          forsSignature.fill(0);
          roots.fill(0);
        }
        return { ...fields, signature: bytesToHex(signature) };
      } finally {
        signature?.fill(0);
        secretKey.fill(0);
        message.fill(0);
        optrand.fill(0);
        if (imported) {
          await host.releaseKey(key as Key);
          checked(check);
        }
      }
    });

  const clearXmssCache = (check: Check) =>
    run(check, async () => {
      await releaseActive(true);
      checked(check);
    });
  return Object.freeze({ prepareKeypair, signActionHash, clearXmssCache });
};
