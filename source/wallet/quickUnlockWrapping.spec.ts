import { createCipheriv, hkdfSync, webcrypto } from 'crypto';

import {
  type QuickUnlockScope,
  unwrapQuickUnlockKey,
  wrapQuickUnlockKey,
} from './quickUnlockWrapping';

const crypto = webcrypto as unknown as Crypto;
const current = () => undefined;
const scope: QuickUnlockScope = {
  installationId: 'local:installation-1',
  profileId: `0x${'12'.repeat(32)}`,
  pairFingerprint: '34'.repeat(32),
  enrollmentId: 'local:enrollment-1',
  rpId: 'wallet.example',
  credentialId: new Uint8Array([1, 2, 3]),
  prfSalt: new Uint8Array(32).fill(0x56),
};
const prf = new Uint8Array(32).fill(0x78);
const vaultKey = new Uint8Array(32).fill(0x9a);
const seal = () => wrapQuickUnlockKey(scope, prf, vaultKey, current, crypto);

function provider(
  overrides: Partial<SubtleCrypto>
): Pick<Crypto, 'subtle' | 'getRandomValues'> {
  const subtle = crypto.subtle;
  return {
    getRandomValues: (array) => crypto.getRandomValues(array),
    subtle: {
      importKey: subtle.importKey.bind(subtle),
      deriveKey: subtle.deriveKey.bind(subtle),
      encrypt: subtle.encrypt.bind(subtle),
      decrypt: subtle.decrypt.bind(subtle),
      ...overrides,
    } as SubtleCrypto,
  };
}

it('uses a fresh 12-byte nonce and interoperates with independent HKDF and AES-GCM', async () => {
  const one = await seal(),
    two = await seal();
  expect(one).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{96}$/);
  const [, nonce, encrypted] = one.split(':');
  expect(two.split(':')[1]).not.toBe(nonce);
  const localScope = [
    'org.syscoin.pali.quick-unlock.v1',
    scope.installationId,
    scope.profileId,
    scope.pairFingerprint,
    scope.enrollmentId,
    scope.rpId,
  ];
  const aad = Buffer.from(
    JSON.stringify([...localScope, '010203', '56'.repeat(32)])
  );
  const info = Buffer.from(JSON.stringify(localScope));
  const referenceKey = new Uint8Array(
    hkdfSync('sha256', prf, new Uint8Array(scope.prfSalt), info, 32)
  );
  const cipher = createCipheriv(
    'aes-256-gcm',
    referenceKey,
    Buffer.from(nonce, 'hex')
  );
  cipher.setAAD(aad);
  expect(
    Buffer.concat([
      cipher.update(vaultKey),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('hex')
  ).toBe(encrypted);
  expect(
    await unwrapQuickUnlockKey(scope, prf.buffer, one, current, crypto)
  ).toEqual(vaultKey);
});

it('accepts a 1023-byte credential ID with maximum-size local scope fields', async () => {
  const maximum = {
    ...scope,
    installationId: 'i'.repeat(128),
    profileId: 'p'.repeat(128),
    enrollmentId: 'e'.repeat(128),
    rpId: [63, 63, 63, 61].map((length) => 'a'.repeat(length)).join('.'),
    credentialId: new Uint8Array(1023).fill(0x11),
  };
  const envelope = await wrapQuickUnlockKey(
    maximum,
    prf,
    vaultKey,
    current,
    crypto
  );
  expect(
    await unwrapQuickUnlockKey(maximum, prf, envelope, current, crypto)
  ).toEqual(vaultKey);
});

it('rejects the wrong PRF output and changes to every field of the expected scope', async () => {
  const envelope = await seal();
  await expect(
    unwrapQuickUnlockKey(scope, new Uint8Array(32), envelope, current, crypto)
  ).rejects.toMatchObject({ name: 'OperationError' });
  const changes: Partial<QuickUnlockScope>[] = [
    { installationId: 'other-installation' },
    { profileId: 'other-profile' },
    { pairFingerprint: '01'.repeat(32) },
    { enrollmentId: 'other-enrollment' },
    { rpId: 'other.example' },
    { credentialId: new Uint8Array([1, 2, 4]).buffer },
    { prfSalt: new Uint8Array(32).fill(0x57).buffer },
  ];
  for (const change of changes)
    await expect(
      unwrapQuickUnlockKey(
        { ...scope, ...change },
        prf,
        envelope,
        current,
        crypto
      )
    ).rejects.toMatchObject({ name: 'OperationError' });
});

it('binds the effective Chromium extension RP scope and credential exactly', async () => {
  const extensionId = 'a'.repeat(32);
  const extension = { ...scope, rpId: `chrome-extension://${extensionId}` };
  const envelope = await wrapQuickUnlockKey(
    extension,
    prf,
    vaultKey,
    current,
    crypto
  );
  expect(
    await unwrapQuickUnlockKey(extension, prf, envelope, current, crypto)
  ).toEqual(vaultKey);
  for (const changed of [
    { rpId: `chrome-extension://${'b'.repeat(32)}` },
    { rpId: extensionId },
    { credentialId: new Uint8Array([1, 2, 4]) },
  ]) {
    await expect(
      unwrapQuickUnlockKey(
        { ...extension, ...changed },
        prf,
        envelope,
        current,
        crypto
      )
    ).rejects.toMatchObject({ name: 'OperationError' });
  }
  for (const rpId of [
    `${extension.rpId}/`,
    `${extension.rpId}/app.html`,
    `chrome-extension://${'q'.repeat(32)}`,
  ]) {
    await expect(
      unwrapQuickUnlockKey(
        { ...extension, rpId },
        prf,
        envelope,
        current,
        crypto
      )
    ).rejects.toThrow('Invalid quick unlock wrapping input');
  }
});

it('rejects nonce, ciphertext and tag changes, and refuses malformed input before crypto', async () => {
  const envelope = await seal();
  for (const offset of [3, 28, envelope.length - 1]) {
    const altered =
      envelope.slice(0, offset) +
      (envelope[offset] === '0' ? '1' : '0') +
      envelope.slice(offset + 1);
    await expect(
      unwrapQuickUnlockKey(scope, prf, altered, current, crypto)
    ).rejects.toMatchObject({ name: 'OperationError' });
  }
  const importKey = jest.fn();
  const unavailable = provider({ importKey });
  for (const invalid of [
    null,
    {},
    'v2' + envelope.slice(2),
    envelope + '00',
    envelope.slice(0, -2),
    envelope + '\n',
  ])
    await expect(
      unwrapQuickUnlockKey(scope, prf, invalid, current, unavailable)
    ).rejects.toThrow('Invalid quick unlock wrapping input');
  const accessor = jest.fn(() => 'wallet.example');
  const invalidScopes = [
    { ...scope, credentialId: new Uint8Array(1024) },
    { ...scope, credentialId: new Uint8Array(0) },
    { ...scope, prfSalt: new Uint8Array(31) },
    { ...scope, rpId: 'https://wallet.example' },
    Object.defineProperty({ ...scope }, 'rpId', { get: accessor }),
  ];
  for (const invalid of invalidScopes)
    await expect(
      wrapQuickUnlockKey(invalid, prf, vaultKey, current, unavailable)
    ).rejects.toThrow('Invalid quick unlock wrapping input');
  await expect(
    wrapQuickUnlockKey(
      scope,
      new Uint8Array(33),
      vaultKey,
      current,
      unavailable
    )
  ).rejects.toThrow('Invalid quick unlock wrapping input');
  await expect(
    wrapQuickUnlockKey(scope, prf, new Uint8Array(31), current, unavailable)
  ).rejects.toThrow('Invalid quick unlock wrapping input');
  await expect(
    wrapQuickUnlockKey(
      scope,
      prf,
      vaultKey,
      async () => {
        throw new Error('async guard');
      },
      unavailable
    )
  ).rejects.toThrow('synchronous owner guard');
  expect(accessor).not.toHaveBeenCalled();
  expect(importKey).not.toHaveBeenCalled();
});

it('captures sliced inputs and scope before awaiting, then clears all owned secret bytes', async () => {
  const credential = new Uint8Array([1, 2, 3]);
  const salt = new Uint8Array(scope.prfSalt);
  const mutable = { ...scope, credentialId: credential, prfSalt: salt };
  const prfInput = new Uint8Array(34).fill(0x78);
  const keyInput = new Uint8Array(34).fill(0x9a);
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let capturedPrf: Uint8Array | undefined, capturedKey: Uint8Array | undefined;
  const held = provider({
    importKey: (async (...args: Parameters<SubtleCrypto['importKey']>) => {
      capturedPrf = args[1] as Uint8Array;
      entered.resolve();
      await release.promise;
      return crypto.subtle.importKey(...args);
    }) as SubtleCrypto['importKey'],
    encrypt: async (...args) => {
      capturedKey = args[2] as Uint8Array;
      return crypto.subtle.encrypt(...args);
    },
  });
  const pending = wrapQuickUnlockKey(
    mutable,
    prfInput.subarray(1, 33),
    keyInput.subarray(1, 33),
    current,
    held
  );
  await entered.promise;
  prfInput.fill(0);
  keyInput.fill(0);
  credential.fill(0);
  salt.fill(0);
  mutable.pairFingerprint = 'a0'.repeat(32);
  release.resolve();
  const envelope = await pending;
  expect(
    await unwrapQuickUnlockKey(scope, prf, envelope, current, crypto)
  ).toEqual(vaultKey);
  expect(capturedPrf).toEqual(new Uint8Array(32));
  expect(capturedKey).toEqual(new Uint8Array(32));
  expect(vaultKey).toEqual(new Uint8Array(32).fill(0x9a));
  expect(prf).toEqual(new Uint8Array(32).fill(0x78));
});

it('does not deliver late authenticated plaintext and clears it after owner revocation', async () => {
  const envelope = await seal();
  let active = true;
  const guard = () => {
    if (!active) throw new Error('Owner retired');
  };
  const entered = Promise.withResolvers<ArrayBuffer>(),
    release = Promise.withResolvers<void>();
  const held = provider({
    decrypt: async (...args) => {
      const output = await crypto.subtle.decrypt(...args);
      entered.resolve(output);
      await release.promise;
      return output;
    },
  });
  const pending = unwrapQuickUnlockKey(scope, prf, envelope, guard, held);
  const plaintext = await entered.promise;
  expect(new Uint8Array(plaintext)).toEqual(vaultKey);
  active = false;
  release.resolve();
  await expect(pending).rejects.toThrow('Owner retired');
  expect(new Uint8Array(plaintext)).toEqual(new Uint8Array(32));
});

it('checks owner again before reporting a rejected decrypt', async () => {
  const envelope = await seal();
  let active = true;
  const guard = () => {
    if (!active) throw new Error('Owner retired');
  };
  const entered = Promise.withResolvers<unknown>(),
    release = Promise.withResolvers<void>();
  const held = provider({
    decrypt: (...args) =>
      crypto.subtle.decrypt(...args).catch(async (error: unknown) => {
        entered.resolve(error);
        await release.promise;
        throw error;
      }),
  });
  const pending = unwrapQuickUnlockKey(
    scope,
    new Uint8Array(32),
    envelope,
    guard,
    held
  );
  expect(await entered.promise).toMatchObject({ name: 'OperationError' });
  active = false;
  release.resolve();
  await expect(pending).rejects.toThrow('Owner retired');
});
