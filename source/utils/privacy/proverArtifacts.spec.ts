import { webcrypto } from 'crypto';
import { readFileSync } from 'fs';
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { gunzipSync } from 'zlib';

import {
  loadPrivacyProvingKey,
  loadPrivacyWitnessAssets,
  type PrivacyArtifactPolicy,
  PRIVACY_PROVING_KEY_URL,
  verifyPrivacyArtifact,
} from './proverArtifacts';
const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
beforeAll(() =>
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
);
afterAll(() => {
  if (original) Object.defineProperty(globalThis, 'crypto', original);
});
it('verifies exact byte length and SHA-256 before use', async () => {
  const bytes = new TextEncoder().encode('abc').buffer;
  await expect(
    verifyPrivacyArtifact(
      bytes,
      3,
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  ).resolves.toBeUndefined();
  await expect(
    verifyPrivacyArtifact(
      bytes,
      4,
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  ).rejects.toThrow('privacy_proof_artifact_invalid');
  await expect(
    verifyPrivacyArtifact(bytes, 3, '00'.repeat(32))
  ).rejects.toThrow('privacy_proof_artifact_invalid');
});
it('does not trust corrupted cached bytes or persist a bad download', async () => {
  const cache = {
    get: jest.fn(async () => new Uint8Array([1]).buffer),
    put: jest.fn(),
  };
  const fetcher = jest.fn(async () => new Response(new Uint8Array([2])));
  await expect(
    loadPrivacyProvingKey({
      policy: 'extension-public',
      cache,
      fetcher: fetcher as any,
    })
  ).rejects.toThrow('privacy_proof_artifact_invalid');
  expect(fetcher).toHaveBeenCalledWith(
    PRIVACY_PROVING_KEY_URL,
    expect.objectContaining({ credentials: 'omit', redirect: 'error' })
  );
  expect(cache.put).not.toHaveBeenCalled();
});
it('cancels an oversized response before reading it', async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel: () => {
        cancelled = true;
      },
    }),
    { headers: { 'content-length': '9999999999' } }
  );
  await expect(
    loadPrivacyProvingKey({
      policy: 'extension-public',
      cache: { get: async () => undefined, put: jest.fn() },
      fetcher: (async () => response) as any,
    })
  ).rejects.toThrow('privacy_proof_artifact_invalid');
  expect(cancelled).toBe(true);
});
it('does not access storage or network for an already-cancelled job', async () => {
  const abort = new AbortController();
  abort.abort();
  const cache = { get: jest.fn(), put: jest.fn() },
    fetcher = jest.fn();
  await expect(
    loadPrivacyProvingKey({
      policy: 'extension-public',
      cache,
      fetcher,
      signal: abort.signal,
    })
  ).rejects.toThrow('privacy_proof_cancelled');
  expect(cache.get).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
it('uses only the local bundled key and ignores IndexedDB on the native policy', async () => {
  const oldSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', {
    configurable: true,
    value: { location: { href: 'pali-private-prover://job/proof-main.js' } },
  });
  const cache = { get: jest.fn(), put: jest.fn() };
  const fetcher = jest.fn(async () => new Response(new Uint8Array([2])));
  try {
    await expect(
      loadPrivacyProvingKey({
        policy: 'bundled',
        cache,
        fetcher: fetcher as any,
      })
    ).rejects.toThrow('privacy_proof_artifact_invalid');
    expect(fetcher).toHaveBeenCalledWith(
      'pali-private-prover://job/assets/privacy-prover/tornadoProvingKey.bin',
      expect.any(Object)
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  } finally {
    if (oldSelf) Object.defineProperty(globalThis, 'self', oldSelf);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});

const witnessAsset = (name: string) =>
  readFileSync(
    path.join(__dirname, '../../scripts/privacyProver/assets', name)
  );

it('native packaging copies canonical pinned bytes under the portable exact filenames', async () => {
  const { copyWitnessArtifacts } = jest.requireActual(
    '../../../scripts/build-native-private-prover.cjs'
  );
  const pins = JSON.parse(witnessAsset('manifest.json').toString()).artifacts;
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-witness-package-'));
  try {
    await copyWitnessArtifacts(directory, pins);
    expect((await readdir(directory)).sort()).toEqual([
      'groth16.wasm',
      'metadata.json.gzip',
    ]);
    const metadata = await readFile(path.join(directory, 'metadata.json.gzip'));
    expect(metadata).toEqual(witnessAsset('metadata.json.gz'));
    expect(await readFile(path.join(directory, 'groth16.wasm'))).toEqual(
      witnessAsset('groth16.wasm')
    );
    await verifyPrivacyArtifact(
      new Uint8Array(metadata).buffer,
      pins.metadata.bytes,
      pins.metadata.sha256
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('native packaging refuses a changed metadata pin before writing an artifact', async () => {
  const { copyWitnessArtifacts } = jest.requireActual(
    '../../../scripts/build-native-private-prover.cjs'
  );
  const pins = JSON.parse(witnessAsset('manifest.json').toString()).artifacts;
  const directory = await mkdtemp(
    path.join(tmpdir(), 'pali-witness-package-refusal-')
  );
  try {
    await expect(
      copyWitnessArtifacts(directory, {
        ...pins,
        metadata: { ...pins.metadata, sha256: '00'.repeat(32) },
      })
    ).rejects.toThrow('Witness artifact pin mismatch');
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each<PrivacyArtifactPolicy>(['extension-public', 'bundled'])(
  'loads exact pinned compressed metadata for the explicit %s policy',
  async (policy) => {
    const oldSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
    const oldFetch = globalThis.fetch;
    const metadataName =
      policy === 'bundled' ? 'metadata.json.gzip' : 'metadata.json.gz';
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: { location: { href: 'https://owned.pali.invalid/proof-main.js' } },
    });
    const fetcher = jest.fn(async (url: RequestInfo | URL) => {
      const name = new URL(String(url)).pathname.split('/').at(-1);
      const bytes =
        name === metadataName
          ? witnessAsset('metadata.json.gz')
          : name === 'groth16.wasm'
          ? witnessAsset(name)
          : null;
      if (!bytes) throw new Error('Unexpected artifact request');
      return new Response(new Uint8Array(bytes));
    });
    globalThis.fetch = fetcher;
    try {
      const result = await loadPrivacyWitnessAssets(policy);
      expect(result.metadata.nVars).toBe(28300);
      expect(result.metadata.nSignals).toBe(36528);
      expect(result.wasmCode).toEqual(
        new Uint8Array(witnessAsset('groth16.wasm'))
      );
      expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
        'https://owned.pali.invalid/assets/privacy-prover/' + metadataName,
        'https://owned.pali.invalid/assets/privacy-prover/groth16.wasm',
      ]);
      for (const [, options] of fetcher.mock.calls as unknown as [
        unknown,
        RequestInit
      ][])
        expect(options).toEqual({ credentials: 'omit', redirect: 'error' });
    } finally {
      globalThis.fetch = oldFetch;
      if (oldSelf) Object.defineProperty(globalThis, 'self', oldSelf);
      else Reflect.deleteProperty(globalThis, 'self');
    }
  }
);

it('requires a known witness policy before any artifact request', async () => {
  const oldFetch = globalThis.fetch,
    fetcher = jest.fn();
  globalThis.fetch = fetcher;
  try {
    for (const policy of [undefined, null, 'other'])
      await expect(
        loadPrivacyWitnessAssets(policy as PrivacyArtifactPolicy)
      ).rejects.toThrow('privacy_proof_artifact_invalid');
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = oldFetch;
  }
});

it.each(['tampered', 'decompressed'] as const)(
  'rejects %s native metadata bytes without an alternate filename request',
  async (fault) => {
    const oldSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
    const oldFetch = globalThis.fetch;
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: { location: { href: 'https://owned.pali.invalid/proof-main.js' } },
    });
    const compressed = witnessAsset('metadata.json.gz');
    const invalid =
      fault === 'decompressed'
        ? gunzipSync(compressed)
        : Buffer.from(compressed);
    if (fault === 'tampered') invalid[0] = invalid[0]! ^ 1;
    const fetcher = jest.fn(
      async (url: RequestInfo | URL) =>
        new Response(
          new Uint8Array(
            String(url).endsWith('metadata.json.gzip')
              ? invalid
              : witnessAsset('groth16.wasm')
          )
        )
    );
    globalThis.fetch = fetcher;
    try {
      await expect(loadPrivacyWitnessAssets('bundled')).rejects.toThrow(
        'privacy_proof_artifact_invalid'
      );
      expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
        'https://owned.pali.invalid/assets/privacy-prover/metadata.json.gzip',
        'https://owned.pali.invalid/assets/privacy-prover/groth16.wasm',
      ]);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldSelf) Object.defineProperty(globalThis, 'self', oldSelf);
      else Reflect.deleteProperty(globalThis, 'self');
    }
  }
);
