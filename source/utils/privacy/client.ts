import {
  createPrivacyRpc,
  PRIVACY_POOL_ABI,
  readPrivacyPoolSnapshot,
  verifyPrivacySnapshotAnchor,
} from './publicSyncProtocol';
import type { PrivacyJsonTransport } from './publicSyncProtocol';
import { PRIVACY_POOLS } from './registry';
import { validatePrivacyRpcUrl } from './snapshotValidation';
import type { PrivacyPoolId, PrivacySnapshot } from './types';

export { validatePrivacyRpcUrl, validateSnapshot } from './snapshotValidation';
export { PRIVACY_SERVICE_URL } from './publicSyncProtocol';

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

const requestJson: PrivacyJsonTransport = async (url, init, responseLimit) => {
  const response = await fetch(url, init);
  return {
    data: await readJson(response, responseLimit(response)),
    status: response.status,
  };
};
const rpc = createPrivacyRpc(requestJson);

export function fetchPrivacySnapshot(
  poolId: PrivacyPoolId,
  signal: AbortSignal,
  serviceOrigin?: string
) {
  return readPrivacyPoolSnapshot(poolId, signal, requestJson, serviceOrigin);
}

export function verifySnapshotAnchor(
  poolId: PrivacyPoolId,
  snapshot: PrivacySnapshot,
  rpcUrl: string,
  signal: AbortSignal
) {
  return verifyPrivacySnapshotAnchor(poolId, snapshot, rpcUrl, signal, rpc);
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
      (name) =>
        call.data.slice(0, 10) === PRIVACY_POOL_ABI.getFunction(name)!.selector
    )
  )
    throw new Error('privacy_rpc_unavailable');
  return rpc(validatePrivacyRpcUrl(rpcUrl), method, params, signal);
}
