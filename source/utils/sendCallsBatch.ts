// ---------------------------------------------------------------------------
// EIP-5792 wallet_sendCalls batch status helpers.
//
// Bundle ids themselves are opaque: wallet-minted ids are random 32-byte
// strings and all issued ids (wallet-minted or app-provided) are tracked in
// the per-host registry (scripts/Background/.../sendCallsBundles.ts), which
// is the single source of truth for status resolution.
// ---------------------------------------------------------------------------

// EIP-5792 call-status codes.
export const CALLS_STATUS_PENDING = 100;
export const CALLS_STATUS_CONFIRMED = 200;
export const CALLS_STATUS_OFFCHAIN_FAILURE = 400;
export const CALLS_STATUS_REVERTED = 500;
export const CALLS_STATUS_PARTIALLY_REVERTED = 600;

export interface ISendCallsBatchDescriptor {
  atomic: boolean;
  chainId: number;
  // True when at least one call in the batch failed before it could be
  // broadcast (e.g. an RPC send error in a non-atomic EOA batch), so the
  // recorded txHashes do not cover the whole batch.
  failed?: boolean;
  smartAccount: boolean;
  txHashes: string[];
}

export interface ICallsStatusInputs {
  atomic: boolean;
  // One entry per recorded transaction hash, ordered; null = not yet mined.
  receiptStatuses: Array<'0x0' | '0x1' | null>;
  smartAccount: boolean;
  // For smart-account atomic batches the outer handleOps transaction mines
  // successfully even when the inner user operation reverts, so the inner
  // UserOperationEvent.success flag is the source of truth. Undefined when it
  // could not be determined (treated as inconclusive -> not yet confirmed).
  smartAccountInnerSuccess?: boolean;
  // True when part of the batch failed before broadcast, so receiptStatuses
  // does not cover every call in the bundle.
  someCallsFailedToBroadcast?: boolean;
}

// Maps mined/unmined receipt state to an EIP-5792 status code.
export const computeCallsStatusCode = ({
  atomic,
  receiptStatuses,
  smartAccount,
  someCallsFailedToBroadcast,
  smartAccountInnerSuccess,
}: ICallsStatusInputs): number => {
  if (receiptStatuses.length === 0) {
    // Nothing was broadcast: offchain failure if the batch terminally failed,
    // otherwise still pending (approval popup in flight).
    return someCallsFailedToBroadcast
      ? CALLS_STATUS_OFFCHAIN_FAILURE
      : CALLS_STATUS_PENDING;
  }
  if (receiptStatuses.some((s) => s === null)) {
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
    // All broadcast txs succeeded, but if part of the batch never broadcast
    // the bundle as a whole was only partially applied.
    if (someCallsFailedToBroadcast) {
      return atomic ? CALLS_STATUS_REVERTED : CALLS_STATUS_PARTIALLY_REVERTED;
    }
    return CALLS_STATUS_CONFIRMED;
  }
  if (succeeded === 0) {
    return CALLS_STATUS_REVERTED;
  }
  // A partially-applied batch is only reachable when atomicity was not
  // required; an atomic batch is all-or-nothing.
  return atomic ? CALLS_STATUS_REVERTED : CALLS_STATUS_PARTIALLY_REVERTED;
};
