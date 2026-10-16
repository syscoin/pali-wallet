import { createHash, generateKeyPairSync, sign, constants } from 'crypto';

import { inspectCrx } from '../../e2e/scripts/prepare-store-upgrade-artifact.cjs';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const varint = (value: number) => {
  const bytes = [];
  do {
    const next = value % 128;
    value = Math.floor(value / 128);
    bytes.push(next + (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
};
const field = (number: number, bytes: Buffer) =>
  Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);

describe('pinned Chrome Web Store CRX upgrade artifact preparation', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  function fixture(
    kind: 'rsa' | 'ec',
    options: {
      duplicateSignedHeader?: boolean;
      publisherMismatch?: boolean;
    } = {}
  ) {
    const pair = kind === 'rsa' ? rsa : ec;
    const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' });
    const id = Buffer.from(
      options.publisherMismatch ? '33'.repeat(16) : sha(publicKey).slice(0, 32),
      'hex'
    );
    const extensionId = id
      .toString('hex')
      .replace(/[a-f0-9]/g, (digit) =>
        String.fromCharCode(97 + parseInt(digit, 16))
      );
    const signedHeader = field(1, id);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(signedHeader.length);
    // The cryptographic envelope test needs only the ZIP prefix. Archive
    // extraction/member validation belongs to the browser journey.
    const zip = Buffer.from([80, 75, 3, 4, 10, 20, 30]);
    const signed = Buffer.concat([
      Buffer.from('CRX3 SignedData\0', 'ascii'),
      size,
      signedHeader,
      zip,
    ]);
    const signature = sign('sha256', signed, {
      key: pair.privateKey,
      ...(kind === 'rsa' ? { padding: constants.RSA_PKCS1_PADDING } : {}),
    });
    const proof = Buffer.concat([field(1, publicKey), field(2, signature)]);
    const header = Buffer.concat([
      field(kind === 'rsa' ? 2 : 3, proof),
      field(10000, signedHeader),
      ...(options.duplicateSignedHeader ? [field(10000, signedHeader)] : []),
    ]);
    const prefix = Buffer.alloc(12);
    prefix.write('Cr24', 0, 'ascii');
    prefix.writeUInt32LE(3, 4);
    prefix.writeUInt32LE(header.length, 8);
    return { bytes: Buffer.concat([prefix, header, zip]), extensionId, zip };
  }

  it.each(['rsa', 'ec'] as const)(
    'verifies %s publisher signatures and returns the exact unchanged ZIP payload',
    (kind) => {
      const { bytes, extensionId, zip } = fixture(kind);
      const result = inspectCrx(bytes, sha(bytes), extensionId);
      expect(result.zip.equals(zip)).toBe(true);
      expect(result.evidence).toMatchObject({
        extensionId,
        zipSha256: sha(zip),
        allHeaderProofsVerified: true,
        publisherPublicKeyBoundToExtensionId: true,
        zipPayloadUnmodified: true,
        googleWebStoreVerifierKeyPinClaimed: false,
      });
    }
  );

  it('refuses an unpinned CRX digest', () => {
    const { bytes, extensionId } = fixture('rsa');
    expect(() => inspectCrx(bytes, '00'.repeat(32), extensionId)).toThrow(
      'SHA256 mismatch'
    );
  });

  it('refuses a different extension id', () => {
    const { bytes } = fixture('rsa');
    expect(() => inspectCrx(bytes, sha(bytes), 'a'.repeat(32))).toThrow(
      'extension id mismatch'
    );
  });

  it('rejects modified archive bytes even if the caller pins their new digest', () => {
    const { bytes, extensionId } = fixture('rsa');
    bytes[bytes.length - 1] ^= 1;
    expect(() => inspectCrx(bytes, sha(bytes), extensionId)).toThrow(
      'Invalid CRX3 signature'
    );
  });

  it('rejects a valid signature whose public key is not bound to the extension id', () => {
    const { bytes, extensionId } = fixture('rsa', { publisherMismatch: true });
    expect(() => inspectCrx(bytes, sha(bytes), extensionId)).toThrow(
      'publisher proof missing'
    );
  });

  it('rejects ambiguous duplicate signed-header fields', () => {
    const { bytes, extensionId } = fixture('ec', {
      duplicateSignedHeader: true,
    });
    expect(() => inspectCrx(bytes, sha(bytes), extensionId)).toThrow(
      'duplicate CRX3 field'
    );
  });

  it('rejects oversized and truncated header declarations', () => {
    const { bytes, extensionId } = fixture('rsa');
    bytes.writeUInt32LE(1024 * 1024 + 1, 8);
    expect(() => inspectCrx(bytes, sha(bytes), extensionId)).toThrow(
      'header size refused'
    );
    bytes.writeUInt32LE(bytes.length, 8);
    expect(() => inspectCrx(bytes, sha(bytes), extensionId)).toThrow(
      'header size refused'
    );
  });
});
