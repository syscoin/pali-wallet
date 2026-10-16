'use strict';

// CRX3 wire/signature format and publisher-id binding:
// https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/crx3.proto
// https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/crx_verifier.cc
// This QA helper validates a pinned public CRX and writes its byte-exact ZIP
// payload. It does not rewrite any manifest/member or install an extension.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function fields(bytes) {
  let offset = 0;
  const output = new Map();
  function varint() {
    let value = 0;
    let factor = 1;
    for (let i = 0; i < 5; i++) {
      if (offset >= bytes.length) throw new Error('Truncated CRX3 varint');
      const byte = bytes[offset++];
      value += (byte & 127) * factor;
      if (!(byte & 128)) return value;
      factor *= 128;
    }
    throw new Error('Oversized CRX3 varint');
  }
  while (offset < bytes.length) {
    const tag = varint();
    const number = Math.floor(tag / 8);
    if (number < 1 || tag % 8 !== 2)
      throw new Error('Unsupported CRX3 wire field');
    const length = varint();
    if (length > bytes.length - offset) throw new Error('Truncated CRX3 field');
    const values = output.get(number) || [];
    if (values.length >= 16) throw new Error('CRX3 field bound exceeded');
    values.push(bytes.subarray(offset, offset + length));
    output.set(number, values);
    offset += length;
  }
  return output;
}

function one(values, number) {
  const matches = values.get(number) || [];
  if (matches.length !== 1) throw new Error('Missing or duplicate CRX3 field');
  return matches[0];
}

function inspectCrx(bytes, expectedSha256, expectedExtensionId) {
  if (
    !/^[a-f0-9]{64}$/.test(expectedSha256 || '') ||
    !/^[a-p]{32}$/.test(expectedExtensionId || '')
  )
    throw new Error('Pin the CRX SHA256 and extension id');
  if (
    bytes.length < 16 ||
    bytes.length > 64 * 1024 * 1024 ||
    hash(bytes) !== expectedSha256
  )
    throw new Error('CRX size or SHA256 mismatch');
  if (
    bytes.subarray(0, 4).toString('ascii') !== 'Cr24' ||
    bytes.readUInt32LE(4) !== 3
  )
    throw new Error('Expected CRX3');
  const headerBytes = bytes.readUInt32LE(8);
  if (
    headerBytes < 1 ||
    headerBytes > 1024 * 1024 ||
    headerBytes >= bytes.length - 12
  )
    throw new Error('CRX3 header size refused');
  const zipOffset = 12 + headerBytes;
  const zip = bytes.subarray(zipOffset);
  if (!zip.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])))
    throw new Error('CRX3 ZIP prefix missing');
  const header = fields(bytes.subarray(12, zipOffset));
  const signedHeader = one(header, 10000);
  const id = one(fields(signedHeader), 1);
  if (id.length !== 16) throw new Error('Invalid CRX3 id length');
  const extensionId = id
    .toString('hex')
    .replace(/[a-f0-9]/g, (digit) =>
      String.fromCharCode(97 + parseInt(digit, 16))
    );
  if (extensionId !== expectedExtensionId)
    throw new Error('CRX3 extension id mismatch');
  const size = Buffer.alloc(4);
  size.writeUInt32LE(signedHeader.length);
  const signedBytes = Buffer.concat([
    Buffer.from('CRX3 SignedData\0', 'ascii'),
    size,
    signedHeader,
    zip,
  ]);
  const proofs = [];
  let publisherProof = false;
  for (const number of [2, 3]) {
    for (const encoded of header.get(number) || []) {
      const proof = fields(encoded);
      const publicKey = one(proof, 1);
      const signature = one(proof, 2);
      const key = crypto.createPublicKey({
        key: publicKey,
        format: 'der',
        type: 'spki',
      });
      const rsa = number === 2;
      if (key.asymmetricKeyType !== (rsa ? 'rsa' : 'ec'))
        throw new Error('CRX3 signature key type mismatch');
      const valid = crypto.verify(
        'sha256',
        signedBytes,
        {
          key,
          ...(rsa ? { padding: crypto.constants.RSA_PKCS1_PADDING } : {}),
        },
        signature
      );
      if (!valid) throw new Error('Invalid CRX3 signature');
      const keySha256 = hash(publicKey);
      const publisher = keySha256.slice(0, 32) === id.toString('hex');
      publisherProof ||= publisher;
      proofs.push({
        algorithm: rsa ? 'RSA-PKCS1-SHA256' : 'ECDSA-SHA256',
        publicKeySha256: keySha256,
        signatureVerified: valid,
        publisherIdBound: publisher,
      });
    }
  }
  if (!proofs.length || !publisherProof)
    throw new Error('CRX3 publisher proof missing');
  return {
    zip,
    evidence: {
      schema: 'pali-store-upgrade-crx3-artifact-v1',
      crxSha256: hash(bytes),
      crxBytes: bytes.length,
      extensionId,
      crxVersion: 3,
      zipOffset,
      zipSha256: hash(zip),
      zipBytes: zip.length,
      allHeaderProofsVerified: true,
      publisherPublicKeyBoundToExtensionId: true,
      proofs,
      zipPayloadUnmodified: true,
      googleWebStoreVerifierKeyPinClaimed: false,
      extensionInstalledOrPublished: false,
    },
  };
}

if (require.main === module) {
  const [input, output, expectedSha256, extensionId] = process.argv.slice(2);
  if (!input || !output || !path.isAbsolute(input) || !path.isAbsolute(output))
    throw new Error(
      'Usage: node prepare-store-upgrade-artifact.cjs /absolute/input.crx /absolute/output.zip <CRX-SHA256> <extension-id>'
    );
  const result = inspectCrx(
    fs.readFileSync(input),
    expectedSha256,
    extensionId
  );
  fs.writeFileSync(output, result.zip, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(result.evidence, null, 2));
}

module.exports = { inspectCrx };
