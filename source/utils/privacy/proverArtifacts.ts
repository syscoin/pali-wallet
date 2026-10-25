import type { IPrivacyProofProgress } from './proverTypes';

export const PRIVACY_PROVING_KEY_URL =
  'https://raw.githubusercontent.com/tornadocash/tornado-cli/378ddf8b8b92a4924037d7b64a94dbfd5a7dd6e8/build/circuits/tornadoProvingKey.bin';
export const PRIVACY_PROVING_KEY_BYTES = 14522256;
export const PRIVACY_PROVING_KEY_SHA256 =
  '8e2d2f22beafb5a9666daebca57b13f8029c3656c65fcfbcc86e2418fa16a3af';
const ASSET_ROOT = 'assets/privacy-prover/';
const PINS = {
  metadata: {
    file: 'metadata.json.gz',
    bytes: 310560,
    sha256: '346d3a157a5c3abd8970c520f692837426392a04b2a13ac2d7634151d36814d5',
  },
  wasm: {
    file: 'groth16.wasm',
    bytes: 30173,
    sha256: 'a79df53990e4a18d44062d60560e50f3c0961d84ee9bc06f9545fc4fe6a079ea',
  },
};
const failure = () => new Error('privacy_proof_artifact_invalid');
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error('privacy_proof_cancelled');
};

export async function verifyPrivacyArtifact(
  bytes: ArrayBuffer,
  length: number,
  hash: string
): Promise<void> {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== length)
    throw failure();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  if (
    Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    ) !== hash
  )
    throw failure();
}

async function readBytes(
  response: Response,
  limit: number,
  signal?: AbortSignal,
  progress?: (completed: number) => void
): Promise<ArrayBuffer> {
  if (!response.ok || !response.body) throw failure();
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body.cancel().catch(() => undefined);
    throw failure();
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let count = 0;
  let lastPercent = -1;
  try {
    for (;;) {
      checkAbort(signal);
      const part = await reader.read();
      if (part.done) break;
      count += part.value.byteLength;
      if (count > limit) throw failure();
      chunks.push(part.value);
      const percent = Math.floor((count / limit) * 100);
      if (percent > lastPercent) {
        lastPercent = percent;
        progress?.(count);
      }
    }
    checkAbort(signal);
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes.buffer;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export interface IProverArtifactCache {
  get: () => Promise<ArrayBuffer | undefined>;
  put: (bytes: ArrayBuffer) => Promise<void>;
}
const artifactCache: IProverArtifactCache = {
  get: () => cacheTransaction('readonly'),
  put: async (bytes) => {
    await cacheTransaction('readwrite', bytes);
  },
};
function cacheTransaction(
  mode: IDBTransactionMode,
  bytes?: ArrayBuffer
): Promise<ArrayBuffer | undefined> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('pali-privacy-prover-v1', 1);
    opening.onupgradeneeded = () =>
      opening.result.createObjectStore('artifacts');
    opening.onerror = () => reject(failure());
    opening.onblocked = () => reject(failure());
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('artifacts', mode);
      const store = tx.objectStore('artifacts');
      let value: ArrayBuffer | undefined;
      const request = bytes
        ? store.put(bytes, PRIVACY_PROVING_KEY_SHA256)
        : store.get(PRIVACY_PROVING_KEY_SHA256);
      request.onsuccess = () => {
        if (!bytes) value = request.result;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(value);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(failure());
      };
    };
  });
}

export async function loadPrivacyProvingKey(
  options: {
    cache?: IProverArtifactCache;
    fetcher?: typeof fetch;
    onProgress?: (progress: IPrivacyProofProgress) => void;
    signal?: AbortSignal;
  } = {}
): Promise<ArrayBuffer> {
  const { signal, onProgress } = options;
  const cache = options.cache || artifactCache;
  checkAbort(signal);
  try {
    const saved = await cache.get();
    checkAbort(signal);
    if (saved) {
      await verifyPrivacyArtifact(
        saved,
        PRIVACY_PROVING_KEY_BYTES,
        PRIVACY_PROVING_KEY_SHA256
      );
      checkAbort(signal);
      return saved;
    }
  } catch {
    checkAbort(signal);
  }
  const response = await (options.fetcher || fetch)(PRIVACY_PROVING_KEY_URL, {
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
  const bytes = await readBytes(
    response,
    PRIVACY_PROVING_KEY_BYTES,
    signal,
    (completed) =>
      onProgress?.({
        stage: 'artifacts',
        completed,
        total: PRIVACY_PROVING_KEY_BYTES,
      })
  );
  await verifyPrivacyArtifact(
    bytes,
    PRIVACY_PROVING_KEY_BYTES,
    PRIVACY_PROVING_KEY_SHA256
  );
  checkAbort(signal);
  // Public artifact caching is an optimization; a quota failure must not invalidate verified bytes.
  await cache.put(bytes).catch(() => undefined);
  checkAbort(signal);
  return bytes;
}

export async function loadPrivacyWitnessAssets(): Promise<{
  metadata: any;
  wasmCode: Uint8Array;
}> {
  const load = async (pin: typeof PINS.metadata) => {
    const response = await fetch(
      new URL(ASSET_ROOT + pin.file, `${self.location.origin}/`).href,
      { credentials: 'omit', redirect: 'error' }
    );
    const bytes = await readBytes(response, pin.bytes);
    await verifyPrivacyArtifact(bytes, pin.bytes, pin.sha256);
    return bytes;
  };
  const [compressed, wasm] = await Promise.all([
    load(PINS.metadata),
    load(PINS.wasm),
  ]);
  if (typeof DecompressionStream !== 'function') throw failure();
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const decoded = await readBytes(new Response(stream), 4582626);
  if (decoded.byteLength !== 4582626) throw failure();
  let metadata: any;
  try {
    metadata = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(decoded)
    );
  } catch {
    throw failure();
  }
  if (
    metadata.nVars !== 28300 ||
    metadata.nSignals !== 36528 ||
    metadata.nPubInputs !== 6 ||
    metadata.nOutputs !== 0
  )
    throw failure();
  return { metadata, wasmCode: new Uint8Array(wasm) };
}
