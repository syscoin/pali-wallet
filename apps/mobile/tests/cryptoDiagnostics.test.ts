import assert from 'node:assert/strict';
import test from 'node:test';
import { createWalletCrypto } from '../src/crypto/provider.ts';
import type { NativeCryptoModule } from '../src/crypto/provider.ts';
import { qualifyWalletCrypto } from '../src/crypto/qualification.ts';
import { isCryptoDiagnostic } from '../src/crypto/diagnostics.ts';

test('crypto diagnostics accept only public operation labels and no error payload', () => {
  assert(isCryptoDiagnostic({ bootstrap: 'provider-info' }));
  assert(isCryptoDiagnostic({ bootstrap: 'ready', fullCase: 'backup-eight-mib-boundary' }));
  for (const value of [null, {}, [], { bootstrap: 'raw native error' }, { bootstrap: 'ready', error: 'secret' }, { bootstrap: 'ready', fullCase: 'input-dependent label' }])
    assert.equal(isCryptoDiagnostic(value), false);
});

test('provider registration and first primitive failure retain a fixed checkpoint', async () => {
  let checkpoint = '';
  assert.throws(() => createWalletCrypto({ info() { throw Error('sensitive native detail'); } } as unknown as NativeCryptoModule, (step) => { checkpoint = step; }), /NativeCryptoError/);
  assert.equal(checkpoint, 'provider-info');
  const provider = { subtle: { async digest() { throw Error('sensitive native detail'); } } } as unknown as Crypto;
  await assert.rejects(qualifyWalletCrypto(provider, (step) => { checkpoint = step; }));
  assert.equal(checkpoint, 'self-test-sha256');
  assert(!JSON.stringify({ checkpoint }).includes('sensitive'));
});
