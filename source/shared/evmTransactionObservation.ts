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
      outcome: 'confirmed' | 'reverted';
      status: 'mined';
    }
  | { latestNonce: string; status: 'missing' }
>;
export type EvmObservationMethod =
  | 'eth_chainId'
  | 'eth_getTransactionReceipt'
  | 'eth_getTransactionCount'
  | 'eth_getBlockByNumber';
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
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();

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
  try {
    if (
      hash(receipt.transactionHash) !== wantedHash ||
      getAddress(receipt.from as string) !== from ||
      (receipt.to === null ? null : getAddress(receipt.to as string)) !== to
    )
      invalid();
  } catch {
    invalid();
  }
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
  await checkChain();
  // Reading a receipt does not prove another hash with this nonce succeeded.
  void nonce;
  return Object.freeze({
    status: 'mined',
    outcome: status === BigInt(1) ? 'confirmed' : 'reverted',
    block: Object.freeze({ number: number.toString(), hash: blockHash }),
  });
}
