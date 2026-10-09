import {
  assertJsonWorkBudget,
  payloadBudgetError,
} from './requestPayloadBudget';

export const PSBT_WORK_LIMITS = {
  bytes: 512 * 1024,
  inputs: 200,
  outputs: 200,
  keyValues: 4096,
  metadataBytes: 64 * 1024,
} as const;

/** Linear preflight, before the full PSBT parser allocates maps/transactions. */
export const assertPsbtWorkBudget = (data: any): void => {
  if (!data || typeof data.psbt !== 'string') return; // Normal shape validation follows.
  if (data.psbt.length > Math.ceil(PSBT_WORK_LIMITS.bytes / 3) * 4) {
    throw payloadBudgetError('maximum 512 KiB decoded PSBT');
  }
  if (typeof data.assets === 'string') {
    assertJsonWorkBudget(data.assets, PSBT_WORK_LIMITS.metadataBytes);
    let assets: any;
    try {
      assets = JSON.parse(data.assets);
    } catch {
      throw payloadBudgetError('invalid PSBT metadata JSON');
    }
    assertJsonWorkBudget(assets, PSBT_WORK_LIMITS.metadataBytes);
  }
  let binary: string;
  try {
    binary = atob(data.psbt);
  } catch {
    throw payloadBudgetError('invalid PSBT encoding');
  }
  if (binary.length > PSBT_WORK_LIMITS.bytes) {
    throw payloadBudgetError('maximum 512 KiB decoded PSBT');
  }
  let offset = 0;
  const malformed = () => payloadBudgetError('invalid PSBT framing');
  const byte = () => {
    if (offset >= binary.length) throw malformed();
    return binary.charCodeAt(offset++);
  };
  const skip = (length: number) => {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > binary.length - offset
    ) {
      throw malformed();
    }
    offset += length;
  };
  const compactSize = () => {
    const first = byte();
    if (first < 253) return first;
    const width = first === 253 ? 2 : first === 254 ? 4 : 8;
    let value = 0;
    for (let i = 0; i < width; i++) value += byte() * 2 ** (8 * i);
    if (!Number.isSafeInteger(value)) throw malformed();
    return value;
  };
  const transactionCounts = (start: number, length: number) => {
    const end = start + length;
    offset = start;
    skip(4);
    const inputs = compactSize();
    if (inputs > PSBT_WORK_LIMITS.inputs)
      throw payloadBudgetError('maximum 200 PSBT inputs');
    for (let i = 0; i < inputs; i++) {
      skip(36);
      skip(compactSize());
      skip(4);
      if (offset > end) throw malformed();
    }
    const outputs = compactSize();
    if (outputs > PSBT_WORK_LIMITS.outputs)
      throw payloadBudgetError('maximum 200 PSBT outputs');
    for (let i = 0; i < outputs; i++) {
      skip(8);
      skip(compactSize());
      if (offset > end) throw malformed();
    }
    skip(4);
    if (offset !== end) throw malformed();
    return { inputs, outputs };
  };

  if (
    byte() !== 0x70 ||
    byte() !== 0x73 ||
    byte() !== 0x62 ||
    byte() !== 0x74 ||
    byte() !== 0xff
  ) {
    throw malformed();
  }
  let pairs = 0;
  let transaction: { length: number; start: number } | undefined;
  const readMap = (global: boolean) => {
    while (true) {
      const keyLength = compactSize();
      if (keyLength === 0) return;
      if (++pairs > PSBT_WORK_LIMITS.keyValues) {
        throw payloadBudgetError('maximum 4096 PSBT key/value pairs');
      }
      const keyType = byte();
      skip(keyLength - 1);
      const length = compactSize();
      const start = offset;
      skip(length);
      if (global && keyType === 0) {
        if (transaction || keyLength !== 1) throw malformed();
        transaction = { start, length };
      }
    }
  };
  readMap(true);
  if (!transaction) throw malformed();
  const mapStart = offset;
  const { inputs, outputs } = transactionCounts(
    transaction.start,
    transaction.length
  );
  offset = mapStart;
  for (let i = 0; i < inputs + outputs; i++) readMap(false);
  if (offset !== binary.length) throw malformed();
};
