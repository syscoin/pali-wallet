export const P256_ORDER = BigInt(
  '0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'
);

const SCALAR_BYTES = 32;
const invalid = () => new Error('Invalid P-256 DER signature');

/** Convert a canonical ES256 DER signature to the fixed-width WebCrypto r || s. */
export function parseP256DerSignature(
  signature: Uint8Array
): Uint8Array<ArrayBuffer> {
  // Two short-form INTEGERs of up to 33 bytes fit a short-form SEQUENCE.
  if (
    signature.length < 8 ||
    signature.length > 72 ||
    signature[0] !== 0x30 ||
    signature[1] !== signature.length - 2
  )
    throw invalid();

  const raw = new Uint8Array(2 * SCALAR_BYTES);
  const readInteger = (tag: number, output: number) => {
    const size = signature[tag + 1] ?? 0;
    const start = tag + 2;
    const end = start + size;
    const first = signature[start] ?? 0;
    if (
      signature[tag] !== 0x02 ||
      size < 1 ||
      size > SCALAR_BYTES + 1 ||
      end > signature.length ||
      first >= 0x80 ||
      (size > 1 && first === 0 && (signature[start + 1] ?? 0) < 0x80)
    )
      throw invalid();

    const magnitude = signature.subarray(start + (first === 0 ? 1 : 0), end);
    if (magnitude.length > SCALAR_BYTES) throw invalid();
    let value = BigInt(0);
    for (const byte of magnitude) value = (value << BigInt(8)) | BigInt(byte);
    if (value === BigInt(0) || value >= P256_ORDER) throw invalid();
    raw.set(magnitude, output + SCALAR_BYTES - magnitude.length);
    return end;
  };

  try {
    const next = readInteger(2, 0);
    if (readInteger(next, SCALAR_BYTES) !== signature.length) throw invalid();
    return raw;
  } catch (error) {
    raw.fill(0);
    throw error;
  }
}
