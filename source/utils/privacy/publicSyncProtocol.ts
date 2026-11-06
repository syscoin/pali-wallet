import { Interface } from 'ethers/abi';
import { parseEther, toQuantity } from 'ethers/utils';

import {
  DEFAULT_PRIVACY_SERVICE_ORIGIN,
  normalizePrivacyServiceOrigin,
} from '../../shared/privacyServiceOrigin.ts';

import { getPrivacyPool, PRIVACY_TREE_LEVELS } from './registry.ts';
import {
  validatePrivacyRpcUrl,
  validateSnapshot,
} from './snapshotValidation.ts';
import type {
  PrivacyIndexProgress,
  PrivacyPoolId,
  PrivacySnapshot,
} from './types.ts';

/** The host owns dispatch, bounded JSON reads and response cleanup. */
export type PrivacyJsonTransport = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
  responseLimit: (response: Pick<Response, 'ok' | 'status'>) => number,
  readResponse: (
    response: PrivacyJsonResponse,
    limit: number
  ) => Promise<unknown>
) => Promise<{ data: unknown; status: number }>;

export const PRIVACY_SERVICE_URL = `${DEFAULT_PRIVACY_SERVICE_ORIGIN}/api/privacy/v1`;
const MAX_SNAPSHOT_BYTES = 160 * 1024 * 1024;
const MAX_SCALAR_RPC_BYTES = 64 * 1024;
// Block replies include every transaction hash even when full objects are off.
const MAX_BLOCK_RPC_BYTES = 4 * 1024 * 1024;
export const PRIVACY_POOL_ABI = new Interface([
  'function nextIndex() view returns (uint32)',
  'function getLastRoot() view returns (bytes32)',
  'function levels() view returns (uint32)',
  'function denomination() view returns (uint256)',
  'function isKnownRoot(bytes32 root) view returns (bool)',
  'function isSpent(bytes32 nullifierHash) view returns (bool)',
]);

export type PrivacyJsonResponse = Readonly<{
  body: {
    getReader(): {
      cancel(): Promise<void>;
      read(): Promise<ReadableStreamReadResult<Uint8Array>>;
    };
  } | null;
  headers: Pick<Headers, 'get'>;
}>;

async function readPrivacyJson(
  response: PrivacyJsonResponse,
  limit: number,
  parse: (text: string) => unknown
): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > limit)
    throw new Error('privacy_data_invalid');
  if (!response.body) throw new Error('privacy_data_invalid');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let length = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('privacy_data_invalid');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return parse(text);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function snapshotStringEnd(text: string, start: number): number {
  for (
    let end = text.indexOf('"', start + 1);
    end !== -1;
    end = text.indexOf('"', end + 1)
  ) {
    let backslash = end;
    while (text[backslash - 1] === '\\') backslash -= 1;
    if ((end - backslash) % 2 === 0) return end;
  }
  throw new Error('privacy_data_invalid');
}

function parseSnapshotJson(text: string): unknown {
  // Snapshot arrays contain 66-character hex words. Bound structural tokens
  // before JSON.parse can allocate a dense array of tiny values or containers.
  const maximumMetadataEntries = 256;
  const maximumSeparators =
    Math.floor(text.length / 64) + maximumMetadataEntries;
  let separators = 0;
  let containers = 0;
  let properties = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      index = snapshotStringEnd(text, index);
    } else if (
      (character === ',' && ++separators > maximumSeparators) ||
      (character === ':' && ++properties > maximumMetadataEntries) ||
      ((character === '{' || character === '[') &&
        ++containers > maximumMetadataEntries)
    ) {
      throw new Error('privacy_data_invalid');
    }
  }
  return JSON.parse(text);
}

const readSnapshotJson = (response: PrivacyJsonResponse, limit: number) =>
  readPrivacyJson(response, limit, parseSnapshotJson);
const readRpcJson = (response: PrivacyJsonResponse, limit: number) =>
  readPrivacyJson(response, limit, JSON.parse);

export async function readPrivacyPoolSnapshot(
  poolId: PrivacyPoolId,
  signal: AbortSignal,
  requestJson: PrivacyJsonTransport,
  serviceOrigin: string
): Promise<PrivacySnapshot | PrivacyIndexProgress> {
  const pool = getPrivacyPool(poolId);
  const origin = normalizePrivacyServiceOrigin(serviceOrigin);
  const response = await requestJson(
    `${origin}/api/privacy/v1/pools/${pool.id}/snapshot`,
    { cache: 'no-store', credentials: 'omit', redirect: 'error', signal },
    ({ status }) => {
      if (status !== 200 && status !== 202)
        throw new Error('privacy_service_unavailable');
      return status === 200 ? MAX_SNAPSHOT_BYTES : 4096;
    },
    readSnapshotJson
  );
  const data: any = response.data;
  if (response.status === 200) return validateSnapshot(poolId, data);
  if (
    data?.phase !== 'syncing' ||
    !Number.isSafeInteger(data.startBlock) ||
    data.startBlock !== pool.deploymentBlock ||
    !Number.isSafeInteger(data.scannedBlock) ||
    data.scannedBlock < pool.deploymentBlock - 1 ||
    !Number.isSafeInteger(data.targetBlock) ||
    data.targetBlock < data.scannedBlock
  )
    throw new Error('privacy_data_invalid');
  return data;
}

export function privacyRpcResponseLimit(block: boolean): number {
  return block ? MAX_BLOCK_RPC_BYTES : MAX_SCALAR_RPC_BYTES;
}

function privacyRpcResult(data: unknown, id: number) {
  const body: any = data;
  if (
    !body ||
    body.jsonrpc !== '2.0' ||
    body.id !== id ||
    body.error ||
    !('result' in body)
  )
    throw new Error('privacy_rpc_unavailable');
  return body.result;
}

export async function readPrivacyRpcResponse(
  response: PrivacyJsonResponse & Pick<Response, 'ok'>,
  id: number,
  block: boolean
) {
  if (!response.ok) throw new Error('privacy_rpc_unavailable');
  return privacyRpcResult(
    await readRpcJson(response, privacyRpcResponseLimit(block)),
    id
  );
}

export function createPrivacyRpc(requestJson: PrivacyJsonTransport) {
  let requestId = 0;
  return async function rpc(
    url: string,
    method: string,
    params: unknown[],
    signal: AbortSignal
  ) {
    const id = ++requestId;
    const { data } = await requestJson(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal,
      },
      ({ ok }) => {
        if (!ok) throw new Error('privacy_rpc_unavailable');
        return privacyRpcResponseLimit(
          method === 'eth_getBlockByNumber' ||
            method === 'eth_getTransactionReceipt'
        );
      },
      readRpcJson
    );
    return privacyRpcResult(data, id);
  };
}

const anchorScalars = [
  'nextIndex',
  'getLastRoot',
  'levels',
  'denomination',
] as const;

export type PrivacyAnchorRead =
  | 'chainId'
  | 'block'
  | 'isKnownRoot'
  | (typeof anchorScalars)[number];

type PrivacyAnchorFacts = Pick<
  PrivacySnapshot,
  'asOfBlockNumber' | 'asOfBlockHash' | 'leafCount' | 'root'
>;

type PrivacyAnchorAccess =
  | ReturnType<typeof createPrivacyRpc>
  | Readonly<{ read(kind: PrivacyAnchorRead): Promise<unknown> }>;

// Read the selected Ethereum RPC independently of Sysnode, never its RPC URL.
// Number-pinned eth_call is guarded by matching block hashes before and after.
export async function verifyPrivacySnapshotAnchor(
  poolId: PrivacyPoolId,
  snapshot: PrivacyAnchorFacts,
  rpcUrl: string,
  signal: AbortSignal,
  access: PrivacyAnchorAccess
): Promise<{ blockTimestamp: number }> {
  const pool = getPrivacyPool(poolId);
  const url = validatePrivacyRpcUrl(rpcUrl);
  const owned = typeof access !== 'function';
  const query = (kind: PrivacyAnchorRead, method: string, params: unknown[]) =>
    owned ? access.read(kind) : access(url, method, params, signal);
  if ((await query('chainId', 'eth_chainId', [])) !== '0x1')
    throw new Error('privacy_wrong_chain');
  const tag = toQuantity(snapshot.asOfBlockNumber);
  const block = () =>
    query('block', 'eth_getBlockByNumber', [tag, false]) as Promise<{
      hash?: string;
      number?: string;
      timestamp?: unknown;
    } | null>;
  const before = await block();
  if (
    before?.hash?.toLowerCase() !== snapshot.asOfBlockHash ||
    before?.number !== tag
  )
    throw new Error('privacy_anchor_changed');
  // Timestamp comes from the independently checked block, never Sysnode or
  // the download clock. The note reader uses it to bound as-of freshness.
  const timestamp = before.timestamp;
  if (
    typeof timestamp !== 'string' ||
    timestamp.length > 16 ||
    timestamp.trim() !== timestamp ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(timestamp)
  )
    throw new Error('privacy_rpc_unavailable');
  const blockTimestamp = Number(BigInt(timestamp)) * 1000;
  if (!Number.isSafeInteger(blockTimestamp) || blockTimestamp <= 0)
    throw new Error('privacy_rpc_unavailable');
  const read = async (fn: (typeof anchorScalars)[number]) => {
    const result = await query(fn, 'eth_call', [
      { to: pool.address, data: PRIVACY_POOL_ABI.encodeFunctionData(fn) },
      tag,
    ]);
    return PRIVACY_POOL_ABI.decodeFunctionResult(fn, result as string)[0];
  };
  const scalars = owned ? [] : await Promise.all(anchorScalars.map(read));
  if (owned) {
    for (const fn of anchorScalars) scalars.push(await read(fn));
  }
  const [count, root, levels, denomination] = scalars;
  const after = await block();
  if (
    after?.hash !== before.hash ||
    after?.number !== before.number ||
    after?.timestamp !== timestamp
  )
    throw new Error('privacy_anchor_changed');
  if (
    count !== BigInt(snapshot.leafCount) ||
    root.toLowerCase() !== snapshot.root ||
    levels !== BigInt(PRIVACY_TREE_LEVELS) ||
    denomination !== parseEther(pool.amount)
  )
    throw new Error('privacy_verification_failed');
  const known = PRIVACY_POOL_ABI.decodeFunctionResult(
    'isKnownRoot',
    (await query('isKnownRoot', 'eth_call', [
      {
        to: pool.address,
        data: PRIVACY_POOL_ABI.encodeFunctionData('isKnownRoot', [
          snapshot.root,
        ]),
      },
      'latest',
    ])) as string
  )[0];
  if (known !== true) throw new Error('privacy_snapshot_stale');
  return { blockTimestamp };
}
