import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSentryClassicalExecutor } from '../src/crypto/sentryClassicalExecutor.ts';
import { qualifyNativeSentryClassical } from '../qualification/native-sentry-classical.ts';

test('the qualification adapter uses shared classical vectors and retires an outstanding result', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  const crypto = globalThis.crypto;
  let blindingCalls = 0;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues<T extends ArrayBufferView>(bytes: T): T {
        const result = crypto.getRandomValues(bytes);
        if (result.byteLength === 16) blindingCalls++;
        return result;
      },
    },
  });
  const lifetime = new AbortController();
  try {
    const { deriveSentryClassicalPublicKey } = await import('@sidhujag/sysweb3-sentry/classical-public-key');
    const derive = await qualifyNativeSentryClassical(
      lifetime.signal,
      () => blindingCalls,
      createSentryClassicalExecutor(deriveSentryClassicalPublicKey)
    );
    const secret = new Uint8Array(32);
    secret[31] = 1;
    await assert.rejects(
      derive('owner', 'bls-basic', secret, lifetime.signal),
      {
        message: 'SENTRY_CLASSICAL_VALIDATION_FAILED',
      }
    );
    const pending = derive('operator', 'bls-basic', secret, lifetime.signal);
    secret.fill(0);
    lifetime.abort();
    await assert.rejects(pending, { message: 'CANCELLED' });
  } finally {
    lifetime.abort();
    Object.defineProperty(globalThis, 'crypto', descriptor);
  }
});
