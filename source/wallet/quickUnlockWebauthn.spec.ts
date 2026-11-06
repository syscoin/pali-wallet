import { createHash, webcrypto } from 'crypto';

import { bytesToBase64Url } from '../utils/passkey/base64url.ts';

import {
  admitQuickUnlockWebAuthnResponse,
  type QuickUnlockWebAuthnExpectation,
  type QuickUnlockWebAuthnResponse,
} from './quickUnlockWebauthn.ts';

const subtle = (webcrypto as unknown as Crypto).subtle;
const origin = `chrome-extension://${'a'.repeat(32)}`;
const invalid = 'Invalid Quick unlock WebAuthn response';
const current = () => undefined;
const encode = (value: string) => new TextEncoder().encode(value);

function fixture(
  type: QuickUnlockWebAuthnExpectation['type'] = 'webauthn.get'
) {
  const create = type === 'webauthn.create';
  const challenge = new Uint8Array(32).fill(27);
  const credentialId = Uint8Array.of(1, 2, 3);
  const expected: QuickUnlockWebAuthnExpectation = {
    ...(create
      ? { type: 'webauthn.create' }
      : { type: 'webauthn.get', credentialId }),
    challenge,
    origin,
    rpId: origin,
  };
  const clientData = {
    type,
    challenge: bytesToBase64Url(challenge),
    origin,
    crossOrigin: false,
  };
  const authenticatorData = new Uint8Array(
    create ? 55 + credentialId.length + 1 : 37
  );
  authenticatorData.set(createHash('sha256').update(origin).digest());
  authenticatorData[32] = create ? 0x45 : 0x05;
  if (create) {
    authenticatorData[54] = credentialId.length;
    authenticatorData.set(credentialId, 55);
    authenticatorData[authenticatorData.length - 1] = 0xa0;
  }
  const response = {
    type: 'public-key',
    rawId: credentialId.slice(),
    authenticatorData,
    clientDataJSON: encode(JSON.stringify(clientData)),
    prfEnabled: create ? true : undefined,
    signature: create ? undefined : Uint8Array.of(0x30, 1),
    prfOutput: create ? undefined : new Uint8Array(32).fill(19),
  } satisfies QuickUnlockWebAuthnResponse;
  return { expected, clientData, response };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function heldDigest() {
  const entered = deferred();
  const release = deferred();
  const digest: SubtleCrypto['digest'] = async (...args) => {
    const hash = await subtle.digest(...args);
    entered.resolve();
    await release.promise;
    return hash;
  };
  return { digest, entered, release };
}

describe('Quick unlock WebAuthn response admission', () => {
  it('returns exact captured signed fields with an explicit signature-verification obligation', async () => {
    const { expected, response } = fixture();
    const original = {
      credentialId: response.rawId.slice(),
      authenticatorData: response.authenticatorData.slice(),
      clientDataJSON: response.clientDataJSON.slice(),
      signature: response.signature!.slice(),
      prfOutput: response.prfOutput!.slice(),
    };
    const { digest, entered, release } = heldDigest();
    const pending = admitQuickUnlockWebAuthnResponse(
      expected,
      response,
      current,
      { digest }
    );
    await entered.promise;
    response.rawId.fill(0);
    response.authenticatorData.fill(0);
    response.clientDataJSON.fill(0);
    response.signature!.fill(0);
    response.prfOutput!.fill(0);
    release.resolve();
    await expect(pending).resolves.toEqual({
      kind: 'assertion-needs-signature-verification',
      ...original,
    });
  });

  it('never forwards a result for a retired owner after the real RP digest completes', async () => {
    const { expected, response } = fixture();
    const { digest, entered, release } = heldDigest();
    let active = true;
    const deliver = jest.fn();
    const pending = admitQuickUnlockWebAuthnResponse(
      expected,
      response,
      () => {
        if (!active) throw new Error('Owner retired');
      },
      { digest }
    ).then(deliver);
    await entered.promise;
    active = false;
    release.resolve();
    await expect(pending).rejects.toThrow('Owner retired');
    expect(deliver).not.toHaveBeenCalled();
    expect(response.prfOutput).toEqual(new Uint8Array(32).fill(19));
  });

  it('requires a synchronous current owner before processing a response', async () => {
    const { expected, response } = fixture();
    const digest = jest.fn();
    await expect(
      admitQuickUnlockWebAuthnResponse(
        expected,
        response,
        async () => {
          throw new Error('Async guard is not accepted');
        },
        { digest }
      )
    ).rejects.toThrow(invalid);
    expect(digest).not.toHaveBeenCalled();
  });

  it('admits a PRF-enabled creation only as a follow-up assertion, even with create PRF bytes', async () => {
    const { expected, response } = fixture('webauthn.create');
    const bytes = {
      credentialId: response.rawId,
      clientDataJSON: response.clientDataJSON,
      authenticatorData: response.authenticatorData,
    };
    await expect(
      admitQuickUnlockWebAuthnResponse(expected, response, current, subtle)
    ).resolves.toEqual({
      kind: 'registration-needs-assertion',
      prf: 'not-returned',
      ...bytes,
    });
    const prfOutput = new Uint8Array(32).fill(6);
    await expect(
      admitQuickUnlockWebAuthnResponse(
        expected,
        { ...response, prfOutput },
        current,
        subtle
      )
    ).resolves.toEqual({
      kind: 'registration-needs-assertion',
      prf: 'returned',
      ...bytes,
    });
    expect(prfOutput).toEqual(new Uint8Array(32).fill(6));
    for (const malformed of [
      { ...response, prfEnabled: undefined },
      { ...response, prfEnabled: false },
      { ...response, prfOutput: new Uint8Array(31) },
      {
        ...response,
        authenticatorData: response.authenticatorData.slice(0, -1),
      },
      { ...response, rawId: Uint8Array.of(3, 2, 1) },
    ]) {
      await expect(
        admitQuickUnlockWebAuthnResponse(expected, malformed, current, subtle)
      ).rejects.toThrow(invalid);
    }
  });

  it('requires backup eligibility for a backed-up registration', async () => {
    const { expected, response } = fixture('webauthn.create');
    response.authenticatorData[32] |= 0x10;
    await expect(
      admitQuickUnlockWebAuthnResponse(expected, response, current, subtle)
    ).rejects.toThrow(invalid);

    response.authenticatorData[32] |= 0x08;
    await expect(
      admitQuickUnlockWebAuthnResponse(expected, response, current, subtle)
    ).resolves.toMatchObject({
      kind: 'registration-needs-assertion',
    });
  });

  it('rejects mismatched ceremony, challenge, origin and cross/top-origin or ambiguous client data', async () => {
    const { expected, response, clientData } = fixture();
    const goodText = JSON.stringify(clientData);
    const malformed = [
      JSON.stringify({ ...clientData, type: 'webauthn.create' }),
      JSON.stringify({ ...clientData, challenge: 'other' }),
      JSON.stringify({ ...clientData, origin: 'https://wrong.test' }),
      JSON.stringify({ ...clientData, origin: undefined }),
      JSON.stringify({ ...clientData, crossOrigin: true }),
      JSON.stringify({ ...clientData, crossOrigin: 'false' }),
      JSON.stringify({ ...clientData, topOrigin: origin }),
      `{"origin":"https://wrong.test",${goodText.slice(1)}`,
      `${goodText.slice(0, -1)},"cross\\u004frigin":false}`,
    ].map(encode);
    malformed.push(Uint8Array.of(0xff), new Uint8Array(4097));
    for (const clientDataJSON of malformed) {
      await expect(
        admitQuickUnlockWebAuthnResponse(
          expected,
          { ...response, clientDataJSON },
          current,
          subtle
        )
      ).rejects.toThrow(invalid);
    }
    const digest = jest.fn();
    await expect(
      admitQuickUnlockWebAuthnResponse(
        { ...expected, origin: '' },
        response,
        current,
        { digest }
      )
    ).rejects.toThrow(invalid);
    await expect(
      admitQuickUnlockWebAuthnResponse(
        { ...expected, rpId: `${origin}\n` },
        response,
        current,
        { digest }
      )
    ).rejects.toThrow(invalid);
    expect(digest).not.toHaveBeenCalled();
  });

  it('requires the exact effective RP digest, UP, UV, selected ID and bounded get bytes', async () => {
    const { expected, response } = fixture();
    await expect(
      admitQuickUnlockWebAuthnResponse(
        { ...expected, rpId: origin.slice('chrome-extension://'.length) },
        response,
        current,
        subtle
      )
    ).rejects.toThrow(invalid);
    const withFlags = (flags: number) => {
      const authenticatorData = response.authenticatorData.slice();
      authenticatorData[32] = flags;
      return authenticatorData;
    };
    for (const malformed of [
      { ...response, authenticatorData: withFlags(0x01) },
      { ...response, authenticatorData: withFlags(0x04) },
      { ...response, authenticatorData: withFlags(0x45) },
      { ...response, authenticatorData: new Uint8Array(36) },
      { ...response, authenticatorData: new Uint8Array(4097) },
      { ...response, rawId: Uint8Array.of(3, 2, 1) },
      { ...response, rawId: new Uint8Array(1024) },
      { ...response, signature: undefined },
      { ...response, signature: new Uint8Array(1025) },
      { ...response, prfOutput: undefined },
      { ...response, prfOutput: new Uint8Array(31) },
      { ...response, prfOutput: new Uint8Array(33) },
      { ...response, prfEnabled: false },
    ]) {
      await expect(
        admitQuickUnlockWebAuthnResponse(expected, malformed, current, subtle)
      ).rejects.toThrow(invalid);
    }
  });

  it('accepts native ArrayBuffer response fields without reading response accessors', async () => {
    const { expected, response } = fixture();
    await expect(
      admitQuickUnlockWebAuthnResponse(
        expected,
        {
          ...response,
          rawId: response.rawId.buffer,
          clientDataJSON: response.clientDataJSON.buffer,
          authenticatorData: response.authenticatorData.buffer,
          prfOutput: response.prfOutput!.buffer,
        },
        current,
        subtle
      )
    ).resolves.toMatchObject({
      kind: 'assertion-needs-signature-verification',
    });
    const get = jest.fn(() => response.prfOutput);
    const lazy = Object.defineProperty({ ...response }, 'prfOutput', { get });
    await expect(
      admitQuickUnlockWebAuthnResponse(expected, lazy, current, subtle)
    ).rejects.toThrow(invalid);
    expect(get).not.toHaveBeenCalled();
  });
});
