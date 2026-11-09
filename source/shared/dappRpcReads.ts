import { EthereumRpcErrorHandler } from '../helpers/errors/errorClassesHandlers.ts';
import { normalizeNftTokenId } from '../utils/nftTokenId.ts';
import { assertProviderRequestBudget } from '../utils/requestPayloadBudget.ts';

/** Stateless methods already classified as public ETH reads by the extension registry. */
export const DAPP_RPC_READ_METHODS = Object.freeze([
  'eth_blockNumber',
  'eth_gasPrice',
  'eth_protocolVersion',
  'eth_syncing',
  'eth_getBalance',
  'eth_getCode',
  'eth_getTransactionCount',
  'eth_getStorageAt',
  'eth_call',
  'eth_estimateGas',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getBlockTransactionCountByNumber',
  'eth_getBlockTransactionCountByHash',
  'eth_getTransactionByBlockNumberAndIndex',
  'eth_getTransactionByBlockHashAndIndex',
  'eth_getUncleCountByBlockNumber',
  'eth_getUncleCountByBlockHash',
  'eth_getUncleByBlockNumberAndIndex',
  'eth_getUncleByBlockHashAndIndex',
  'eth_feeHistory',
] as const);
export type DappRpcReadMethod = (typeof DAPP_RPC_READ_METHODS)[number];
export type DappRpcReadRequest = Readonly<{
  method: DappRpcReadMethod;
  params: readonly unknown[];
}>;
export const isDappRpcReadMethod = (
  method: string
): method is DappRpcReadMethod =>
  (DAPP_RPC_READ_METHODS as readonly string[]).includes(method);
const invalid = (): never => {
  throw new EthereumRpcErrorHandler(-32602, 'Invalid RPC read parameters');
};
const address = (value: unknown) =>
  typeof value === 'string' && /^0x[\da-f]{40}$/i.test(value)
    ? `0x${value.slice(2)}`
    : invalid();
const hash = (value: unknown) =>
  typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value)
    ? `0x${value.slice(2)}`
    : invalid();
const quantity = (value: unknown) => {
  try {
    return `0x${BigInt(normalizeNftTokenId(value)).toString(16)}`;
  } catch {
    return invalid();
  }
};
const bytes = (value: unknown) =>
  typeof value === 'string' && /^0x(?:[\da-f]{2})*$/i.test(value)
    ? `0x${value.slice(2)}`
    : invalid();
const object = (value: unknown, fields: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  if (Object.keys(value).some((key) => !fields.includes(key))) return invalid();
  return value as Record<string, unknown>;
};
const list = (value: unknown, normalize: (item: unknown) => unknown) =>
  Array.isArray(value) ? value.map(normalize) : invalid();
const byteQuantity = (value: unknown) => {
  const normalized = quantity(value);
  return BigInt(normalized) <= BigInt(255) ? normalized : invalid();
};
const SIMULATION_QUANTITIES = [
  'gas',
  'gasLimit',
  'gasPrice',
  'maxFeePerGas',
  'maxPriorityFeePerGas',
  'maxFeePerBlobGas',
  'value',
  'nonce',
  'chainId',
] as const;
// Read-only execution belongs to the node, not the wallet's signing policy.
// Validate bounded RPC shapes without restricting transaction types or fees.
function simulation(input: unknown) {
  const tx = object(input, [
    ...SIMULATION_QUANTITIES,
    'from',
    'to',
    'data',
    'input',
    'type',
    'accessList',
    'blobVersionedHashes',
    'blobs',
    'commitments',
    'proofs',
    'authorizationList',
  ]);
  for (const field of SIMULATION_QUANTITIES)
    if (tx[field] !== undefined) tx[field] = quantity(tx[field]);
  if (tx.type !== undefined) tx.type = byteQuantity(tx.type);
  if (tx.from !== undefined) tx.from = address(tx.from);
  if (tx.to !== undefined && tx.to !== null) tx.to = address(tx.to);
  for (const field of ['data', 'input'])
    if (tx[field] !== undefined) tx[field] = bytes(tx[field]);
  if (
    tx.data !== undefined &&
    tx.input !== undefined &&
    (tx.data as string).toLowerCase() !== (tx.input as string).toLowerCase()
  )
    return invalid();
  tx.data = tx.data ?? tx.input ?? '0x';
  delete tx.input;
  if (tx.gasLimit !== undefined) {
    if (tx.gas !== undefined && tx.gas !== tx.gasLimit) return invalid();
    tx.gas = tx.gasLimit;
    delete tx.gasLimit;
  }
  if (tx.accessList !== undefined)
    tx.accessList = list(tx.accessList, (value) => {
      const entry = object(value, ['address', 'storageKeys']);
      return {
        address: address(entry.address),
        storageKeys: list(entry.storageKeys, hash),
      };
    });
  if (tx.blobVersionedHashes !== undefined)
    tx.blobVersionedHashes = list(tx.blobVersionedHashes, hash);
  for (const field of ['blobs', 'commitments', 'proofs'])
    if (tx[field] !== undefined) tx[field] = list(tx[field], bytes);
  if (tx.authorizationList !== undefined)
    tx.authorizationList = list(tx.authorizationList, (value) => {
      const entry = object(value, [
        'chainId',
        'address',
        'nonce',
        'yParity',
        'r',
        's',
      ]);
      return {
        chainId: quantity(entry.chainId),
        address: address(entry.address),
        nonce: quantity(entry.nonce),
        yParity: byteQuantity(entry.yParity),
        r: quantity(entry.r),
        s: quantity(entry.s),
      };
    });
  return tx;
}
function blockNumber(value: unknown): unknown {
  return typeof value === 'number' || typeof value === 'string'
    ? block(value)
    : invalid();
}
function block(value: unknown): unknown {
  if (typeof value === 'number') return quantity(value);
  if (typeof value === 'string')
    return /^(?:latest|earliest|pending|safe|finalized)$/i.test(value)
      ? value.toLowerCase()
      : quantity(value);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  const item = value as Record<string, unknown>;
  if (
    Object.hasOwn(item, 'blockHash') &&
    Object.keys(item).every(
      (key) => key === 'blockHash' || key === 'requireCanonical'
    ) &&
    (item.requireCanonical === undefined ||
      typeof item.requireCanonical === 'boolean')
  )
    return {
      blockHash: hash(item.blockHash),
      ...(item.requireCanonical !== undefined
        ? { requireCanonical: item.requireCanonical }
        : {}),
    };
  if (Object.keys(item).length === 1 && Object.hasOwn(item, 'blockNumber'))
    return { blockNumber: quantity(item.blockNumber) };
  return invalid();
}
/** A bounded detached request, never an arbitrary provider method or signed payload. */
export function normalizeDappRpcRead(
  method: string,
  input: unknown
): DappRpcReadRequest {
  if (!isDappRpcReadMethod(method))
    throw new EthereumRpcErrorHandler(4200, 'Unsupported RPC read method');
  assertProviderRequestBudget({ method, params: input });
  const values = input === undefined ? [] : input;
  if (!Array.isArray(values)) return invalid();
  const params = JSON.parse(JSON.stringify(values)) as unknown[];
  const length = (minimum: number, maximum = minimum) => {
    if (params.length < minimum || params.length > maximum) invalid();
  };
  if (
    [
      'eth_blockNumber',
      'eth_gasPrice',
      'eth_protocolVersion',
      'eth_syncing',
    ].includes(method)
  )
    length(0);
  else if (
    ['eth_getBalance', 'eth_getCode', 'eth_getTransactionCount'].includes(
      method
    )
  ) {
    length(1, 2);
    params[0] = address(params[0]);
    params[1] = block(params[1] ?? 'latest');
  } else if (method === 'eth_getStorageAt') {
    length(2, 3);
    params[0] = address(params[0]);
    params[1] = quantity(params[1]);
    params[2] = block(params[2] ?? 'latest');
  } else if (method === 'eth_call' || method === 'eth_estimateGas') {
    length(1, 2);
    params[0] = simulation(params[0]);
    if (params.length === 2 || method === 'eth_call')
      params[1] = block(params[1] ?? 'latest');
  } else if (method === 'eth_feeHistory') {
    length(2, 3);
    params[0] = quantity(params[0]);
    if (
      BigInt(params[0] as string) < BigInt(1) ||
      BigInt(params[0] as string) > BigInt(1024)
    )
      return invalid();
    params[1] = blockNumber(params[1]);
    if (
      params[2] !== undefined &&
      (!Array.isArray(params[2]) ||
        params[2].length > 100 ||
        params[2].some(
          (value, index, all) =>
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 0 ||
            value > 100 ||
            (index > 0 && value < all[index - 1])
        ))
    )
      return invalid();
  } else if (
    method === 'eth_getTransactionReceipt' ||
    method === 'eth_getTransactionByHash'
  ) {
    length(1);
    const value = params[0];
    params[0] = hash(
      method === 'eth_getTransactionReceipt' &&
        value &&
        typeof value === 'object'
        ? (value as { hash?: unknown }).hash
        : value
    );
  } else if (
    method === 'eth_getBlockByNumber' ||
    method === 'eth_getBlockByHash'
  ) {
    length(2);
    params[0] =
      method === 'eth_getBlockByHash'
        ? hash(params[0])
        : blockNumber(params[0]);
    if (typeof params[1] !== 'boolean') return invalid();
  } else {
    const withIndex = method.includes('AndIndex');
    length(withIndex ? 2 : 1);
    params[0] =
      method.includes('BlockHash') || method.endsWith('ByHash')
        ? hash(params[0])
        : blockNumber(params[0]);
    if (withIndex) params[1] = quantity(params[1]);
  }
  return Object.freeze({ method, params: Object.freeze(params) });
}
