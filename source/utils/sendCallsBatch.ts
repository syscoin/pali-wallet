// ---------------------------------------------------------------------------
// EIP-5792 wallet_sendCalls batch identifiers.
//
// Pali encodes everything wallet_getCallsStatus needs directly into the
// returned bundle id, so status lookups are stateless and survive MV3
// service-worker restarts (no in-memory bundle map to evict or lose). The id
// is an opaque hex string from the dapp's perspective, as the spec allows.
//
// Layout (big-endian hex):
//   byte 0        version (0x01)
//   byte 1        flags: bit0 = atomic, bit1 = smart-account batch
//   bytes 2..33   chainId (uint256)
//   bytes 34..    one or more 32-byte transaction hashes
//
// Implemented with plain string/number ops (no ethers helpers) so it is
// independent of the global @ethersproject/bytes test mock and usable from any
// runtime context.
// ---------------------------------------------------------------------------

const BATCH_ID_VERSION = 1;
const ATOMIC_FLAG = 0x01;
const SMART_ACCOUNT_FLAG = 0x02;
const CHAIN_ID_HEX_CHARS = 64;
const TX_HASH_HEX_CHARS = 64;
const HEADER_HEX_CHARS = 4 + CHAIN_ID_HEX_CHARS; // version + flags + chainId

// EIP-5792 call-status codes.
export const CALLS_STATUS_PENDING = 100;
export const CALLS_STATUS_CONFIRMED = 200;
export const CALLS_STATUS_REVERTED = 500;
export const CALLS_STATUS_PARTIALLY_REVERTED = 600;

export interface ISendCallsBatchDescriptor {
  atomic: boolean;
  chainId: number;
  smartAccount: boolean;
  txHashes: string[];
}

const byteHex = (value: number): string =>
  (value & 0xff).toString(16).padStart(2, '0');

const stripHexPrefix = (value: string): string =>
  value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;

const isHexString = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value);

export const encodeSendCallsBatchId = ({
  atomic,
  chainId,
  smartAccount,
  txHashes,
}: ISendCallsBatchDescriptor): string => {
  if (txHashes.length === 0) {
    throw new Error('Cannot encode a batch id without transaction hashes.');
  }
  const flags =
    (atomic ? ATOMIC_FLAG : 0) | (smartAccount ? SMART_ACCOUNT_FLAG : 0);
  const chainIdHex = BigInt(chainId)
    .toString(16)
    .padStart(CHAIN_ID_HEX_CHARS, '0');
  const txHex = txHashes
    .map((hash) => {
      const normalized = stripHexPrefix(hash).toLowerCase();
      if (normalized.length !== TX_HASH_HEX_CHARS) {
        throw new Error(`Invalid transaction hash in batch id: ${hash}`);
      }
      return normalized;
    })
    .join('');
  return `0x${byteHex(BATCH_ID_VERSION)}${byteHex(flags)}${chainIdHex}${txHex}`;
};

// Returns null when the id was not produced by Pali (e.g. an id minted by a
// different wallet); the caller maps that to the EIP-5792 "unknown bundle"
// error rather than guessing.
export const decodeSendCallsBatchId = (
  id: string
): ISendCallsBatchDescriptor | null => {
  if (!isHexString(id)) {
    return null;
  }
  const body = stripHexPrefix(id);
  if (
    body.length <= HEADER_HEX_CHARS ||
    (body.length - HEADER_HEX_CHARS) % TX_HASH_HEX_CHARS !== 0
  ) {
    return null;
  }
  if (parseInt(body.slice(0, 2), 16) !== BATCH_ID_VERSION) {
    return null;
  }
  const flags = parseInt(body.slice(2, 4), 16);
  const chainId = Number(BigInt(`0x${body.slice(4, HEADER_HEX_CHARS)}`));
  const txHashes: string[] = [];
  for (
    let offset = HEADER_HEX_CHARS;
    offset < body.length;
    offset += TX_HASH_HEX_CHARS
  ) {
    txHashes.push(`0x${body.slice(offset, offset + TX_HASH_HEX_CHARS)}`);
  }
  return {
    atomic: (flags & ATOMIC_FLAG) === ATOMIC_FLAG,
    chainId,
    smartAccount: (flags & SMART_ACCOUNT_FLAG) === SMART_ACCOUNT_FLAG,
    txHashes,
  };
};

export interface ICallsStatusInputs {
  atomic: boolean;
  // One entry per encoded transaction hash, ordered; null = not yet mined.
  receiptStatuses: Array<'0x0' | '0x1' | null>;
  smartAccount: boolean;
  // For smart-account atomic batches the outer handleOps transaction mines
  // successfully even when the inner user operation reverts, so the inner
  // UserOperationEvent.success flag is the source of truth. Undefined when it
  // could not be determined (treated as inconclusive -> not yet confirmed).
  smartAccountInnerSuccess?: boolean;
}

// Maps mined/unmined receipt state to an EIP-5792 status code.
export const computeCallsStatusCode = ({
  atomic,
  receiptStatuses,
  smartAccount,
  smartAccountInnerSuccess,
}: ICallsStatusInputs): number => {
  if (receiptStatuses.length === 0 || receiptStatuses.some((s) => s === null)) {
    return CALLS_STATUS_PENDING;
  }

  if (smartAccount && atomic) {
    // Outer tx mined; the batch outcome is the inner user-operation outcome.
    if (smartAccountInnerSuccess === undefined) {
      return CALLS_STATUS_PENDING;
    }
    return smartAccountInnerSuccess
      ? CALLS_STATUS_CONFIRMED
      : CALLS_STATUS_REVERTED;
  }

  const succeeded = receiptStatuses.filter((s) => s === '0x1').length;
  if (succeeded === receiptStatuses.length) {
    return CALLS_STATUS_CONFIRMED;
  }
  if (succeeded === 0) {
    return CALLS_STATUS_REVERTED;
  }
  // A partially-applied batch is only reachable when atomicity was not
  // required; an atomic batch is all-or-nothing.
  return atomic ? CALLS_STATUS_REVERTED : CALLS_STATUS_PARTIALLY_REVERTED;
};
