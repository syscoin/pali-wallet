import assert from 'node:assert/strict';
import test from 'node:test';
import { sentryKeyValidationBusy, isSentryKeyValidationBusy } from '../src/core/sentryKeyValidation.ts';
import { createSentryPublicKeyDeriver } from '../src/crypto/sentryPublicKeyExecutor.ts';
import { createNativeSentryKeyManagement } from '../src/custody/sentryKeyManagement.ts';
import type { ISentryKeyStore } from '../../../source/wallet/sentryKeyVault.ts';

test('busy classification uses only the issued error identity', () => {
  const busy = sentryKeyValidationBusy();
  assert.equal(isSentryKeyValidationBusy(busy), true);
  assert.equal(isSentryKeyValidationBusy({ code: 'BUSY', message: 'BUSY' }), false);
  assert.equal(isSentryKeyValidationBusy(new Proxy({}, { get() { assert.fail('getter called'); } })), false);
});

test('a busy import remains retryable without discarding or rewriting an existing saved key', async () => {
  const saved: ISentryKeyStore = { version: 1, vaultId: 'ab'.repeat(32), network: 'mainnet', keys: [{
    iv: 'fixture', ciphertext: 'untouched fixture', summary: {
      id: '00000000-0000-0000-0000-000000000001', label: 'Saved key', network: 'mainnet',
      role: 'operator', scheme: 'slh-dsa-shake-128s', publicKey: '11'.repeat(32),
    },
  }] };
  const original = JSON.stringify(saved);
  let writes = 0, attempts = 0;
  const derivePublicKey = createSentryPublicKeyDeriver(async () => async () => {
    if (++attempts === 1) throw sentryKeyValidationBusy();
    return '22'.repeat(32);
  });
  const manager = createNativeSentryKeyManagement({
    assertCurrent() {},
    async authenticate() { assert.fail('a failed preparation must not request signing access'); },
    derivePublicKey, lifetime: new AbortController().signal, network: 'mainnet',
    async readSeed() { assert.fail('a failed preparation must not read the wallet seed'); },
    run: async operation => operation(), vaultId: saved.vaultId,
    vaultHost: {
      crypto() { throw Error('No encryption or decryption expected'); },
      async read() { return saved; },
      async write() { writes++; assert.fail('preparation must not mutate saved keys'); },
    },
    async readSettings() { return undefined; }, async writeSettings() { assert.fail('unexpected settings mutation'); },
  });
  try {
    await assert.rejects(manager.prepareImport('Imported key|' + '23'.repeat(64), 'operator', 'slh-dsa-shake-128s'),
      error => error instanceof Error && 'code' in error && error.code === 'BUSY' && 'issues' in error && Array.isArray(error.issues) && error.issues.length === 0);
    assert.equal(writes, 0); assert.equal(JSON.stringify(saved), original);
    const review = await manager.prepareImport('Imported key|' + '23'.repeat(64), 'operator', 'slh-dsa-shake-128s');
    assert.equal(review.keys[0]?.publicKey, '22'.repeat(32));
    assert.equal(writes, 0); assert.equal(JSON.stringify(saved), original);
    assert.equal((await manager.list())[0]?.label, 'Saved key');
  } finally { manager.dispose(); }
});
