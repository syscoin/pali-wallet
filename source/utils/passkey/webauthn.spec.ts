jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/hash');
jest.unmock('@ethersproject/strings');
jest.unmock('@ethersproject/transactions');
jest.unmock('@ethersproject/wallet');
jest.unmock('crypto');

import { createHash, webcrypto } from 'crypto';

import { bytesToHex } from './base64url';
import { recoverP256PublicKeyCandidates } from './webauthn';

const P256_N = BigInt(
  '0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'
);
const P256_HALF_N = BigInt(
  '0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8'
);

const bytesToBigInt = (bytes: Uint8Array): bigint =>
  BigInt(`0x${bytesToHex(bytes).slice(2) || '0'}`);

const bigIntToBytes32 = (value: bigint): Uint8Array =>
  Uint8Array.from(Buffer.from(value.toString(16).padStart(64, '0'), 'hex'));

const sha256 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha256').update(bytes).digest());

const p256SignaturePair = async () => {
  const message = webcrypto.getRandomValues(new Uint8Array(48));
  const digest = sha256(message);
  const key = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const signature = new Uint8Array(
    await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key.privateKey,
      message
    )
  );
  const publicKey = new Uint8Array(
    await webcrypto.subtle.exportKey('raw', key.publicKey)
  );
  const x = bytesToHex(publicKey.slice(1, 33));
  const y = bytesToHex(publicKey.slice(33, 65));
  const r = signature.slice(0, 32);
  const s = signature.slice(32, 64);
  const sValue = bytesToBigInt(s);
  const lowS = sValue > P256_HALF_N ? bigIntToBytes32(P256_N - sValue) : s;
  const highS = sValue > P256_HALF_N ? s : bigIntToBytes32(P256_N - sValue);

  return { digest, highS, lowS, r, x, y };
};

describe('passkey WebAuthn P-256 recovery utilities', () => {
  it('recovers the generated public key from a low-s P-256 assertion signature', async () => {
    const { digest, lowS, r, x, y } = await p256SignaturePair();

    const candidates = recoverP256PublicKeyCandidates({
      digest,
      originHash:
        '0x1111111111111111111111111111111111111111111111111111111111111111',
      originLength: 23,
      r,
      rpIdHash:
        '0x2222222222222222222222222222222222222222222222222222222222222222',
      s: lowS,
    });

    expect(candidates).toContainEqual(
      expect.objectContaining({
        x,
        y,
      })
    );
    expect(
      new Set(candidates.map((candidate) => `${candidate.x}:${candidate.y}`))
        .size
    ).toBe(candidates.length);
  });

  it('normalizes high-s P-256 assertion signatures before candidate recovery', async () => {
    const { digest, highS, r, x, y } = await p256SignaturePair();

    const candidates = recoverP256PublicKeyCandidates({
      digest,
      originHash:
        '0x3333333333333333333333333333333333333333333333333333333333333333',
      originLength: 23,
      r,
      rpIdHash:
        '0x4444444444444444444444444444444444444444444444444444444444444444',
      s: highS,
    });

    expect(candidates).toContainEqual(
      expect.objectContaining({
        x,
        y,
      })
    );
  });

  it('filters invalid P-256 recovery inputs', async () => {
    const digest = sha256(new Uint8Array([1, 2, 3]));

    expect(
      recoverP256PublicKeyCandidates({
        digest,
        originHash:
          '0x5555555555555555555555555555555555555555555555555555555555555555',
        originLength: 23,
        r: new Uint8Array(32),
        rpIdHash:
          '0x6666666666666666666666666666666666666666666666666666666666666666',
        s: bigIntToBytes32(BigInt(1)),
      })
    ).toEqual([]);
  });
});
