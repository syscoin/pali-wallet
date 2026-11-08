import { webcrypto } from 'crypto';

import {
  loadPrivacyProvingKey,
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
