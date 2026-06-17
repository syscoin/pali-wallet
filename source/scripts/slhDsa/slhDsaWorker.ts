import {
  SLH_DSA_FORS_ROOTS_LENGTH,
  SLH_DSA_FORS_SIGNATURE_LENGTH,
  SLH_DSA_FORS_TREE_COUNT,
  SLH_DSA_FORS_TREE_OUTPUT_LENGTH,
  SLH_DSA_FORS_TREE_SIGNATURE_LENGTH,
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_PUBLIC_KEY_FIELD_LENGTH,
  SLH_DSA_SECRET_KEY_LENGTH,
  SLH_DSA_SIGNING_PRELUDE_LENGTH,
  SLH_DSA_SIGNATURE_LENGTH,
  SLH_DSA_WASM_ASSET_PATH,
  SLH_DSA_WASM_GLUE_ASSET_PATH,
  SLH_DSA_XMSS_TREE_CACHE_LENGTH,
} from 'utils/slhDsa/constants';
import { deriveSLHDSASeedMaterial } from 'utils/slhDsa/derivation';
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  normalizeSLHDSAPublicKeyField,
} from 'utils/slhDsa/hex';
import type {
  SLHDSAWorkerRequest,
  SLHDSAWorkerResponse,
} from 'utils/slhDsa/types';

declare const importScripts: (...urls: string[]) => void;

type WasmSignerExports = {
  HEAPU8: Uint8Array;
  _free: (ptr: number) => void;
  _malloc: (size: number) => number;
  _slh_dsa_build_xmss_tree_chunk: (
    seed48Ptr: number,
    outTreePtr: number,
    level: number,
    start: number,
    count: number
  ) => number;
  _slh_dsa_finish_signature_with_fors_and_xmss_tree: (
    secretKeyPtr: number,
    preludePtr: number,
    forsSigPtr: number,
    forsRootsPtr: number,
    xmssTreePtr: number,
    out3856Ptr: number
  ) => number;
  _slh_dsa_sign_action_hash_with_sk_and_xmss_tree: (
    secretKeyPtr: number,
    messagePtr: number,
    messageLen: number,
    optrandPtr: number,
    xmssTreePtr: number,
    out3856Ptr: number
  ) => number;
  _slh_dsa_sign_prelude: (
    secretKeyPtr: number,
    messagePtr: number,
    messageLen: number,
    optrandPtr: number,
    outPreludePtr: number
  ) => number;
};

type ForsWorkerResponse =
  | {
      id: string;
      result: {
        shardHex: string;
        treeIndex: number;
      };
      type: 'success';
    }
  | {
      error: string;
      id: string;
      type: 'error';
    };

type ForsWorkerResult = Extract<
  ForsWorkerResponse,
  { type: 'success' }
>['result'];

type XmssWorkerResponse =
  | {
      id: string;
      result: {
        count: number;
        leaves: ArrayBuffer;
        start: number;
      };
      type: 'success';
    }
  | {
      error: string;
      id: string;
      type: 'error';
    };

type XmssWorkerResult = Extract<
  XmssWorkerResponse,
  { type: 'success' }
>['result'];

let signerPromise: Promise<WasmSignerExports> | null = null;

const XMSS_TREE_DB_NAME = 'pali-slh-dsa-xmss-tree-cache';
const XMSS_TREE_DB_VERSION = 1;
const XMSS_TREE_STORE_NAME = 'trees';
const SLH_DSA_XMSS_FULL_HEIGHT = 22;
const SLH_DSA_XMSS_ROOT_OFFSET =
  ((1 << (SLH_DSA_XMSS_FULL_HEIGHT + 1)) - 2) * 16;
const SLH_DSA_XMSS_TOTAL_NODES = (1 << (SLH_DSA_XMSS_FULL_HEIGHT + 1)) - 1;
const SLH_DSA_XMSS_LEAF_CHUNK_SIZE = 512;
const SLH_DSA_XMSS_PARALLEL_LEAF_CHUNK_SIZE = 8_192;
const SLH_DSA_XMSS_MAX_SETUP_WORKERS = 6;
const SLH_DSA_XMSS_INTERNAL_CHUNK_SIZE = 16_384;

let activeXmssTreePointer: {
  bytes: number;
  keyId: string;
  ptr: number;
} | null = null;

const getExtensionAssetUrl = (path: string) =>
  new URL(path, `${self.location.origin}/`).toString();

const loadSigner = async (): Promise<WasmSignerExports> => {
  if (!signerPromise) {
    signerPromise = (async () => {
      const glueUrl = getExtensionAssetUrl(SLH_DSA_WASM_GLUE_ASSET_PATH);
      try {
        importScripts(glueUrl);
      } catch (error: any) {
        throw new Error(
          `SLH-DSA WASM signer glue is missing at ${SLH_DSA_WASM_GLUE_ASSET_PATH}: ${
            error?.message || error
          }`
        );
      }

      const factory = (self as any).SlhDsaModule;
      if (typeof factory !== 'function') {
        throw new Error('SLH-DSA WASM signer factory was not registered');
      }

      const signer = await factory({
        locateFile: (path: string) =>
          path.endsWith('.wasm')
            ? getExtensionAssetUrl(SLH_DSA_WASM_ASSET_PATH)
            : getExtensionAssetUrl(`assets/slh-dsa/${path}`),
        print: () => undefined,
        printErr: () => undefined,
      });
      if (!signer?.HEAPU8) {
        throw new Error('SLH-DSA WASM signer did not expose HEAPU8');
      }
      return signer;
    })();
  }
  return signerPromise;
};

const openXmssTreeDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(XMSS_TREE_DB_NAME, XMSS_TREE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(XMSS_TREE_STORE_NAME)) {
        db.createObjectStore(XMSS_TREE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const getStoredXmssTree = async (keyId: string): Promise<Uint8Array | null> => {
  if (typeof indexedDB === 'undefined') {
    return null;
  }
  const db = await openXmssTreeDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(XMSS_TREE_STORE_NAME, 'readonly');
      const request = tx.objectStore(XMSS_TREE_STORE_NAME).get(keyId);
      request.onsuccess = () => {
        const result = request.result;
        if (result instanceof ArrayBuffer) {
          resolve(new Uint8Array(result));
          return;
        }
        if (ArrayBuffer.isView(result)) {
          resolve(new Uint8Array(result.buffer));
          return;
        }
        resolve(null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
};

const setStoredXmssTree = async (keyId: string, tree: Uint8Array) => {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  const db = await openXmssTreeDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(XMSS_TREE_STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(XMSS_TREE_STORE_NAME).put(tree.slice().buffer, keyId);
    });
  } finally {
    db.close();
  }
};

const callWithBytes = <T>(
  signer: WasmSignerExports,
  inputs: Uint8Array[],
  outputLength: number,
  callback: (ptrs: number[], outPtr: number) => T
) => {
  const allocations: Array<{ length: number; ptr: number }> = [];
  const outPtr = signer._malloc(outputLength);
  try {
    inputs.forEach((input) => {
      const ptr = signer._malloc(input.length);
      signer.HEAPU8.set(input, ptr);
      allocations.push({ length: input.length, ptr });
    });
    const result = callback(
      allocations.map((allocation) => allocation.ptr),
      outPtr
    );
    const output = signer.HEAPU8.slice(outPtr, outPtr + outputLength);
    return { output, result };
  } finally {
    allocations.forEach(({ length, ptr }) => {
      signer.HEAPU8.fill(0, ptr, ptr + length);
      signer._free(ptr);
    });
    signer.HEAPU8.fill(0, outPtr, outPtr + outputLength);
    signer._free(outPtr);
  }
};

const postForsShardRequest = ({
  forsContext,
  prelude,
  treeIndex,
}: {
  forsContext: Uint8Array;
  prelude: Uint8Array;
  treeIndex: number;
}) =>
  new Promise<ForsWorkerResult>((resolve, reject) => {
    const worker = new Worker(
      new URL('./slhDsaForsWorker.ts', import.meta.url)
    );
    const id = crypto.randomUUID();
    let settled = false;
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
    };
    const onError = (event: ErrorEvent) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(event.message));
    };
    const onMessage = (event: MessageEvent<ForsWorkerResponse>) => {
      if (event.data.id !== id) {
        return;
      }
      settled = true;
      cleanup();
      if (event.data.type === 'error') {
        reject(new Error(event.data.error));
        return;
      }
      resolve(event.data.result);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError, { once: true });
    const preludeCopy = prelude.slice();
    const forsContextCopy = forsContext.slice();
    worker.postMessage(
      {
        id,
        payload: {
          forsContext: forsContextCopy.buffer,
          prelude: preludeCopy.buffer,
          treeIndex,
        },
      },
      [forsContextCopy.buffer, preludeCopy.buffer]
    );
  });

const getSetupWorkerCount = () => {
  const hardwareConcurrency =
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1;
  return Math.max(
    1,
    Math.min(
      SLH_DSA_XMSS_MAX_SETUP_WORKERS,
      Math.max(1, hardwareConcurrency - 1)
    )
  );
};

const postXmssLeafRequest = ({
  count,
  seed48,
  start,
  worker,
}: {
  count: number;
  seed48: Uint8Array;
  start: number;
  worker: Worker;
}) =>
  new Promise<XmssWorkerResult>((resolve, reject) => {
    const id = crypto.randomUUID();
    const onError = (event: ErrorEvent) => {
      worker.removeEventListener('message', onMessage);
      reject(new Error(event.message));
    };
    const onMessage = (event: MessageEvent<XmssWorkerResponse>) => {
      if (event.data.id !== id) {
        return;
      }
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      if (event.data.type === 'error') {
        reject(new Error(event.data.error));
        return;
      }
      resolve(event.data.result);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError, { once: true });
    const seedCopy = seed48.slice();
    worker.postMessage(
      {
        id,
        payload: {
          count,
          seed48: seedCopy.buffer,
          start,
        },
      },
      [seedCopy.buffer]
    );
  });

const signWithCachedXmss = ({
  message,
  optrand,
  secretKey,
  signer,
  xmssTreePtr,
}: {
  message: Uint8Array;
  optrand: Uint8Array;
  secretKey: Uint8Array;
  signer: WasmSignerExports;
  xmssTreePtr: number;
}) => {
  const { output, result } = callWithBytes(
    signer,
    [secretKey, message, optrand],
    SLH_DSA_SIGNATURE_LENGTH,
    ([secretKeyPtr, messagePtr, optrandPtr], outPtr) =>
      signer._slh_dsa_sign_action_hash_with_sk_and_xmss_tree(
        secretKeyPtr,
        messagePtr,
        message.length,
        optrandPtr,
        xmssTreePtr,
        outPtr
      )
  );
  if (result !== SLH_DSA_SIGNATURE_LENGTH) {
    throw new Error(`SLH-DSA signing failed with code ${result}`);
  }
  return output;
};

const signWithParallelFors = async ({
  message,
  optrand,
  secretKey,
  signer,
  xmssTreePtr,
}: {
  message: Uint8Array;
  optrand: Uint8Array;
  secretKey: Uint8Array;
  signer: WasmSignerExports;
  xmssTreePtr: number;
}) => {
  const { output: prelude, result: preludeResult } = callWithBytes(
    signer,
    [secretKey, message, optrand],
    SLH_DSA_SIGNING_PRELUDE_LENGTH,
    ([secretKeyPtr, messagePtr, optrandPtr], outPtr) =>
      signer._slh_dsa_sign_prelude(
        secretKeyPtr,
        messagePtr,
        message.length,
        optrandPtr,
        outPtr
      )
  );
  if (preludeResult !== SLH_DSA_SIGNING_PRELUDE_LENGTH) {
    throw new Error(
      `SLH-DSA signing prelude failed with code ${preludeResult}`
    );
  }

  const forsContext = concatBytes(
    secretKey.slice(0, 16),
    secretKey.slice(32, 48)
  );
  const forsSignature = new Uint8Array(SLH_DSA_FORS_SIGNATURE_LENGTH);
  const forsRoots = new Uint8Array(SLH_DSA_FORS_ROOTS_LENGTH);
  try {
    const shards = await Promise.all(
      Array.from({ length: SLH_DSA_FORS_TREE_COUNT }, (_, treeIndex) =>
        postForsShardRequest({ forsContext, prelude, treeIndex })
      )
    );
    shards.sort((a, b) => a.treeIndex - b.treeIndex);

    shards.forEach((shard) => {
      const bytes = hexToBytes(shard.shardHex);
      if (bytes.length !== SLH_DSA_FORS_TREE_OUTPUT_LENGTH) {
        throw new Error('SLH-DSA FORS shard returned invalid length');
      }
      forsSignature.set(
        bytes.slice(0, SLH_DSA_FORS_TREE_SIGNATURE_LENGTH),
        shard.treeIndex * SLH_DSA_FORS_TREE_SIGNATURE_LENGTH
      );
      forsRoots.set(
        bytes.slice(SLH_DSA_FORS_TREE_SIGNATURE_LENGTH),
        shard.treeIndex * 16
      );
      bytes.fill(0);
    });

    const { output, result } = callWithBytes(
      signer,
      [secretKey, prelude, forsSignature, forsRoots],
      SLH_DSA_SIGNATURE_LENGTH,
      ([secretKeyPtr, preludePtr, forsSignaturePtr, forsRootsPtr], outPtr) =>
        signer._slh_dsa_finish_signature_with_fors_and_xmss_tree(
          secretKeyPtr,
          preludePtr,
          forsSignaturePtr,
          forsRootsPtr,
          xmssTreePtr,
          outPtr
        )
    );
    if (result !== SLH_DSA_SIGNATURE_LENGTH) {
      throw new Error(`SLH-DSA signature assembly failed with code ${result}`);
    }

    return output;
  } finally {
    prelude.fill(0);
    forsContext.fill(0);
    forsSignature.fill(0);
    forsRoots.fill(0);
  }
};

const postProgress = (
  id: string,
  result: Extract<SLHDSAWorkerResponse, { type: 'progress' }>['result']
) => {
  self.postMessage({
    id,
    result,
    type: 'progress',
  } satisfies SLHDSAWorkerResponse);
};

const buildPreparedKeypair = async (
  signer: WasmSignerExports,
  requestId: string,
  setupSecretHex: string
) => {
  const { seed48Hex } = await deriveSLHDSASeedMaterial(setupSecretHex);
  const seed48 = hexToBytes(seed48Hex);
  const seedPtr = signer._malloc(seed48.length);
  const treePtr = signer._malloc(SLH_DSA_XMSS_TREE_CACHE_LENGTH);
  let completed = 0;
  try {
    signer.HEAPU8.set(seed48, seedPtr);

    const leafCount = 1 << SLH_DSA_XMSS_FULL_HEIGHT;
    const workerCount = getSetupWorkerCount();
    if (workerCount > 1) {
      const workers = Array.from(
        { length: workerCount },
        () => new Worker(new URL('./slhDsaXmssWorker.ts', import.meta.url))
      );
      let nextStart = 0;

      const runWorker = async (worker: Worker) => {
        while (nextStart < leafCount) {
          const start = nextStart;
          const count = Math.min(
            SLH_DSA_XMSS_PARALLEL_LEAF_CHUNK_SIZE,
            leafCount - start
          );
          nextStart += count;

          const result = await postXmssLeafRequest({
            count,
            seed48,
            start,
            worker,
          });
          if (result.count !== count || result.start !== start) {
            throw new Error(
              'SLH-DSA XMSS worker returned an unexpected leaf range'
            );
          }
          const leaves = new Uint8Array(result.leaves);
          if (leaves.length !== count * SLH_DSA_PUBLIC_KEY_FIELD_LENGTH) {
            throw new Error('SLH-DSA XMSS worker returned invalid leaf data');
          }
          signer.HEAPU8.set(
            leaves,
            treePtr + start * SLH_DSA_PUBLIC_KEY_FIELD_LENGTH
          );
          completed += count;
          postProgress(requestId, {
            completed,
            level: 0,
            phase: 'xmss-cache',
            total: SLH_DSA_XMSS_TOTAL_NODES,
          });
        }
      };

      try {
        await Promise.all(workers.map((worker) => runWorker(worker)));
      } finally {
        workers.forEach((worker) => worker.terminate());
      }
    } else {
      for (
        let start = 0;
        start < leafCount;
        start += SLH_DSA_XMSS_LEAF_CHUNK_SIZE
      ) {
        const count = Math.min(SLH_DSA_XMSS_LEAF_CHUNK_SIZE, leafCount - start);
        const result = signer._slh_dsa_build_xmss_tree_chunk(
          seedPtr,
          treePtr,
          0,
          start,
          count
        );
        if (result !== count) {
          throw new Error(
            `SLH-DSA XMSS cache build failed with code ${result}`
          );
        }
        completed += count;
        if (start % (SLH_DSA_XMSS_LEAF_CHUNK_SIZE * 8) === 0) {
          postProgress(requestId, {
            completed,
            level: 0,
            phase: 'xmss-cache',
            total: SLH_DSA_XMSS_TOTAL_NODES,
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }

    for (let level = 1; level <= SLH_DSA_XMSS_FULL_HEIGHT; level++) {
      const levelNodes = 1 << (SLH_DSA_XMSS_FULL_HEIGHT - level);

      for (
        let start = 0;
        start < levelNodes;
        start += SLH_DSA_XMSS_INTERNAL_CHUNK_SIZE
      ) {
        const count = Math.min(
          SLH_DSA_XMSS_INTERNAL_CHUNK_SIZE,
          levelNodes - start
        );
        const result = signer._slh_dsa_build_xmss_tree_chunk(
          seedPtr,
          treePtr,
          level,
          start,
          count
        );
        if (result !== count) {
          throw new Error(
            `SLH-DSA XMSS cache build failed with code ${result}`
          );
        }
        completed += count;

        postProgress(requestId, {
          completed,
          level,
          phase: 'xmss-cache',
          total: SLH_DSA_XMSS_TOTAL_NODES,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const pkRootBytes = signer.HEAPU8.slice(
      treePtr + SLH_DSA_XMSS_ROOT_OFFSET,
      treePtr + SLH_DSA_XMSS_ROOT_OFFSET + 16
    );
    const pkSeedBytes = seed48.slice(32, 48);
    const pkRoot = normalizeSLHDSAPublicKeyField(bytesToHex(pkRootBytes));
    const pkSeed = normalizeSLHDSAPublicKeyField(bytesToHex(pkSeedBytes));
    const secretKey = concatBytes(
      seed48.slice(0, 16),
      seed48.slice(16, 32),
      pkSeedBytes,
      pkRootBytes
    );
    const keyId = `${SLH_DSA_PARAMETER_SET}:${pkSeed}:${pkRoot}`;

    const tree = signer.HEAPU8.slice(
      treePtr,
      treePtr + SLH_DSA_XMSS_TREE_CACHE_LENGTH
    );
    await setStoredXmssTree(keyId, tree);

    if (activeXmssTreePointer) {
      signer._free(activeXmssTreePointer.ptr);
    }
    activeXmssTreePointer = {
      bytes: SLH_DSA_XMSS_TREE_CACHE_LENGTH,
      keyId,
      ptr: treePtr,
    };

    postProgress(requestId, {
      completed: SLH_DSA_XMSS_TOTAL_NODES,
      level: SLH_DSA_XMSS_FULL_HEIGHT,
      phase: 'xmss-cache',
      total: SLH_DSA_XMSS_TOTAL_NODES,
    });

    const secretKeyHex = bytesToHex(secretKey);
    secretKey.fill(0);

    return {
      pkRoot,
      pkSeed,
      secretKeyHex,
    };
  } catch (error) {
    signer._free(treePtr);
    throw error;
  } finally {
    signer.HEAPU8.fill(0, seedPtr, seedPtr + seed48.length);
    signer._free(seedPtr);
    seed48.fill(0);
  }
};

const publicFieldsFromSecretKey = (secretKey: Uint8Array) => {
  if (secretKey.length !== SLH_DSA_SECRET_KEY_LENGTH) {
    throw new Error('SLH-DSA provisioned secret key has invalid length');
  }

  return {
    pkRoot: normalizeSLHDSAPublicKeyField(bytesToHex(secretKey.slice(48, 64))),
    pkSeed: normalizeSLHDSAPublicKeyField(bytesToHex(secretKey.slice(32, 48))),
  };
};

const ensureXmssTreePointer = async (
  signer: WasmSignerExports,
  keyId: string
) => {
  if (activeXmssTreePointer?.keyId === keyId) {
    return activeXmssTreePointer;
  }

  if (activeXmssTreePointer) {
    signer._free(activeXmssTreePointer.ptr);
    activeXmssTreePointer = null;
  }

  const storedTree = await getStoredXmssTree(keyId);
  if (storedTree?.length === SLH_DSA_XMSS_TREE_CACHE_LENGTH) {
    const ptr = signer._malloc(SLH_DSA_XMSS_TREE_CACHE_LENGTH);
    signer.HEAPU8.set(storedTree, ptr);
    activeXmssTreePointer = {
      bytes: SLH_DSA_XMSS_TREE_CACHE_LENGTH,
      keyId,
      ptr,
    };
    return activeXmssTreePointer;
  }

  throw new Error(
    'SLH-DSA XMSS cache is missing. Re-run PQ validator setup so signing stays on the fast cached path.'
  );
};

const clearActiveXmssTreePointer = async (signer: WasmSignerExports) => {
  if (!activeXmssTreePointer) {
    return;
  }

  signer.HEAPU8.fill(
    0,
    activeXmssTreePointer.ptr,
    activeXmssTreePointer.ptr + activeXmssTreePointer.bytes
  );
  signer._free(activeXmssTreePointer.ptr);
  activeXmssTreePointer = null;
};

const signActionHash = async (
  signer: WasmSignerExports,
  payload: Extract<SLHDSAWorkerRequest, { type: 'sign_action_hash' }>['payload']
) => {
  const message = concatBytes(
    new Uint8Array([0, 0]),
    hexToBytes(payload.actionHash)
  );
  const optrand = crypto.getRandomValues(new Uint8Array(16));

  if (payload.secretKeyHex) {
    const secretKey = hexToBytes(payload.secretKeyHex);
    try {
      const publicFields = publicFieldsFromSecretKey(secretKey);
      if (
        publicFields.pkSeed.toLowerCase() !==
          normalizeSLHDSAPublicKeyField(payload.pkSeed).toLowerCase() ||
        publicFields.pkRoot.toLowerCase() !==
          normalizeSLHDSAPublicKeyField(payload.pkRoot).toLowerCase()
      ) {
        throw new Error(
          'SLH-DSA provisioned secret key does not match validator metadata'
        );
      }

      const xmssTree = await ensureXmssTreePointer(signer, payload.keyId);
      let signature: Uint8Array;
      try {
        signature = await signWithParallelFors({
          message,
          optrand,
          secretKey,
          signer,
          xmssTreePtr: xmssTree.ptr,
        });
      } catch (error) {
        signature = signWithCachedXmss({
          message,
          optrand,
          secretKey,
          signer,
          xmssTreePtr: xmssTree.ptr,
        });
      }

      return {
        ...publicFields,
        signature: bytesToHex(signature),
      };
    } finally {
      secretKey.fill(0);
    }
  }

  throw new Error('SLH-DSA signing requires provisioned local key material');
};

const handleRequest = async (
  request: SLHDSAWorkerRequest
): Promise<SLHDSAWorkerResponse> => {
  try {
    const signer = await loadSigner();
    if (request.type === 'prepare_keypair') {
      const result = await buildPreparedKeypair(
        signer,
        request.id,
        request.payload.setupSecretHex
      );
      return { id: request.id, result, type: 'success' };
    }
    if (request.type === 'clear_xmss_cache') {
      await clearActiveXmssTreePointer(signer);
      return { id: request.id, result: {}, type: 'success' };
    }

    const result = await signActionHash(signer, request.payload);
    return {
      id: request.id,
      result,
      type: 'success',
    };
  } catch (error: any) {
    return {
      error: error?.message || String(error),
      id: request.id,
      type: 'error',
    };
  }
};

self.onmessage = async (event: MessageEvent<SLHDSAWorkerRequest>) => {
  const response = await handleRequest(event.data);
  self.postMessage(response);
};
