import { getAddress } from 'ethers/address';

export type EvmObservationRequest = Readonly<{
  chainId: string;
  from: string;
  hash: string;
  nonce: string;
  to: string | null;
}>;
export type EvmTransactionObservation = Readonly<
  | {
      block: Readonly<{ hash: string; number: string }>;
      /** Actual outer transaction fee paid by from, not UserOperation actualGasCost. */
      feeUnits?: string;
      outcome: 'confirmed' | 'reverted';
      status: 'mined';
      transactionIndex?: number;
    }
  | { latestNonce: string; status: 'missing' }
>;
export type EvmObservationMethod =
  | 'eth_chainId'
  | 'eth_getTransactionReceipt'
  | 'eth_getTransactionCount'
  | 'eth_getBlockByNumber';

export function getObservedEvmTerminalPhase(
  observation: EvmTransactionObservation,
  nonce: number | string
) {
  return observation.status === 'mined'
    ? observation.outcome
    : BigInt(observation.latestNonce) > BigInt(nonce)
    ? ('nonce-consumed' as const)
    : null;
}
export class EvmObservationError extends Error {
  readonly code: 'INVALID_INPUT' | 'INVALID_RESPONSE' | 'CONTEXT_CHANGED';
  constructor(code: EvmObservationError['code']) {
    super(code);
    this.code = code;
    this.name = 'EvmObservationError';
  }
}
const invalid = (): never => {
  throw new EvmObservationError('INVALID_RESPONSE');
};
const hash = (value: unknown): string =>
  typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value)
    ? value.toLowerCase()
    : invalid();
const quantity = (value: unknown): bigint =>
  typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value)
    ? BigInt(value)
    : invalid();
export { hash as readEvmRpcHash, quantity as readEvmRpcQuantity };
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();

/** Optional receipt display fields; present values must fit the native unit domain. */
export function readEvmReceiptFeeUnits(
  value: unknown,
  chainId: string
): string | null {
  const receipt = object(value);
  if (receipt.gasUsed === undefined || receipt.effectiveGasPrice === undefined)
    return null;
  let fee = quantity(receipt.gasUsed) * quantity(receipt.effectiveGasPrice);
  const blobReceipt =
    receipt.type !== undefined && quantity(receipt.type) === BigInt(3);
  if (
    blobReceipt ||
    receipt.blobGasUsed !== undefined ||
    receipt.blobGasPrice !== undefined
  ) {
    // Blob gas is charged independently of execution, including reverted calls.
    if (!blobReceipt) return null;
    try {
      const used = quantity(receipt.blobGasUsed),
        price = quantity(receipt.blobGasPrice);
      if (
        used === BigInt(0) ||
        used % BigInt(131072) !== BigInt(0) ||
        price === BigInt(0)
      )
        return null;
      fee += used * price;
    } catch {
      return null;
    }
  }
  if (chainId === '8453' || chainId === '84532') {
    // Base receipts expose the L1 data charge separately from execution gas.
    // A receipt with an operator charge needs a fork-aware total.
    try {
      if (
        quantity(receipt.operatorFeeScalar ?? '0x0') !== BigInt(0) ||
        quantity(receipt.operatorFeeConstant ?? '0x0') !== BigInt(0)
      )
        return null;
      fee += quantity(receipt.l1Fee);
      if (fee >= BigInt(1) << BigInt(256)) return null;
    } catch {
      return null;
    }
  }
  if (fee >= BigInt(1) << BigInt(256)) invalid();
  return fee.toString();
}

/** Correlate already-fetched raw or ethers-normalized receipt observations. */
const normalizedQuantity = (input: unknown) =>
  typeof input === 'bigint' ||
  (typeof input === 'number' && Number.isSafeInteger(input) && input >= 0)
    ? quantity(`0x${BigInt(input).toString(16)}`)
    : quantity(input);
type ReceiptIdentity = {
  blockHash?: unknown;
  blockNumber?: unknown;
  from: string;
  hash: string;
  to: string | null;
};
export function assertEvmReceiptIdentity(
  expected: ReceiptIdentity,
  value: unknown
) {
  const receipt = object(value);
  try {
    if (
      hash(receipt.transactionHash ?? receipt.hash) !== hash(expected.hash) ||
      getAddress(receipt.from as string) !== getAddress(expected.from) ||
      (receipt.to === null ? null : getAddress(receipt.to as string)) !==
        (expected.to === null ? null : getAddress(expected.to))
    )
      invalid();
  } catch {
    invalid();
  }
}
export function assertEvmReceiptCoherence(
  expected: ReceiptIdentity,
  value: unknown,
  header: unknown
) {
  const receipt = object(value),
    block = object(header);
  assertEvmReceiptIdentity(expected, receipt);
  try {
    const number = normalizedQuantity(receipt.blockNumber),
      blockHash = hash(receipt.blockHash);
    const status = normalizedQuantity(receipt.status);
    if (status !== BigInt(0) && status !== BigInt(1)) invalid();
    if (
      normalizedQuantity(block.number) !== number ||
      hash(block.hash) !== blockHash ||
      (expected.blockNumber !== undefined &&
        normalizedQuantity(expected.blockNumber) !== number) ||
      (expected.blockHash !== undefined &&
        hash(expected.blockHash) !== blockHash)
    )
      invalid();
    return { number, blockHash, status };
  } catch {
    return invalid();
  }
}

/** One ordinary canonical-receipt observation, shared by both host transports. */
export async function observeEvmTransaction(
  expected: EvmObservationRequest,
  read: (
    method: EvmObservationMethod,
    params: readonly unknown[]
  ) => Promise<unknown>,
  assertCurrent: () => void
): Promise<EvmTransactionObservation> {
  assertCurrent();
  const fields = ['chainId', 'hash', 'from', 'to', 'nonce'];
  if (
    !expected ||
    typeof expected !== 'object' ||
    Array.isArray(expected) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(expected))
  )
    throw new EvmObservationError('INVALID_INPUT');
  const keys = Reflect.ownKeys(expected);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    throw new EvmObservationError('INVALID_INPUT');
  const input: Record<string, any> = Object.create(null);
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(expected, key);
    if (!descriptor?.enumerable || !('value' in descriptor))
      throw new EvmObservationError('INVALID_INPUT');
    input[key] = descriptor.value;
  }
  Object.freeze(input);
  if (
    !/^[1-9][0-9]{0,77}$/.test(input.chainId) ||
    !/^(0|[1-9][0-9]{0,77})$/.test(input.nonce)
  )
    throw new EvmObservationError('INVALID_INPUT');
  const chain = BigInt(input.chainId),
    nonce = BigInt(input.nonce),
    wantedHash = hash(input.hash);
  let from: string, to: string | null;
  try {
    from = getAddress(input.from);
    to = input.to === null ? null : getAddress(input.to);
  } catch {
    throw new EvmObservationError('INVALID_INPUT');
  }
  const call = async (
    method: EvmObservationMethod,
    params: readonly unknown[]
  ) => {
    assertCurrent();
    const result = await read(method, params);
    assertCurrent();
    return result;
  };
  const checkChain = async () => {
    if (quantity(await call('eth_chainId', [])) !== chain)
      throw new EvmObservationError('CONTEXT_CHANGED');
  };
  await checkChain();
  const value = await call('eth_getTransactionReceipt', [wantedHash]);
  if (value === null) {
    const latestNonce = quantity(
      await call('eth_getTransactionCount', [from, 'latest'])
    );
    await checkChain();
    return Object.freeze({
      status: 'missing',
      latestNonce: latestNonce.toString(),
    });
  }
  const receipt = object(value);
  assertEvmReceiptIdentity({ hash: wantedHash, from, to }, receipt);
  const status = quantity(receipt.status),
    number = quantity(receipt.blockNumber),
    blockHash = hash(receipt.blockHash);
  if (status !== BigInt(0) && status !== BigInt(1)) invalid();
  const block = object(
    await call('eth_getBlockByNumber', [`0x${number.toString(16)}`, false])
  );
  quantity(block.gasLimit);
  if (block.baseFeePerGas !== undefined && block.baseFeePerGas !== null)
    quantity(block.baseFeePerGas);
  if (quantity(block.number) !== number || hash(block.hash) !== blockHash)
    throw new EvmObservationError('CONTEXT_CHANGED');
  // An ordinary receipt remains displayable when the provider omits its
  // transaction index or the block's transaction list. Changing other saved
  // transactions requires their competing hash to be located in that block.
  const rawIndex = receipt.transactionIndex;
  let transactionIndex: number | undefined;
  if (
    typeof rawIndex === 'string' &&
    /^0x(?:0|[1-9a-f][0-9a-f]{0,13})$/i.test(rawIndex) &&
    Array.isArray(block.transactions)
  ) {
    const index = Number(BigInt(rawIndex));
    if (Number.isSafeInteger(index) && index < block.transactions.length) {
      const transactionHash = block.transactions[index];
      if (
        typeof transactionHash === 'string' &&
        transactionHash.toLowerCase() === wantedHash
      )
        transactionIndex = index;
    }
  }
  await checkChain();
  // Reading a receipt does not prove another hash with this nonce succeeded.
  void nonce;
  let feeUnits: string | undefined;
  try {
    feeUnits = readEvmReceiptFeeUnits(receipt, input.chainId) ?? undefined;
  } catch {
    /* Optional display metadata cannot invalidate the canonical outcome. */
  }
  return Object.freeze({
    status: 'mined',
    outcome: status === BigInt(1) ? 'confirmed' : 'reverted',
    block: Object.freeze({ number: number.toString(), hash: blockHash }),
    ...(feeUnits === undefined ? {} : { feeUnits }),
    ...(transactionIndex === undefined ? {} : { transactionIndex }),
  });
}
