import {
  SLH_DSA_FORS_TREE_OUTPUT_LENGTH,
  SLH_DSA_WASM_ASSET_PATH,
  SLH_DSA_WASM_GLUE_ASSET_PATH,
} from 'utils/slhDsa/constants';
import { bytesToHex } from 'utils/slhDsa/hex';

declare const importScripts: (...urls: string[]) => void;

type ForsWorkerRequest = {
  id: string;
  payload: {
    forsContext: ArrayBuffer;
    prelude: ArrayBuffer;
    treeIndex: number;
  };
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

type WasmSignerExports = {
  HEAPU8: Uint8Array;
  _free: (ptr: number) => void;
  _malloc: (size: number) => number;
  _slh_dsa_sign_fors_tree: (
    secretKeyPtr: number,
    preludePtr: number,
    treeIndex: number,
    out416Ptr: number
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

const signForsTree = async (
  payload: ForsWorkerRequest['payload']
): Promise<ForsWorkerResult> => {
  const signer = await loadSigner();
  const forsContext = new Uint8Array(payload.forsContext);
  const prelude = new Uint8Array(payload.prelude);
  const forsContextPtr = signer._malloc(forsContext.length);
  const preludePtr = signer._malloc(prelude.length);
  const outPtr = signer._malloc(SLH_DSA_FORS_TREE_OUTPUT_LENGTH);
  try {
    signer.HEAPU8.set(forsContext, forsContextPtr);
    signer.HEAPU8.set(prelude, preludePtr);
    const result = signer._slh_dsa_sign_fors_tree(
      forsContextPtr,
      preludePtr,
      payload.treeIndex,
      outPtr
    );
    if (result !== SLH_DSA_FORS_TREE_OUTPUT_LENGTH) {
      throw new Error(`SLH-DSA FORS shard failed with code ${result}`);
    }

    return {
      shardHex: bytesToHex(
        signer.HEAPU8.slice(outPtr, outPtr + SLH_DSA_FORS_TREE_OUTPUT_LENGTH)
      ),
      treeIndex: payload.treeIndex,
    };
  } finally {
    signer.HEAPU8.fill(0, forsContextPtr, forsContextPtr + forsContext.length);
    signer.HEAPU8.fill(0, preludePtr, preludePtr + prelude.length);
    signer.HEAPU8.fill(0, outPtr, outPtr + SLH_DSA_FORS_TREE_OUTPUT_LENGTH);
    forsContext.fill(0);
    prelude.fill(0);
    signer._free(forsContextPtr);
    signer._free(preludePtr);
    signer._free(outPtr);
  }
};

self.onmessage = async (event: MessageEvent<ForsWorkerRequest>) => {
  const { id, payload } = event.data;
  try {
    const result = await signForsTree(payload);
    self.postMessage({
      id,
      result,
      type: 'success',
    } satisfies ForsWorkerResponse);
  } catch (error: any) {
    self.postMessage({
      error: error?.message || String(error),
      id,
      type: 'error',
    } satisfies ForsWorkerResponse);
  }
};
