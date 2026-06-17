import {
  SLH_DSA_PUBLIC_KEY_FIELD_LENGTH,
  SLH_DSA_WASM_ASSET_PATH,
  SLH_DSA_WASM_GLUE_ASSET_PATH,
} from 'utils/slhDsa/constants';

declare const importScripts: (...urls: string[]) => void;
const workerScope = self as unknown as {
  postMessage: (message: any, transfer: Transferable[]) => void;
};

type XmssWorkerRequest = {
  id: string;
  payload: {
    count: number;
    seed48: ArrayBuffer;
    start: number;
  };
};

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

type WasmSignerExports = {
  HEAPU8: Uint8Array;
  _free: (ptr: number) => void;
  _malloc: (size: number) => number;
  _slh_dsa_build_xmss_leaf_chunk: (
    seed48Ptr: number,
    outLeavesPtr: number,
    start: number,
    count: number
  ) => number;
};

let signerPromise: Promise<WasmSignerExports> | null = null;

const getExtensionAssetUrl = (path: string) =>
  new URL(path, `${self.location.origin}/`).toString();

const loadSigner = async (): Promise<WasmSignerExports> => {
  if (!signerPromise) {
    signerPromise = (async () => {
      importScripts(getExtensionAssetUrl(SLH_DSA_WASM_GLUE_ASSET_PATH));
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

const buildLeafChunk = async (
  payload: XmssWorkerRequest['payload']
): Promise<Extract<XmssWorkerResponse, { type: 'success' }>['result']> => {
  const signer = await loadSigner();
  const seed48 = new Uint8Array(payload.seed48);
  const outLength = payload.count * SLH_DSA_PUBLIC_KEY_FIELD_LENGTH;
  const seedPtr = signer._malloc(seed48.length);
  const outPtr = signer._malloc(outLength);
  try {
    signer.HEAPU8.set(seed48, seedPtr);
    const result = signer._slh_dsa_build_xmss_leaf_chunk(
      seedPtr,
      outPtr,
      payload.start,
      payload.count
    );
    if (result !== payload.count) {
      throw new Error(`SLH-DSA XMSS leaf chunk failed with code ${result}`);
    }

    return {
      count: payload.count,
      leaves: signer.HEAPU8.slice(outPtr, outPtr + outLength).buffer,
      start: payload.start,
    };
  } finally {
    signer.HEAPU8.fill(0, seedPtr, seedPtr + seed48.length);
    signer.HEAPU8.fill(0, outPtr, outPtr + outLength);
    seed48.fill(0);
    signer._free(seedPtr);
    signer._free(outPtr);
  }
};

self.onmessage = async (event: MessageEvent<XmssWorkerRequest>) => {
  const { id, payload } = event.data;
  try {
    const result = await buildLeafChunk(payload);
    workerScope.postMessage(
      { id, result, type: 'success' } satisfies XmssWorkerResponse,
      [result.leaves]
    );
  } catch (error: any) {
    self.postMessage({
      error: error?.message || String(error),
      id,
      type: 'error',
    } satisfies XmssWorkerResponse);
  }
};
