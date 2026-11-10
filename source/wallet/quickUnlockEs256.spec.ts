jest.unmock('crypto');

import { createHash, webcrypto } from 'crypto';

import { bytesToBase64Url, bytesToHex } from '../utils/passkey/base64url.ts';
import { decodeCbor } from '../utils/passkey/cbor.ts';
import {
  P256_ORDER,
  parseP256DerSignature,
} from '../utils/passkey/p256Signature.ts';
import {
  createPasskeyCredential,
  getDiscoverablePasskeyAssertion,
  getPasskeyAssertion,
  normalizePasskeyAssertion,
  normalizePasskeyRegistration,
} from '../utils/passkey/webauthn.ts';

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
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { document: {}, location: { origin } },
    });
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
      if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
      else Reflect.deleteProperty(globalThis, 'window');
      if (oldCredentials)
        Object.defineProperty(navigator, 'credentials', oldCredentials);
      else Reflect.deleteProperty(navigator, 'credentials');
      if (oldDigest) Object.defineProperty(crypto.subtle, 'digest', oldDigest);
      else Reflect.deleteProperty(crypto.subtle, 'digest');
    }
  });
});

// Genuine ES256 fixtures also exercise the smart-account raw boundary. These
// tests do not qualify an OS credential bridge, browser, RP association or PRF.
describe('Shared smart-account raw credential normalization', () => {
  const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const result = new ArrayBuffer(bytes.length);
    new Uint8Array(result).set(bytes);
    return result;
  };
  const encodeLength = (major: number, length: number): number[] =>
    length < 24
      ? [(major << 5) | length]
      : length < 256
      ? [(major << 5) | 24, length]
      : [(major << 5) | 25, length >> 8, length & 255];
  const cbor = (
    value: number | string | Uint8Array | Map<unknown, unknown>
  ): Uint8Array => {
    if (typeof value === 'number') {
      return Uint8Array.from(
        encodeLength(value < 0 ? 1 : 0, value < 0 ? -1 - value : value)
      );
    }
    if (typeof value === 'string') {
      const bytes = new TextEncoder().encode(value);
      return Uint8Array.of(...encodeLength(3, bytes.length), ...bytes);
    }
    if (value instanceof Uint8Array) {
      return Uint8Array.of(...encodeLength(2, value.length), ...value);
    }
    return Uint8Array.of(
      ...encodeLength(5, value.size),
      ...Array.from(value).flatMap(([key, entry]) => [
        ...cbor(key as number | string),
        ...cbor(entry as Parameters<typeof cbor>[0]),
      ])
    );
  };
  const clientData = (
    type: string,
    challenge: Uint8Array,
    expectedOrigin = origin
  ) =>
    new TextEncoder().encode(
      JSON.stringify({
        type,
        challenge: bytesToBase64Url(challenge),
        origin: expectedOrigin,
        crossOrigin: false,
      })
    );
  const expectation = (fixture: Awaited<ReturnType<typeof signedFixture>>) => ({
    assertCurrent: jest.fn(() => undefined),
    challenge: fixture.expected.challenge.slice(),
    origin,
    rpId: origin,
  });
  const registrationFixture = async () => {
    const fixture = await signedFixture();
    const key = await subtle.importKey('spki', fixture.enrolledSpki, ec, true, [
      'verify',
    ]);
    const publicKey = new Uint8Array(await subtle.exportKey('raw', key));
    const coseKey = cbor(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, publicKey.slice(1, 33)],
        [-3, publicKey.slice(33)],
      ])
    );
    const id = fixture.response.rawId;
    const authData = Uint8Array.of(
      ...sha256(new TextEncoder().encode(origin)),
      0x45,
      0,
      0,
      0,
      0,
      ...new Uint8Array(16),
      0,
      id.length,
      ...id,
      ...coseKey
    );
    const raw = {
      attestationObject: cbor(
        new Map<string, unknown>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ])
      ),
      clientDataJSON: clientData('webauthn.create', fixture.expected.challenge),
      rawId: id.slice(),
    };
    return {
      ...fixture,
      authData,
      publicKey,
      raw,
      userId: new Uint8Array(32).fill(8),
    };
  };
  const browserAssertion = (
    fixture: Awaited<ReturnType<typeof signedFixture>>
  ) => ({
    rawId: arrayBuffer(fixture.response.rawId),
    response: {
      authenticatorData: arrayBuffer(fixture.response.authenticatorData),
      clientDataJSON: arrayBuffer(fixture.response.clientDataJSON),
      signature: arrayBuffer(fixture.response.signature),
      userHandle: arrayBuffer(Uint8Array.of(4, 5)),
    },
  });
  const browserRegistration = (
    fixture: Awaited<ReturnType<typeof registrationFixture>>
  ) => ({
    rawId: arrayBuffer(fixture.raw.rawId),
    response: {
      attestationObject: arrayBuffer(fixture.raw.attestationObject),
      clientDataJSON: arrayBuffer(fixture.raw.clientDataJSON),
    },
  });
  let oldWindow: PropertyDescriptor | undefined;
  let oldCredentials: PropertyDescriptor | undefined;
  let oldDigest: PropertyDescriptor | undefined;
  const browser = (credentials: { create?: jest.Mock; get?: jest.Mock }) => {
    const document = {};
    const location = { origin };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { document, location },
    });
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: credentials,
    });
    return { document, location };
  };
  beforeEach(() => {
    oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    oldCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
    oldDigest = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest');
    Object.defineProperty(crypto.subtle, 'digest', {
      configurable: true,
      value: subtle.digest.bind(subtle),
    });
  });
  afterEach(() => {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (oldCredentials)
      Object.defineProperty(navigator, 'credentials', oldCredentials);
    else Reflect.deleteProperty(navigator, 'credentials');
    if (oldDigest) Object.defineProperty(crypto.subtle, 'digest', oldDigest);
    else Reflect.deleteProperty(crypto.subtle, 'digest');
  });

  it('normalizes original signed bytes, genuine high-s DER, credential and public-key identity without PRF', async () => {
    const fixture = await signedFixture();
    const expected = expectation(fixture);
    const result = await normalizePasskeyAssertion(
      fixture.response,
      expected,
      fixture.response.rawId
    );
    const key = await subtle.importKey('spki', fixture.enrolledSpki, ec, true, [
      'verify',
    ]);
    const publicKey = new Uint8Array(await subtle.exportKey('raw', key));
    expect(result.authenticatorData).toBe(
      bytesToHex(fixture.response.authenticatorData)
    );
    expect(result.clientDataJSON).toBe(
      bytesToHex(fixture.response.clientDataJSON)
    );
    expect(result.credentialIdHash).toBe(
      bytesToHex(sha256(fixture.response.rawId))
    );
    expect(result.digest).toBe(
      bytesToHex(
        sha256(
          Uint8Array.of(
            ...fixture.response.authenticatorData,
            ...sha256(fixture.response.clientDataJSON)
          )
        )
      )
    );
    expect(result.r).toBe(bytesToHex(fixture.r));
    expect(result.s).toBe(bytesToHex(fixture.lowS));
    expect(result.publicKeyCandidates).toContainEqual(
      expect.objectContaining({
        x: bytesToHex(publicKey.slice(1, 33)),
        y: bytesToHex(publicKey.slice(33)),
        rpIdHash: bytesToHex(sha256(new TextEncoder().encode(origin))),
      })
    );
    expect(expected.assertCurrent.mock.calls.length).toBeGreaterThan(4);
  });

  it('normalizes genuine registration bytes and the canonical browser create result identically, preserving omitted RP', async () => {
    const fixture = await registrationFixture();
    const expected = expectation(fixture);
    const raw = await normalizePasskeyRegistration(
      fixture.raw,
      fixture.userId,
      expected
    );
    const create = jest.fn(async (options: CredentialCreationOptions) => {
      expect(options.publicKey).toBeDefined();
      return browserRegistration(fixture);
    });
    browser({ create });
    const result = await createPasskeyCredential({
      accountName: 'test',
      challengeHex: bytesToHex(expected.challenge),
      userId: fixture.userId,
    });
    expect(result).toEqual(raw);
    expect(result.rawId).toBe(bytesToBase64Url(fixture.raw.rawId));
    expect(result.credentialId).toBe(result.rawId);
    expect(result.x).toBe(bytesToHex(fixture.publicKey.slice(1, 33)));
    expect(result.y).toBe(bytesToHex(fixture.publicKey.slice(33)));
    expect(result.userHandle).toBe(bytesToBase64Url(fixture.userId));
    const options = create.mock.calls[0][0] as CredentialCreationOptions;
    expect(options.publicKey?.rp).toEqual({ name: 'Pali Wallet' });
    expect(options.publicKey?.authenticatorSelection?.userVerification).toBe(
      'required'
    );
  });

  it('keeps both canonical browser assertion APIs and optional RP/allowCredentials semantics', async () => {
    const fixture = await signedFixture();
    const get = jest.fn(async (options: CredentialRequestOptions) => {
      expect(options.publicKey).toBeDefined();
      return browserAssertion(fixture);
    });
    browser({ get });
    const known = await getPasskeyAssertion(
      bytesToBase64Url(fixture.response.rawId),
      bytesToHex(fixture.expected.challenge),
      origin
    );
    const discovered = await getDiscoverablePasskeyAssertion(
      bytesToHex(fixture.expected.challenge)
    );
    expect(discovered).toEqual(known);
    expect(known.userHandle).toBe(bytesToBase64Url(Uint8Array.of(4, 5)));
    const first = get.mock.calls[0][0] as CredentialRequestOptions;
    const second = get.mock.calls[1][0] as CredentialRequestOptions;
    expect(first.publicKey?.rpId).toBe(origin);
    expect(
      new Uint8Array(first.publicKey!.allowCredentials![0].id as ArrayBuffer)
    ).toEqual(fixture.response.rawId);
    expect(second.publicKey).not.toHaveProperty('rpId');
    expect(second.publicKey).not.toHaveProperty('allowCredentials');
  });

  it('requires explicit trusted raw-host RP, origin, challenge and returned credential identity', async () => {
    const fixture = await signedFixture();
    for (const changed of [
      { origin: '' },
      { origin: 'https://wrong.test' },
      { rpId: '' },
      { rpId: 'wrong.test' },
      { challenge: new Uint8Array(32) },
    ]) {
      await expect(
        normalizePasskeyAssertion(fixture.response, {
          ...expectation(fixture),
          ...changed,
        })
      ).rejects.toThrow();
    }
    const missingRp = expectation(fixture);
    Reflect.deleteProperty(missingRp, 'rpId');
    await expect(
      normalizePasskeyAssertion(fixture.response, missingRp)
    ).rejects.toThrow('trusted origin and RP ID');
    await expect(
      normalizePasskeyAssertion(
        fixture.response,
        expectation(fixture),
        Uint8Array.of(9)
      )
    ).rejects.toThrow('credential ID');
  });

  it('requires registration type/challenge/origin and exact attested/raw credential equality', async () => {
    const fixture = await registrationFixture();
    for (const changed of [
      { clientDataJSON: fixture.response.clientDataJSON },
      { clientDataJSON: clientData('webauthn.create', new Uint8Array(32)) },
      {
        clientDataJSON: clientData(
          'webauthn.create',
          fixture.expected.challenge,
          'https://wrong.test'
        ),
      },
      { rawId: Uint8Array.of(9) },
    ]) {
      await expect(
        normalizePasskeyRegistration(
          { ...fixture.raw, ...changed },
          fixture.userId,
          expectation(fixture)
        )
      ).rejects.toThrow();
    }
    await expect(
      normalizePasskeyRegistration(fixture.raw, fixture.userId, {
        ...expectation(fixture),
        rpId: 'wrong.test',
      })
    ).rejects.toThrow('RP ID');
  });

  it.each([
    ['duplicate origin', `,"origin":${JSON.stringify(origin)}`],
    ['escaped duplicate challenge', ',"chall\\u0065nge":"wrong"'],
    ['cross origin', ',"crossOrigin":true'],
    ['top origin', ',"topOrigin":"https://other.test"'],
  ])(
    'rejects ambiguous or cross-origin signed client data: %s',
    async (_, suffix) => {
      const fixture = await signedFixture();
      const text = new TextDecoder().decode(fixture.response.clientDataJSON);
      const bytes = new TextEncoder().encode(text.slice(0, -1) + suffix + '}');
      await expect(
        normalizePasskeyAssertion(
          { ...fixture.response, clientDataJSON: bytes },
          expectation(fixture)
        )
      ).rejects.toThrow();
    }
  );

  it('rejects malformed UTF-8, DER, authenticator flags, and field byte budgets before hashing', async () => {
    const fixture = await signedFixture();
    const badFlags = fixture.response.authenticatorData.slice();
    badFlags[32] = 0x01;
    const digest = jest.fn(subtle.digest.bind(subtle));
    Object.defineProperty(crypto.subtle, 'digest', {
      configurable: true,
      value: digest,
    });
    for (const changed of [
      { rawId: new Uint8Array() },
      { rawId: new Uint8Array(1024) },
      { clientDataJSON: Uint8Array.of(0xff) },
      { clientDataJSON: new Uint8Array(16_385) },
      { authenticatorData: new Uint8Array(36) },
      { authenticatorData: new Uint8Array(16_385) },
      { authenticatorData: badFlags },
      { signature: new Uint8Array(73) },
      { signature: new Uint8Array(8) },
      { userHandle: new Uint8Array(65) },
    ]) {
      await expect(
        normalizePasskeyAssertion(
          { ...fixture.response, ...changed },
          expectation(fixture)
        )
      ).rejects.toThrow();
    }
    expect(digest).not.toHaveBeenCalled();
  });

  it('bounds malformed attestation lengths, nesting and duplicate CBOR keys', async () => {
    const fixture = await registrationFixture();
    const nested = Uint8Array.of(
      ...Array.from({ length: 34 }, () => [0xa1, 0]).flat(),
      0xf6
    );
    for (const bytes of [
      new Uint8Array(),
      Uint8Array.of(0x5a, 0xff),
      Uint8Array.of(0x5a, 0xff, 0xff, 0xff, 0xff),
      Uint8Array.of(0xba, 0xff, 0xff, 0xff, 0xff),
      Uint8Array.of(0x7a, 0xff, 0xff, 0xff, 0xff),
      Uint8Array.of(0xa2, 0, 0xf6, 0, 0xf6),
      nested,
    ]) {
      expect(() => decodeCbor(bytes)).toThrow();
      await expect(
        normalizePasskeyRegistration(
          { ...fixture.raw, attestationObject: bytes },
          fixture.userId,
          expectation(fixture)
        )
      ).rejects.toThrow();
    }
    await expect(
      normalizePasskeyRegistration(
        { ...fixture.raw, attestationObject: new Uint8Array(16_385) },
        fixture.userId,
        expectation(fixture)
      )
    ).rejects.toThrow('attestation object');
    const truncated = cbor(
      new Map([['authData', fixture.authData.slice(0, 54)]])
    );
    await expect(
      normalizePasskeyRegistration(
        { ...fixture.raw, attestationObject: truncated },
        fixture.userId,
        expectation(fixture)
      )
    ).rejects.toThrow('credential ID');
  });

  it('uses owned raw response and expectation snapshots across async hashing', async () => {
    const fixture = await signedFixture();
    const expected = expectation(fixture);
    const original = await normalizePasskeyAssertion(
      fixture.response,
      expected,
      fixture.response.rawId
    );
    const entered = deferred(),
      release = deferred();
    let first = true;
    Object.defineProperty(crypto.subtle, 'digest', {
      configurable: true,
      value: async (...args: Parameters<SubtleCrypto['digest']>) => {
        const result = await subtle.digest(...args);
        if (first) {
          first = false;
          entered.resolve();
          await release.promise;
        }
        return result;
      },
    });
    const pending = normalizePasskeyAssertion(
      fixture.response,
      expected,
      fixture.response.rawId
    );
    await entered.promise;
    for (const bytes of [
      fixture.response.authenticatorData,
      fixture.response.clientDataJSON,
      fixture.response.rawId,
      fixture.response.signature,
      expected.challenge,
    ])
      bytes.fill(0);
    expected.origin = 'https://changed.test';
    expected.rpId = 'changed.test';
    release.resolve();
    await expect(pending).resolves.toEqual(original);
  });

  it.each([1, 2, 3, 4])(
    'rejects owner loss during async hash %i before publishing a result',
    async (heldHash) => {
      const fixture = await signedFixture();
      const entered = deferred(),
        release = deferred();
      const delivered = jest.fn();
      let active = true,
        calls = 0;
      Object.defineProperty(crypto.subtle, 'digest', {
        configurable: true,
        value: async (...args: Parameters<SubtleCrypto['digest']>) => {
          const result = await subtle.digest(...args);
          if (++calls === heldHash) {
            entered.resolve();
            await release.promise;
          }
          return result;
        },
      });
      const pending = normalizePasskeyAssertion(fixture.response, {
        ...expectation(fixture),
        assertCurrent: () => {
          if (!active) throw new Error('Owner retired');
        },
      }).then(delivered);
      await entered.promise;
      active = false;
      release.resolve();
      await expect(pending).rejects.toThrow('Owner retired');
      expect(delivered).not.toHaveBeenCalled();
    }
  );

  it('rejects an asynchronous current-owner guard', async () => {
    const fixture = await signedFixture();
    await expect(
      normalizePasskeyAssertion(fixture.response, {
        ...expectation(fixture),
        assertCurrent: async () => undefined,
      })
    ).rejects.toThrow('synchronous');
  });

  it.each(['create', 'get'] as const)(
    'captures document/origin before browser %s, rejects drift and restores no expectation from returned data',
    async (operation) => {
      const fixture = await registrationFixture();
      const entered = deferred(),
        release = deferred();
      const prompt = jest.fn(async () => {
        entered.resolve();
        await release.promise;
        return operation === 'create'
          ? browserRegistration(fixture)
          : browserAssertion(fixture);
      });
      const context = browser({ [operation]: prompt });
      const pending =
        operation === 'create'
          ? createPasskeyCredential({
              accountName: 'test',
              challengeHex: bytesToHex(fixture.expected.challenge),
              userId: fixture.userId,
            })
          : getPasskeyAssertion(
              bytesToBase64Url(fixture.response.rawId),
              bytesToHex(fixture.expected.challenge)
            );
      await entered.promise;
      context.location.origin = 'https://changed.test';
      release.resolve();
      await expect(pending).rejects.toThrow('document changed');
    }
  );

  it('rejects same-origin document replacement during hashing and missing browser document before prompting', async () => {
    const fixture = await signedFixture();
    const get = jest.fn(async (options: CredentialRequestOptions) => {
      expect(options.publicKey).toBeDefined();
      return browserAssertion(fixture);
    });
    browser({ get });
    const entered = deferred(),
      release = deferred();
    Object.defineProperty(crypto.subtle, 'digest', {
      configurable: true,
      value: async (...args: Parameters<SubtleCrypto['digest']>) => {
        const result = await subtle.digest(...args);
        entered.resolve();
        await release.promise;
        return result;
      },
    });
    const pending = getPasskeyAssertion(
      bytesToBase64Url(fixture.response.rawId),
      bytesToHex(fixture.expected.challenge)
    );
    await entered.promise;
    Object.defineProperty(window, 'document', {
      configurable: true,
      value: {},
    });
    release.resolve();
    await expect(pending).rejects.toThrow('document changed');
    Reflect.deleteProperty(globalThis, 'window');
    get.mockClear();
    await expect(
      getPasskeyAssertion(
        bytesToBase64Url(fixture.response.rawId),
        bytesToHex(fixture.expected.challenge)
      )
    ).rejects.toThrow('origin is unavailable');
    await expect(
      createPasskeyCredential({
        accountName: 'test',
        challengeHex: bytesToHex(fixture.expected.challenge),
      })
    ).rejects.toThrow('origin is unavailable');
    expect(get).not.toHaveBeenCalled();
  });
});
