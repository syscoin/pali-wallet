jest.unmock('crypto');

import { createHash, webcrypto } from 'crypto';

import { bytesToBase64Url, bytesToHex } from '../utils/passkey/base64url.ts';
import {
  P256_ORDER,
  parseP256DerSignature,
} from '../utils/passkey/p256Signature.ts';
import { getPasskeyAssertion } from '../utils/passkey/webauthn.ts';

import { verifyQuickUnlockEs256Assertion } from './quickUnlockWebauthn.ts';

const subtle = (webcrypto as unknown as Crypto).subtle;
const ec = { name: 'ECDSA', namedCurve: 'P-256' };
const es256 = { name: 'ECDSA', hash: 'SHA-256' };
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest();
const origin = `chrome-extension://${'a'.repeat(32)}`;
const current = () => undefined;
const invalid = 'Invalid Quick unlock WebAuthn response';

const scalar = (n: bigint) =>
  Uint8Array.from(Buffer.from(n.toString(16).padStart(64, '0'), 'hex'));
const asInteger = (value: Uint8Array) => {
  const significant = value.subarray(value.findIndex((byte) => byte !== 0));
  return significant[0] & 0x80 ? Uint8Array.of(0, ...significant) : significant;
};
function der(r: Uint8Array, s: Uint8Array) {
  const a = asInteger(r),
    b = asInteger(s);
  return Uint8Array.of(
    0x30,
    4 + a.length + b.length,
    0x02,
    a.length,
    ...a,
    0x02,
    b.length,
    ...b
  );
}

async function signedFixture(flags = 0x05, extensions: readonly number[] = []) {
  const key = await subtle.generateKey(ec, true, ['sign', 'verify']);
  const enrolledSpki = new Uint8Array(
    await subtle.exportKey('spki', key.publicKey)
  );
  const challenge = new Uint8Array(32).fill(7);
  const rawId = Uint8Array.of(1, 4, 6);
  const expected = {
    type: 'webauthn.get',
    challenge,
    credentialId: rawId.slice(),
    origin,
    rpId: origin,
  } as const;
  const authenticatorData = new Uint8Array(37 + extensions.length);
  authenticatorData.set(sha256(new TextEncoder().encode(origin)));
  authenticatorData[32] = flags;
  authenticatorData.set(extensions, 37);
  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({
      type: expected.type,
      origin,
      challenge: bytesToBase64Url(challenge),
      crossOrigin: false,
    })
  );
  const message = Uint8Array.of(
    ...authenticatorData,
    ...sha256(clientDataJSON)
  );
  const signature = new Uint8Array(
    await subtle.sign(es256, key.privateKey, message)
  );
  const r = signature.subarray(0, 32);
  const s = signature.subarray(32);
  const sValue = BigInt(bytesToHex(s));
  const alternate = scalar(P256_ORDER - sValue);
  const lowS = sValue <= P256_ORDER / BigInt(2) ? s : alternate;
  const highS = lowS === s ? alternate : s;
  return {
    enrolledSpki,
    expected,
    r,
    lowS,
    highS,
    response: {
      type: 'public-key' as const,
      rawId,
      authenticatorData,
      clientDataJSON,
      signature: der(r, highS),
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Canonical ES256 signature DER', () => {
  it('left-pads the smallest scalar and preserves a largest-range scalar with its sign pad', () => {
    const r = scalar(BigInt(1));
    const s = scalar(P256_ORDER - BigInt(1));
    expect(parseP256DerSignature(der(r, s))).toEqual(Uint8Array.of(...r, ...s));
  });

  it('rejects zero, negative, nonminimal, oversized, truncated and out-of-range signatures', () => {
    const max = scalar(P256_ORDER - BigInt(1));
    const good = der(max, max);
    for (const bytes of [
      [0x30, 6, 2, 1, 0, 2, 1, 1],
      [0x30, 6, 2, 1, 0x80, 2, 1, 1],
      [0x30, 7, 2, 2, 0, 1, 2, 1, 1],
      [0x30, 5, 2, 0, 2, 1, 1],
      [0x30, 0x81, 6, 2, 1, 1, 2, 1, 1],
      [0x30, 6, 2, 1, 1, 2, 2, 1],
      [0x30, 7, 2, 1, 1, 2, 1, 1, 0],
      [0x30, 6, 2, 1, 1, 2, 1, 1, 0],
      good.subarray(0, -1),
      [...good, 0],
      der(max, scalar(P256_ORDER)),
      der(scalar(P256_ORDER), max),
      new Uint8Array(1024),
    ]) {
      expect(() => parseP256DerSignature(Uint8Array.from(bytes))).toThrow(
        'Invalid P-256 DER signature'
      );
    }
  });
});

describe('Quick unlock ES256 signed assertion verifier', () => {
  it.each([
    ['BS without BE', 0x15, []],
    ['extension bytes without ED', 0x05, [0xa1, 0x61, 0x78, 0xf5]],
    ['ED without extension bytes', 0x85, []],
  ] as const)(
    'rejects signed authenticator data with %s',
    async (_, flags, extensions) => {
      const { enrolledSpki, expected, response } = await signedFixture(
        flags,
        extensions
      );
      const key = await subtle.importKey('spki', enrolledSpki, ec, false, [
        'verify',
      ]);
      const message = Uint8Array.of(
        ...response.authenticatorData,
        ...sha256(response.clientDataJSON)
      );

      expect(
        await subtle.verify(
          es256,
          key,
          parseP256DerSignature(response.signature),
          message
        )
      ).toBe(true);
      await expect(
        verifyQuickUnlockEs256Assertion(
          expected,
          response,
          enrolledSpki,
          current,
          subtle
        )
      ).rejects.toThrow(invalid);
    }
  );

  it.each([
    ['backup eligible', 0x0d, []],
    ['backed up', 0x1d, []],
    ['backed up with extension bytes', 0x9d, [0xa1, 0x61, 0x78, 0xf5]],
  ] as const)(
    'accepts signed authenticator data for %s',
    async (_, flags, extensions) => {
      const { enrolledSpki, expected, response } = await signedFixture(
        flags,
        extensions
      );
      await expect(
        verifyQuickUnlockEs256Assertion(
          expected,
          response,
          enrolledSpki,
          current,
          subtle
        )
      ).resolves.toBeUndefined();
    }
  );
  it('accepts both genuine s representations without reading PRF or returning a key', async () => {
    const { enrolledSpki, expected, response, r, lowS } = await signedFixture();
    const getPrf = jest.fn(() => {
      throw new Error('PRF access forbidden');
    });
    Object.defineProperty(response, 'prfOutput', { get: getPrf });
    await expect(
      verifyQuickUnlockEs256Assertion(
        expected,
        response,
        enrolledSpki,
        current,
        subtle
      )
    ).resolves.toBeUndefined();
    await expect(
      verifyQuickUnlockEs256Assertion(
        expected,
        { ...response, signature: der(r, lowS) },
        enrolledSpki,
        current,
        subtle
      )
    ).resolves.toBeUndefined();
    expect(getPrf).not.toHaveBeenCalled();
  });

  it('rejects wrong enrolled key, non-P-256 key, oversized and suffixed SPKI', async () => {
    const { enrolledSpki, expected, response } = await signedFixture();
    const other = (await signedFixture()).enrolledSpki;
    const p384 = await subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-384' },
      true,
      ['sign', 'verify']
    );
    const wrongCurve = await subtle.exportKey('spki', p384.publicKey);
    for (const key of [
      other,
      wrongCurve,
      new Uint8Array(130),
      Uint8Array.of(...enrolledSpki, 0),
    ]) {
      await expect(
        verifyQuickUnlockEs256Assertion(
          expected,
          response,
          key,
          current,
          subtle
        )
      ).rejects.toThrow(invalid);
    }
  });

  it('rejects a valid signature for the wrong challenge or credential and tampering with either signed field', async () => {
    const { enrolledSpki, expected, response } = await signedFixture();
    for (const wrong of [
      { ...expected, challenge: new Uint8Array(32) },
      { ...expected, credentialId: Uint8Array.of(9) },
      { ...expected, origin: 'https://wrong.test' },
      { ...expected, rpId: 'wrong.test' },
    ]) {
      await expect(
        verifyQuickUnlockEs256Assertion(
          wrong,
          response,
          enrolledSpki,
          current,
          subtle
        )
      ).rejects.toThrow(invalid);
    }

    const authenticatorData = response.authenticatorData.slice();
    authenticatorData[36] ^= 1;
    const clientDataJSON = Uint8Array.of(...response.clientDataJSON, 0x20);
    for (const tampered of [
      { ...response, authenticatorData },
      { ...response, clientDataJSON },
    ]) {
      await expect(
        verifyQuickUnlockEs256Assertion(
          expected,
          tampered,
          enrolledSpki,
          current,
          subtle
        )
      ).rejects.toThrow(invalid);
    }
  });

  it('uses owned input snapshots even when the caller mutates fields during the first digest', async () => {
    const { enrolledSpki, expected, response } = await signedFixture();
    const entered = deferred(),
      release = deferred();
    const digest: SubtleCrypto['digest'] = async (...args) => {
      const result = await subtle.digest(...args);
      entered.resolve();
      await release.promise;
      return result;
    };
    const pending = verifyQuickUnlockEs256Assertion(
      expected,
      response,
      enrolledSpki,
      current,
      {
        digest,
        importKey: subtle.importKey.bind(subtle),
        verify: subtle.verify.bind(subtle),
      }
    );
    await entered.promise;
    for (const bytes of [
      enrolledSpki,
      expected.challenge,
      expected.credentialId,
      response.authenticatorData,
      response.clientDataJSON,
      response.rawId,
      response.signature,
    ]) {
      bytes.fill(0);
    }
    release.resolve();
    await expect(pending).resolves.toBeUndefined();
  });

  it('discards a successful held WebCrypto verification on owner loss and clears its copies', async () => {
    const { enrolledSpki, expected, response } = await signedFixture();
    const entered = deferred(),
      release = deferred();
    const delivered = jest.fn();
    const captured: Uint8Array[] = [];
    let active = true;
    let realVerification: boolean | undefined;
    const verify: SubtleCrypto['verify'] = async (
      algorithm,
      key,
      raw,
      message
    ) => {
      realVerification = await subtle.verify(algorithm, key, raw, message);
      captured.push(raw as Uint8Array, message as Uint8Array);
      entered.resolve();
      await release.promise;
      return realVerification;
    };
    const pending = verifyQuickUnlockEs256Assertion(
      expected,
      response,
      enrolledSpki,
      () => {
        if (!active) throw new Error('Owner retired');
      },
      {
        verify,
        digest: subtle.digest.bind(subtle),
        importKey: subtle.importKey.bind(subtle),
      }
    ).then(delivered);
    await entered.promise;
    expect(realVerification).toBe(true);
    expect(captured.every((bytes) => bytes.some((byte) => byte !== 0))).toBe(
      true
    );
    active = false;
    release.resolve();
    await expect(pending).rejects.toThrow('Owner retired');
    expect(delivered).not.toHaveBeenCalled();
    expect(captured.every((bytes) => bytes.every((byte) => byte === 0))).toBe(
      true
    );
    expect(response.signature[0]).toBe(0x30);
  });

  it('still normalizes high-s DER at the actual smart-account assertion call site', async () => {
    const { expected, response, r, lowS } = await signedFixture();
    const oldCredentials = Object.getOwnPropertyDescriptor(
      navigator,
      'credentials'
    );
    const oldDigest = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest');
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: {
        get: async () => ({
          rawId: response.rawId.buffer,
          response: {
            authenticatorData: response.authenticatorData.buffer,
            clientDataJSON: response.clientDataJSON.buffer,
            signature: response.signature.buffer,
          },
        }),
      },
    });
    Object.defineProperty(crypto.subtle, 'digest', {
      configurable: true,
      value: subtle.digest.bind(subtle),
    });
    try {
      const result = await getPasskeyAssertion(
        bytesToBase64Url(response.rawId),
        bytesToHex(expected.challenge)
      );
      expect(result.r).toBe(bytesToHex(r));
      expect(result.s).toBe(bytesToHex(lowS));
    } finally {
      if (oldCredentials)
        Object.defineProperty(navigator, 'credentials', oldCredentials);
      else Reflect.deleteProperty(navigator, 'credentials');
      if (oldDigest) Object.defineProperty(crypto.subtle, 'digest', oldDigest);
      else Reflect.deleteProperty(crypto.subtle, 'digest');
    }
  });
});
