// Public synthetic HTTP evidence for the actual watch authority/readers/model.
// No keyring, signing API or public service is reachable from this fixture.
import { EVM_NETWORK_DEFINITIONS } from '../../../../source/shared/evmNetworks';

export type EvmActivityMode =
  | 'value'
  | 'empty'
  | 'error'
  | 'wrong-chain'
  | 'slow'
  | 'token-placeholder'
  | 'mixed-case';
const search = new URLSearchParams(window.location.search);
const enabled = search.has('evm-activity');
const tokenMetadata = search.get('token-metadata');
let mode: EvmActivityMode =
  (['value', 'empty', 'error', 'wrong-chain', 'slow', 'token-placeholder', 'mixed-case'] as const).find(
    (value) => value === search.get('evm-activity-mode')
  ) ?? 'value';
const OTHER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const LARGE = '123456789012345678901234567890123456';
const calls: { url: string; method: string; params?: readonly unknown[] }[] =
  [];
const denied: string[] = [],
  opened: string[] = [];
const waiting = new Set<() => void>();
let cancelled = 0;
const records = new Map<string, { owner: string; index: number }>();
const hex = (value: number | bigint) => `0x${value.toString(16)}`;
const blockHash = (chainId: number) =>
  `0x${BigInt(chainId).toString(16).padStart(64, 'b')}`;
const txHash = (owner: string, index: number) =>
  `0x${owner.slice(2).toLowerCase().padEnd(60, '0')}${index
    .toString(16)
    .padStart(4, '0')}`;
const topic = (address: string) =>
  `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
const locationKey = (url: string, hash: string) =>
  `${url}:${hash.toLowerCase()}`;
function transaction(owner: string, index: number, chainId: number) {
  const token = index === 3 || index === 4,
    pending = index === 5;
  return {
    hash: txHash(owner, index),
    from: index === 2 || token ? OTHER : owner,
    to: token ? TOKEN : index === 2 ? owner : OTHER,
    value: token
      ? '0x0'
      : hex(index === 2 ? 2000000000000000000n : 1000000000000000001n),
    nonce: hex(index),
    blockHash: pending ? null : blockHash(chainId),
    blockNumber: pending ? null : hex(1000 - index),
    transactionIndex: pending ? null : '0x0',
  };
}
function receipt(owner: string, index: number, chainId: number) {
  if (index === 5) return null;
  const tx = transaction(owner, index, chainId);
  const logs =
    index === 3 || index === 4
      ? [
          {
            address: TOKEN,
            transactionHash: tx.hash,
            blockHash: tx.blockHash,
            blockNumber: tx.blockNumber,
            transactionIndex: '0x0',
            logIndex: '0x0',
            removed: false,
            topics: [TOPIC, topic(OTHER), topic(owner)],
            data: `0x${BigInt(index === 3 ? LARGE : '0')
              .toString(16)
              .padStart(64, '0')}`,
          },
        ]
      : [];
  return {
    transactionHash: tx.hash,
    from: tx.from,
    to: tx.to,
    blockHash: tx.blockHash,
    blockNumber: tx.blockNumber,
    transactionIndex: '0x0',
    status: index === 6 ? '0x0' : '0x1',
    gasUsed: '0x5208',
    effectiveGasPrice: '0x3b9aca00',
    logs,
  };
}
async function gate(signal: AbortSignal | null | undefined) {
  if (signal?.aborted)
    throw new DOMException('Fixture request cancelled', 'AbortError');
  if (mode !== 'slow') return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      waiting.delete(resume);
      signal?.removeEventListener('abort', abort);
    };
    const resume = () => {
      finish();
      resolve();
    };
    const abort = () => {
      cancelled++;
      finish();
      reject(new DOMException('Fixture request cancelled', 'AbortError'));
    };
    waiting.add(resume);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
export const evmActivityFixture = {
  mode(value: EvmActivityMode) {
    mode = value;
  },
  release() {
    mode = 'value';
    for (const resume of [...waiting]) resume();
  },
  calls: () => calls.map((call) => ({ ...call })),
  cancelled: () => cancelled,
  denied: () => [...denied],
  opened: () => [...opened],
  hash: txHash,
  open(url: string): boolean {
    if (!enabled) return false;
    const accepted = EVM_NETWORK_DEFINITIONS.some(({ network }) => {
      const base = network.explorer.replace(/\/$/, '') + '/tx/';
      return (
        url.startsWith(base) && /^0x[0-9a-f]{64}$/i.test(url.slice(base.length))
      );
    });
    if (!accepted) return false;
    opened.push(url);
    return true;
  },
};
export async function evmActivityFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response | null> {
  if (!enabled) return null;
  const url = String(input),
    requestUrl = new URL(url);
  const rpc = EVM_NETWORK_DEFINITIONS.find(
    ({ network }) => new URL(network.url).href === requestUrl.href
  );
  const api = EVM_NETWORK_DEFINITIONS.find(
    ({ network }) =>
      'apiUrl' in network &&
      network.apiUrl &&
      new URL(network.apiUrl).origin === requestUrl.origin &&
      new URL(network.apiUrl).pathname === requestUrl.pathname
  );
  if (!rpc && !api) return null;
  if (mode === 'error')
    return new Response('Fixture unavailable', { status: 503 });
  if (rpc) {
    if (init?.method !== 'POST') throw Error('EVM fixture RPC requires POST');
    const request = JSON.parse(String(init.body)) as {
      jsonrpc: string;
      id: number;
      method: string;
      params: unknown[];
    };
    const allowed = [
      'eth_chainId',
      'eth_blockNumber',
      'eth_getTransactionByHash',
      'eth_getTransactionReceipt',
      'eth_getBlockByNumber',
    ];
    if (!allowed.includes(request.method)) {
      denied.push(request.method);
      throw Error('EVM fixture refused write or unknown RPC');
    }
    calls.push({ url, method: request.method, params: request.params });
    const capturedMode = mode;
    await gate(init.signal);
    let result: unknown;
    if (request.method === 'eth_chainId')
      result = hex(
        capturedMode === 'wrong-chain'
          ? rpc.network.chainId + 1
          : rpc.network.chainId
      );
    else if (request.method === 'eth_blockNumber') result = '0x3e8';
    else if (request.method === 'eth_getBlockByNumber')
      result = {
        number: request.params[0],
        hash: blockHash(rpc.network.chainId),
        timestamp: '0x6553f100',
      };
    else {
      const record = records.get(locationKey(url, String(request.params[0])));
      if (!record) throw Error('EVM fixture refused an undiscovered hash');
      result =
        request.method === 'eth_getTransactionByHash'
          ? transaction(record.owner, record.index, rpc.network.chainId)
          : receipt(record.owner, record.index, rpc.network.chainId);
    }
    return json({ jsonrpc: '2.0', id: request.id, result });
  }
  if (init?.method !== undefined && init.method !== 'GET') {
    denied.push(init.method);
    throw Error('EVM explorer fixture requires GET');
  }
  const action = requestUrl.searchParams.get('action'),
    owner = requestUrl.searchParams.get('address');
  if (
    requestUrl.searchParams.get('module') !== 'account' ||
    !['txlist', 'tokentx'].includes(action ?? '') ||
    !owner ||
    !/^0x[0-9a-f]{40}$/i.test(owner) ||
    requestUrl.searchParams.get('offset') !== '20' ||
    requestUrl.searchParams.has('endblock')
  )
    throw Error('EVM fixture refused unexpected explorer request');
  calls.push({ url, method: action! });
  const capturedMode = mode;
  await gate(init?.signal);
  const page = Number(requestUrl.searchParams.get('page'));
  if (capturedMode === 'token-placeholder' || capturedMode === 'mixed-case') {
    const mixed = capturedMode === 'mixed-case';
    const raw = (index: number, token: boolean) => ({
      hash: mixed ? `0x${txHash(owner, index).slice(2).toUpperCase()}` : txHash(owner, index),
      from: OTHER, to: owner, nonce: mixed && index === 7 ? '8' : '7',
      value: token ? '1' : '1000000000000000000', blockNumber: index === 3 ? '100' : '99',
      timeStamp: '1700000000', confirmations: '1', input: '0x', isError: '0',
      ...(token ? { contractAddress: TOKEN, tokenDecimal: '0', tokenSymbol: 'IDENTITY' } : {}),
    });
    const result = action === 'txlist' ? mixed && page === 1 ? [raw(3, false)] : []
      : page === 1 && mixed ? Array.from({ length: 20 }, (_, index) => raw(index % 2 ? 7 : 3, true))
      : page <= 2 ? [raw(3, true), raw(7, true)] : [];
    return json({ status: '1', message: 'OK', result });
  }
  const indices =
    capturedMode === 'empty' || page > 1
      ? []
      : action === 'tokentx'
      ? [3, 4]
      : [1, 2, 5, 6];
  const result = indices.map((index) => {
    const tx = transaction(owner, index, api!.network.chainId);
    records.set(locationKey(api!.network.url, tx.hash), { owner, index });
    return {
      hash: tx.hash,
      from: tx.from,
      to: action === 'tokentx' ? owner : tx.to,
      value:
        action === 'tokentx'
          ? index === 3
            ? tokenMetadata === 'malformed' ? 'invalid' : LARGE
            : '0'
          : BigInt(tx.value).toString(),
      nonce: String(index),
      blockNumber: index === 5 ? '0' : String(1000 - index),
      timeStamp: String(1700000000 - index),
      blockHash: tx.blockHash,
      confirmations: index === 5 ? '0' : '1',
      input: '0x',
      isError: index === 6 ? '1' : '0',
      txreceipt_status: index === 6 ? '0' : '1',
      ...(action === 'tokentx'
        ? {
            contractAddress: TOKEN,
            ...(tokenMetadata === 'missing' ? {} : { tokenDecimal: tokenMetadata === 'invalid' ? 'unknown' : '0' }),
            tokenSymbol: 'RAW',
            tokenName: 'Public fixture token',
          }
        : {}),
    };
  });
  return json(
    result.length
      ? { status: '1', message: 'OK', result }
      : { status: '0', message: 'No transactions found', result: [] }
  );
}
