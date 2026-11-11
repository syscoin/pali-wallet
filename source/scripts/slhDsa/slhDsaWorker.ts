import {
  createSlhDsaExecution,
  type SlhDsaExecutionHost,
} from '../../wallet/slhDsaExecution';
import {
  SLH_DSA_SIGNATURE_LENGTH,
  SLH_DSA_SIGNING_PRELUDE_LENGTH,
  SLH_DSA_WASM_ASSET_PATH,
  SLH_DSA_WASM_GLUE_ASSET_PATH,
  SLH_DSA_XMSS_TREE_CACHE_LENGTH,
} from 'utils/slhDsa/constants';
import { concatBytes, hexToBytes } from 'utils/slhDsa/hex';
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

type TreeHandle = { bytes: number; ptr: number };
const checkedOutput = (
  value: { output: Uint8Array; result: number },
  length: number,
  label: string
) => {
  if (value.result !== length) {
    value.output.fill(0);
    throw new Error(`SLH-DSA ${label} failed with code ${value.result}`);
  }
  return value.output;
};

const createExecution = (signer: WasmSignerExports) => {
  const host: SlhDsaExecutionHost<TreeHandle, Uint8Array> = {
    leafConcurrency: Math.min(
      6,
      Math.max(
        1,
        (typeof navigator !== 'undefined'
          ? navigator.hardwareConcurrency || 1
          : 1) - 1
      )
    ),
    forsConcurrency: 6,
    allocateTree: () => ({
      ptr: signer._malloc(SLH_DSA_XMSS_TREE_CACHE_LENGTH),
      bytes: SLH_DSA_XMSS_TREE_CACHE_LENGTH,
    }),
    releaseTree(tree, erase) {
      if (erase) signer.HEAPU8.fill(0, tree.ptr, tree.ptr + tree.bytes);
      signer._free(tree.ptr);
    },
    readTree: (tree, offset, length) =>
      signer.HEAPU8.slice(tree.ptr + offset, tree.ptr + offset + length),
    writeTree: (tree, offset, bytes) => {
      signer.HEAPU8.set(bytes, tree.ptr + offset);
    },
    async loadTree(keyId) {
      const bytes = await getStoredXmssTree(keyId);
      // Reject a corrupt stored size before allocating/importing a WASM tree.
      if (bytes?.length !== SLH_DSA_XMSS_TREE_CACHE_LENGTH) return null;
      const tree = { ptr: signer._malloc(bytes.length), bytes: bytes.length };
      signer.HEAPU8.set(bytes, tree.ptr);
      return { tree, bytes: tree.bytes, keyId };
    },
    saveTree: (keyId, tree) =>
      setStoredXmssTree(
        keyId,
        signer.HEAPU8.slice(tree.ptr, tree.ptr + tree.bytes)
      ),
    openSetup(seed48) {
      const ptr = signer._malloc(seed48.length);
      signer.HEAPU8.set(seed48, ptr);
      return {
        buildChunk: (tree, level, start, count) =>
          signer._slh_dsa_build_xmss_tree_chunk(
            ptr,
            tree.ptr,
            level,
            start,
            count
          ),
        dispose() {
          signer.HEAPU8.fill(0, ptr, ptr + seed48.length);
          signer._free(ptr);
        },
      };
    },
    createLeafLanes: (count) =>
      Array.from({ length: count }, () => {
        const worker = new Worker(
          new URL('./slhDsaXmssWorker.ts', import.meta.url)
        );
        return {
          async buildLeaves(seed48, start, leafCount) {
            const result = await postXmssLeafRequest({
              seed48,
              start,
              count: leafCount,
              worker,
            });
            return { ...result, leaves: new Uint8Array(result.leaves) };
          },
          dispose: () => worker.terminate(),
        };
      }),
    importKey: (bytes) => bytes.slice(),
    releaseKey: (key) => {
      key.fill(0);
    },
    signPrelude: (key, message, optrand) =>
      checkedOutput(
        callWithBytes(
          signer,
          [key, message, optrand],
          SLH_DSA_SIGNING_PRELUDE_LENGTH,
          ([secretKeyPtr, messagePtr, optrandPtr], outPtr) =>
            signer._slh_dsa_sign_prelude(
              secretKeyPtr,
              messagePtr,
              message.length,
              optrandPtr,
              outPtr
            )
        ),
        SLH_DSA_SIGNING_PRELUDE_LENGTH,
        'signing prelude'
      ),
    async signForsTree(key, prelude, treeIndex) {
      const forsContext = concatBytes(
        key.subarray(0, 16),
        key.subarray(32, 48)
      );
      try {
        const result = await postForsShardRequest({
          forsContext,
          prelude,
          treeIndex,
        });
        return {
          treeIndex: result.treeIndex,
          shard: hexToBytes(result.shardHex),
        };
      } finally {
        forsContext.fill(0);
      }
    },
    finishSignature: (key, _message, prelude, signature, roots, tree) =>
      checkedOutput(
        callWithBytes(
          signer,
          [key, prelude, signature, roots],
          SLH_DSA_SIGNATURE_LENGTH,
          ([secretKeyPtr, preludePtr, forsSigPtr, forsRootsPtr], outPtr) =>
            signer._slh_dsa_finish_signature_with_fors_and_xmss_tree(
              secretKeyPtr,
              preludePtr,
              forsSigPtr,
              forsRootsPtr,
              tree.ptr,
              outPtr
            )
        ),
        SLH_DSA_SIGNATURE_LENGTH,
        'signature assembly'
      ),
    signCached: (key, message, optrand, tree) =>
      checkedOutput(
        callWithBytes(
          signer,
          [key, message, optrand],
          SLH_DSA_SIGNATURE_LENGTH,
          ([secretKeyPtr, messagePtr, optrandPtr], outPtr) =>
            signer._slh_dsa_sign_action_hash_with_sk_and_xmss_tree(
              secretKeyPtr,
              messagePtr,
              message.length,
              optrandPtr,
              tree.ptr,
              outPtr
            )
        ),
        SLH_DSA_SIGNATURE_LENGTH,
        'signing'
      ),
    randomFill: (bytes) => {
      crypto.getRandomValues(bytes);
    },
    yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
  return createSlhDsaExecution(host);
};

let executionPromise: Promise<ReturnType<typeof createExecution>> | null = null;
let requestGeneration = 0;
const handleRequest = async (
  request: SLHDSAWorkerRequest,
  assertCurrent: () => void
): Promise<SLHDSAWorkerResponse> => {
  try {
    if (!executionPromise)
      executionPromise = loadSigner().then(createExecution);
    const execution = await executionPromise;
    assertCurrent();
    if (request.type === 'prepare_keypair') {
      const result = await execution.prepareKeypair(
        request.payload.setupSecretHex,
        assertCurrent,
        (progress) => {
          self.postMessage({
            id: request.id,
            result: progress,
            type: 'progress',
          } satisfies SLHDSAWorkerResponse);
        }
      );
      return { id: request.id, result, type: 'success' };
    }
    if (request.type === 'clear_xmss_cache') {
      await execution.clearXmssCache(assertCurrent);
      return { id: request.id, result: {}, type: 'success' };
    }
    const result = await execution.signActionHash(
      request.payload,
      assertCurrent
    );
    return { id: request.id, result, type: 'success' };
  } catch (error: any) {
    return {
      error: error?.message || String(error),
      id: request.id,
      type: 'error',
    };
  }
};

self.onmessage = async (event: MessageEvent<SLHDSAWorkerRequest>) => {
  const generation = ++requestGeneration;
  const assertCurrent = () => {
    if (generation !== requestGeneration)
      throw new Error('SLH-DSA worker request cancelled');
  };
  const response = await handleRequest(event.data, assertCurrent);
  self.postMessage(response);
};
