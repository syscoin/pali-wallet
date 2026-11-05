import { Interface, parseEther, toQuantity } from 'ethers';

import { getPrivacyPool, PRIVACY_TREE_LEVELS, PRIVACY_POOLS } from './registry';
import { validatePrivacyRpcUrl, validateSnapshot } from './snapshotValidation';
import { PrivacyIndexProgress, PrivacyPoolId, PrivacySnapshot } from './types';

export { validatePrivacyRpcUrl, validateSnapshot } from './snapshotValidation';

export const PRIVACY_SERVICE_URL = 'https://sysnode.info/api/privacy/v1';
const MAX_SNAPSHOT_BYTES = 160 * 1024 * 1024;
const MAX_SCALAR_RPC_BYTES = 64 * 1024;
// Block replies include every transaction hash even when full objects are off.
const MAX_BLOCK_RPC_BYTES = 4 * 1024 * 1024;
const ABI = new Interface([
  'function nextIndex() view returns (uint32)',
  'function getLastRoot() view returns (bytes32)',
  'function levels() view returns (uint32)',
  'function denomination() view returns (uint256)',
  'function isKnownRoot(bytes32 root) view returns (bool)',
  'function isSpent(bytes32 nullifierHash) view returns (bool)',
]);

async function readJson(response: Response, limit: number): Promise<unknown> {
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
    return JSON.parse(text);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function fetchPrivacySnapshot(
  poolId: PrivacyPoolId,
  signal: AbortSignal,
  serviceOrigin = 'https://sysnode.info'
): Promise<PrivacySnapshot | PrivacyIndexProgress> {
  const pool = getPrivacyPool(poolId);
  const response = await fetch(
    `${serviceOrigin}/api/privacy/v1/pools/${pool.id}/snapshot`,
    { cache: 'no-store', credentials: 'omit', redirect: 'error', signal }
  );
  if (response.status !== 200 && response.status !== 202)
    throw new Error('privacy_service_unavailable');
  const data: any = await readJson(
    response,
    response.status === 202 ? 4096 : MAX_SNAPSHOT_BYTES
  );
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

let requestId = 0;
async function rpc(
  url: string,
  method: string,
  params: unknown[],
  signal: AbortSignal
) {
  const id = ++requestId;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal,
  });
  if (!response.ok) throw new Error('privacy_rpc_unavailable');
  const body: any = await readJson(
    response,
    method === 'eth_getBlockByNumber' || method === 'eth_getTransactionReceipt'
      ? MAX_BLOCK_RPC_BYTES
      : MAX_SCALAR_RPC_BYTES
  );
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

// Explicit user-requested completion checks only. The caller must disclose that
// requesting withdrawal and related deposit hashes can link them to the RPC.
// The shared streaming reader caps raw response bytes before JSON parsing.
export async function readCompletionRpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
  signal: AbortSignal
): Promise<unknown> {
  const quantity = (value: unknown) =>
    typeof value === 'string' &&
    value.length <= 66 &&
    /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value);
  const hash = (value: unknown) =>
    typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
  const allowed =
    Array.isArray(params) &&
    ((method === 'eth_chainId' && params.length === 0) ||
      (method === 'eth_getBlockByNumber' &&
        params.length === 2 &&
        (params[0] === 'finalized' || quantity(params[0])) &&
        params[1] === false) ||
      ((method === 'eth_getTransactionReceipt' ||
        method === 'eth_getTransactionByHash') &&
        params.length === 1 &&
        hash(params[0])));
  if (!allowed) throw new Error('privacy_rpc_unavailable');
  return rpc(validatePrivacyRpcUrl(rpcUrl), method, params, signal);
}

/** Explicit failed-withdrawal recovery only; no arbitrary contract calls. */
export async function readWithdrawalRecoveryRpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
  signal: AbortSignal
): Promise<unknown> {
  if (method !== 'eth_call')
    return readCompletionRpc(rpcUrl, method, params, signal);
  const call: any =
    Array.isArray(params) && params.length === 2 ? params[0] : undefined;
  if (
    !call ||
    typeof call !== 'object' ||
    Array.isArray(call) ||
    Object.keys(call).sort().join(',') !== 'data,to' ||
    !PRIVACY_POOLS.some((pool) => pool.address === call.to) ||
    typeof params[1] !== 'string' ||
    params[1].length > 66 ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(params[1]) ||
    typeof call.data !== 'string' ||
    !/^0x[0-9a-f]{72}$/.test(call.data) ||
    !['isKnownRoot', 'isSpent'].some(
      (name) => call.data.slice(0, 10) === ABI.getFunction(name)!.selector
    )
  )
    throw new Error('privacy_rpc_unavailable');
  return rpc(validatePrivacyRpcUrl(rpcUrl), method, params, signal);
}

// Read the selected Ethereum RPC independently of Sysnode, never its RPC URL.
// Number-pinned eth_call is guarded by matching block hashes before and after.
export async function verifySnapshotAnchor(
  poolId: PrivacyPoolId,
  snapshot: PrivacySnapshot,
  rpcUrl: string,
  signal: AbortSignal
): Promise<{ blockTimestamp: number }> {
  const pool = getPrivacyPool(poolId);
  const url = validatePrivacyRpcUrl(rpcUrl);
  if ((await rpc(url, 'eth_chainId', [], signal)) !== '0x1')
    throw new Error('privacy_wrong_chain');
  const tag = toQuantity(snapshot.asOfBlockNumber);
  const block = () => rpc(url, 'eth_getBlockByNumber', [tag, false], signal);
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
  const read = async (fn: string) => {
    const result = await rpc(
      url,
      'eth_call',
      [{ to: pool.address, data: ABI.encodeFunctionData(fn) }, tag],
      signal
    );
    return ABI.decodeFunctionResult(fn, result)[0];
  };
  const [count, root, levels, denomination] = await Promise.all([
    read('nextIndex'),
    read('getLastRoot'),
    read('levels'),
    read('denomination'),
  ]);
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
  const known = ABI.decodeFunctionResult(
    'isKnownRoot',
    await rpc(
      url,
      'eth_call',
      [
        {
          to: pool.address,
          data: ABI.encodeFunctionData('isKnownRoot', [snapshot.root]),
        },
        'latest',
      ],
      signal
    )
  )[0];
  if (known !== true) throw new Error('privacy_snapshot_stale');
  return { blockTimestamp };
}
