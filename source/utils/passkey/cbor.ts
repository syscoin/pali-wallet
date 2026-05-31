type CborMap = Map<string | number, CborValue>;
type CborValue = CborMap | Uint8Array | string | number | boolean | null;

type DecodeResult = {
  offset: number;
  value: CborValue;
};

const readLength = (data: Uint8Array, offset: number, additional: number) => {
  if (additional < 24) return { length: additional, offset };
  if (additional === 24) return { length: data[offset], offset: offset + 1 };
  if (additional === 25)
    return {
      length: (data[offset] << 8) | data[offset + 1],
      offset: offset + 2,
    };
  if (additional === 26) {
    return {
      length:
        (data[offset] * 0x1000000 +
          ((data[offset + 1] << 16) |
            (data[offset + 2] << 8) |
            data[offset + 3])) >>>
        0,
      offset: offset + 4,
    };
  }

  throw new Error('Unsupported CBOR length');
};

export const decodeCbor = (data: Uint8Array, offset = 0): DecodeResult => {
  const first = data[offset];
  const major = first >> 5;
  const additional = first & 0x1f;
  let cursor = offset + 1;

  if (major === 0) {
    const length = readLength(data, cursor, additional);
    return { value: length.length, offset: length.offset };
  }

  if (major === 1) {
    const length = readLength(data, cursor, additional);
    return { value: -1 - length.length, offset: length.offset };
  }

  if (major === 2) {
    const length = readLength(data, cursor, additional);
    cursor = length.offset;
    return {
      value: data.slice(cursor, cursor + length.length),
      offset: cursor + length.length,
    };
  }

  if (major === 3) {
    const length = readLength(data, cursor, additional);
    cursor = length.offset;
    const bytes = data.slice(cursor, cursor + length.length);
    return {
      value: new TextDecoder().decode(bytes),
      offset: cursor + length.length,
    };
  }

  if (major === 5) {
    const length = readLength(data, cursor, additional);
    cursor = length.offset;
    const map = new Map<string | number, CborValue>();

    for (let i = 0; i < length.length; i += 1) {
      const key = decodeCbor(data, cursor);
      cursor = key.offset;
      const value = decodeCbor(data, cursor);
      cursor = value.offset;

      if (typeof key.value !== 'string' && typeof key.value !== 'number') {
        throw new Error('Unsupported CBOR map key');
      }

      map.set(key.value, value.value);
    }

    return { value: map, offset: cursor };
  }

  if (major === 7) {
    if (additional === 20) return { value: false, offset: cursor };
    if (additional === 21) return { value: true, offset: cursor };
    if (additional === 22) return { value: null, offset: cursor };
  }

  throw new Error('Unsupported CBOR value');
};

export const asCborMap = (value: CborValue): CborMap => {
  if (!(value instanceof Map)) {
    throw new Error('Expected CBOR map');
  }

  return value;
};

export const asCborBytes = (value: CborValue): Uint8Array => {
  if (!(value instanceof Uint8Array)) {
    throw new Error('Expected CBOR byte string');
  }

  return value;
};
