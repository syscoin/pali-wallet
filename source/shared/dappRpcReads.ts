import { getAddress } from 'ethers/address';

import { EthereumRpcErrorHandler } from '../helpers/errors/errorClassesHandlers.ts';
import { normalizeNftTokenId } from '../utils/nftTokenId.ts';
import {
  assertJsonWorkBudget,
  assertProviderRequestBudget,
} from '../utils/requestPayloadBudget.ts';

import { assertSynchronousEvmFeeGuard } from './evmFeeGuard.ts';

/** Exhaustive public provider policy, independent of any node's capabilities. */
export const DAPP_RPC_METHOD_CLASSIFICATION = Object.freeze({
  eth_blockNumber: 'node-query',
  eth_gasPrice: 'node-query',
  eth_protocolVersion: 'node-query',
  eth_syncing: 'node-query',
  eth_getBalance: 'node-query',
  eth_getCode: 'node-query',
  eth_getTransactionCount: 'node-query',
  eth_getStorageAt: 'node-query',
  eth_call: 'node-query',
  eth_estimateGas: 'node-query',
  eth_getTransactionReceipt: 'node-query',
  eth_getTransactionByHash: 'node-query',
  eth_getBlockByNumber: 'node-query',
  eth_getBlockByHash: 'node-query',
  eth_getBlockTransactionCountByNumber: 'node-query',
  eth_getBlockTransactionCountByHash: 'node-query',
  eth_getTransactionByBlockNumberAndIndex: 'node-query',
  eth_getTransactionByBlockHashAndIndex: 'node-query',
  eth_getUncleCountByBlockNumber: 'node-query',
  eth_getUncleCountByBlockHash: 'node-query',
  eth_getUncleByBlockNumberAndIndex: 'node-query',
  eth_getUncleByBlockHashAndIndex: 'node-query',
  eth_feeHistory: 'node-query',
  eth_getLogs: 'node-query',
  eth_getProof: 'node-query',
  web3_clientVersion: 'node-query',
  net_listening: 'node-query',
  net_peerCount: 'node-query',
  personal_ecRecover: 'local-verification',
  eth_coinbase: 'node-query',
  web3_sha3: 'node-query',
  eth_getFilterLogs: 'node-query',
  eth_getFilterChanges: 'node-control',
  eth_newBlockFilter: 'node-control',
  eth_newFilter: 'node-control',
  eth_newPendingTransactionFilter: 'node-control',
  eth_uninstallFilter: 'node-control',
  eth_getWork: 'node-query',
  eth_hashrate: 'node-query',
  eth_mining: 'node-query',
  eth_submitHashrate: 'node-control',
  eth_submitWork: 'node-control',
  eth_accounts: 'custom',
  eth_chainId: 'custom',
  net_version: 'custom',
  eth_subscribe: 'unsupported',
  eth_unsubscribe: 'unsupported',
} as const);
export type DappRpcMethodClassification =
  (typeof DAPP_RPC_METHOD_CLASSIFICATION)[keyof typeof DAPP_RPC_METHOD_CLASSIFICATION];
export type DappPublicRpcMethod = {
  [K in keyof typeof DAPP_RPC_METHOD_CLASSIFICATION]: (typeof DAPP_RPC_METHOD_CLASSIFICATION)[K] extends
    | 'custom'
    | 'unsupported'
    ? never
    : K;
}[keyof typeof DAPP_RPC_METHOD_CLASSIFICATION];
export function classifyDappRpcMethod(
  method: string
): DappRpcMethodClassification | null {
  return Object.hasOwn(DAPP_RPC_METHOD_CLASSIFICATION, method)
    ? DAPP_RPC_METHOD_CLASSIFICATION[
        method as keyof typeof DAPP_RPC_METHOD_CLASSIFICATION
      ]
    : null;
}
export const isDappPublicRpcMethod = (
  method: string
): method is DappPublicRpcMethod => {
  const classification = classifyDappRpcMethod(method);
  return (
    classification === 'node-query' ||
    classification === 'node-control' ||
    classification === 'local-verification'
  );
};
export const DAPP_PUBLIC_RPC_METHODS: readonly DappPublicRpcMethod[] =
  Object.freeze(
    Object.keys(DAPP_RPC_METHOD_CLASSIFICATION).filter(isDappPublicRpcMethod)
  );
export type DappPublicRpcRequest = Readonly<{
  method: DappPublicRpcMethod;
  params: readonly unknown[];
}>;
const invalid = (): never => {
  throw new EthereumRpcErrorHandler(-32602, 'Invalid public RPC parameters');
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
const miningRate = (value: unknown) =>
  typeof value === 'string' && (value === '' || /^0x[\da-f]*$/i.test(value))
    ? value
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
function logFilter(value: unknown) {
  if (value === null) return null;
  const filter = object(value, [
    'fromBlock',
    'toBlock',
    'blockHash',
    'address',
    'topics',
  ]);
  if (filter.blockHash != null) {
    if (filter.fromBlock != null || filter.toBlock != null) return invalid();
    filter.blockHash = hash(filter.blockHash);
  }
  for (const field of ['fromBlock', 'toBlock'])
    if (filter[field] != null) filter[field] = blockNumber(filter[field]);
  if (filter.address != null)
    filter.address = Array.isArray(filter.address)
      ? list(filter.address, address)
      : address(filter.address);
  if (filter.topics != null)
    filter.topics = list(filter.topics, (value) =>
      value === null
        ? null
        : Array.isArray(value)
        ? list(value, (topic) => (topic === null ? null : hash(topic)))
        : hash(value)
    );
  return filter;
}
function storageKey(value: unknown) {
  // Nodes accept short/odd and full-width keys. Width affects storageProof.key;
  // preserve the original spelling rather than converting these to quantities.
  return typeof value === 'string' && /^(?:0[xX])?[\da-f]{0,64}$/i.test(value)
    ? value
    : invalid();
}
function proofBlock(value: unknown): unknown {
  // A bare full-width hash is a hash selector, even when its leading bytes are
  // zero. Quantity conversion would silently change it into a block number.
  if (typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value))
    return hash(value);
  if (typeof value === 'string' || typeof value === 'number')
    return blockNumber(value);
  const selector = object(value, [
    'blockNumber',
    'blockHash',
    'requireCanonical',
  ]);
  if (
    selector.requireCanonical != null &&
    typeof selector.requireCanonical !== 'boolean'
  )
    return invalid();
  if (selector.blockHash != null) {
    if (selector.blockNumber != null) return invalid();
    selector.blockHash = hash(selector.blockHash);
  } else if (selector.blockNumber != null)
    selector.blockNumber = blockNumber(selector.blockNumber);
  else return invalid();
  return selector;
}
/** Bounded public node queries/controls and local verification, never wallet signing. */
export function normalizeDappRpcRequest(
  method: string,
  input: unknown
): DappPublicRpcRequest {
  if (!isDappPublicRpcMethod(method))
    throw new EthereumRpcErrorHandler(4200, 'Unsupported public RPC method');
  assertProviderRequestBudget({ method, params: input });
  const values = input == null ? [] : input;
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
      'web3_clientVersion',
      'net_listening',
      'net_peerCount',
      'eth_coinbase',
      'eth_getWork',
      'eth_hashrate',
      'eth_mining',
      'eth_newBlockFilter',
    ].includes(method)
  )
    length(0);
  else if (method === 'web3_sha3') {
    length(1);
    if (params[0] !== '') bytes(params[0]);
  } else if (method === 'eth_newPendingTransactionFilter') {
    length(0, 1);
    if (params.length && params[0] !== null && typeof params[0] !== 'boolean')
      return invalid();
  } else if (
    [
      'eth_getFilterChanges',
      'eth_getFilterLogs',
      'eth_uninstallFilter',
    ].includes(method)
  ) {
    length(1);
    // A server filter ID is opaque. Quantity conversion or case folding can
    // select a different remote filter; no local filter registry is invented.
    if (typeof params[0] !== 'string') return invalid();
  } else if (method === 'eth_submitHashrate') {
    length(2);
    // Preserve DATA/quantity spellings; capability and numeric limits belong to
    // the selected node, rather than a wallet-maintained mining policy.
    params[0] = miningRate(params[0]);
    hash(params[1]);
  } else if (method === 'eth_submitWork') {
    length(3);
    if (typeof params[0] !== 'string' || !/^0x[\da-f]{16}$/i.test(params[0]))
      return invalid();
    hash(params[1]);
    hash(params[2]);
  } else if (method === 'personal_ecRecover') {
    length(2);
    // The SDK owns message/signature decoding, including UTF-8, odd hex and
    // compact signatures. Public recovery is not a signing request.
    if (params.some((value) => typeof value !== 'string')) return invalid();
  } else if (method === 'eth_getLogs' || method === 'eth_newFilter') {
    length(1);
    params[0] = logFilter(params[0]);
  } else if (method === 'eth_getProof') {
    length(2, 3);
    params[0] = address(params[0]);
    if (params[1] !== null) params[1] = list(params[1], storageKey);
    if (params.length === 3 && params[2] !== null)
      params[2] = proofBlock(params[2]);
  } else if (
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
  } else if (
    [
      'eth_getBlockTransactionCountByNumber',
      'eth_getBlockTransactionCountByHash',
      'eth_getTransactionByBlockNumberAndIndex',
      'eth_getTransactionByBlockHashAndIndex',
      'eth_getUncleCountByBlockNumber',
      'eth_getUncleCountByBlockHash',
      'eth_getUncleByBlockNumberAndIndex',
      'eth_getUncleByBlockHashAndIndex',
    ].includes(method)
  ) {
    const withIndex = method.includes('AndIndex');
    length(withIndex ? 2 : 1);
    params[0] =
      method.includes('BlockHash') || method.endsWith('ByHash')
        ? hash(params[0])
        : blockNumber(params[0]);
    if (withIndex) params[1] = quantity(params[1]);
  } else return invalid();
  return Object.freeze({ method, params: Object.freeze(params) });
}

/** One owned request per node query/control; controls never retry automatically. */
export async function executeDappRpcRequest(
  input: DappPublicRpcRequest,
  ports: Readonly<{
    assertCurrent(): void;
    request(request: DappPublicRpcRequest): Promise<unknown>;
    verifyPersonalMessage(message: string, signature: string): string;
  }>
): Promise<unknown> {
  assertSynchronousEvmFeeGuard(() => ports.assertCurrent());
  const request = normalizeDappRpcRequest(input.method, input.params);
  let result: unknown;
  try {
    result =
      classifyDappRpcMethod(request.method) === 'local-verification'
        ? getAddress(
            ports.verifyPersonalMessage(
              request.params[0] as string,
              request.params[1] as string
            )
          )
        : await ports.request(request);
  } finally {
    assertSynchronousEvmFeeGuard(() => ports.assertCurrent());
  }
  assertJsonWorkBudget(result);
  return result;
}
