// Synthetic HTTP only; the real explorer/receipt readers and Activity model run.
// This module is imported exclusively by the browser test entrypoint.
import { ActivityExplorerReader } from '../../src/activity/explorerReader';
import { ActivityReceiptReader } from '../../src/activity/receiptReader';
import type {
  ActivityScope,
  LocalActivityRecord,
} from '../../src/activity/types';
import type { NativeActivityRuntime } from '../../src/activity/nativeActivity';
import { observeEvmTransaction } from '../../../../source/shared/evmTransactionObservation';

type Observation =
  | 'confirmed'
  | 'reverted'
  | 'pending'
  | 'unknown'
  | 'missing'
  | 'error';
type Call = { method: string; cancelled: boolean };
const HASH = `0x${'1'.padStart(64, '0')}`;
const BLOCK_HASH = `0x${'b'.repeat(64)}`;
const OTHER = `0x${'22'.repeat(20)}`;
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });

declare global {
  interface Window {
    __freshActivityFixture: {
      observation(value: Observation): void;
      hold(): void;
      release(): void;
      calls(): readonly Call[];
    };
  }
}

export function freshStatusFixture(mode: string | null, scope: ActivityScope) {
  if (!mode) return null;
  const parts = mode.split('-');
  const retained = parts[0] === 'retained' ? parts[1] : null;
  const indexed = retained ? 'none' : parts[0];
  const initial = retained ? parts[2] : parts[1];
  if (
    !(retained
      ? ['confirmed', 'missing'].includes(retained)
      : ['pending', 'confirmed'].includes(indexed ?? '')) ||
    ![
      'confirmed',
      'reverted',
      'pending',
      'unknown',
      'missing',
      'error',
    ].includes(initial ?? '')
  )
    throw Error('Unknown Activity status fixture');
  let observation = initial as Observation;
  let held = false;
  const waiting = new Set<() => void>();
  const calls: Call[] = [];
  window.__freshActivityFixture = {
    observation(value) {
      observation = value;
    },
    hold() {
      held = true;
    },
    release() {
      held = false;
      for (const resume of [...waiting]) resume();
    },
    calls: () => calls.map((call) => ({ ...call })),
  };
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    if (
      parsed.origin === new URL(scope.apiUrl!).origin &&
      parsed.pathname === new URL(scope.apiUrl!).pathname
    ) {
      const method = parsed.searchParams.get('action')!;
      calls.push({ method, cancelled: false });
      if (!['txlist', 'tokentx'].includes(method))
        throw Error('Unexpected explorer method');
      return json({
        status: '1',
        message: 'OK',
        result:
          method === 'tokentx' || retained
            ? []
            : [
                {
                  hash: HASH,
                  from: scope.address,
                  to: OTHER,
                  value: '1000000000000000000',
                  nonce: '1',
                  blockNumber: indexed === 'pending' ? '0' : '42',
                  confirmations: indexed === 'pending' ? '0' : '1',
                  timeStamp: '1700000000',
                  isError: '0',
                  txreceipt_status: '1',
                  input: '0x',
                },
              ],
      });
    }
    if (url !== scope.network.rpcUrl || init.method !== 'POST')
      throw Error('Unexpected fixture destination');
    const request = JSON.parse(String(init.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    if (
      ![
        'eth_chainId',
        'eth_getTransactionByHash',
        'eth_getTransactionReceipt',
        'eth_getBlockByNumber',
      ].includes(request.method)
    )
      throw Error('Unexpected fixture RPC');
    const call = { method: request.method, cancelled: false };
    calls.push(call);
    const captured = observation;
    const mined = ['confirmed', 'reverted', 'unknown'].includes(captured);
    let result: unknown;
    switch (request.method) {
      case 'eth_chainId':
        result = `0x${BigInt(scope.network.chainId).toString(16)}`;
        break;
      case 'eth_getTransactionByHash':
        result =
          captured === 'missing'
            ? null
            : {
                hash: HASH,
                from: scope.address,
                to: OTHER,
                value: '0xde0b6b3a7640000',
                nonce: '0x1',
                blockHash: mined ? BLOCK_HASH : null,
                blockNumber: mined ? '0x2b' : null,
                transactionIndex: mined ? '0x0' : null,
              };
        break;
      case 'eth_getTransactionReceipt':
        result =
          !mined || captured === 'unknown'
            ? null
            : {
                transactionHash: HASH,
                from: scope.address,
                to: OTHER,
                blockHash: BLOCK_HASH,
                blockNumber: '0x2b',
                transactionIndex: '0x0',
                status: captured === 'reverted' ? '0x0' : '0x1',
                gasUsed: '0x5208',
                effectiveGasPrice: '0x1',
                logs: [],
              };
        break;
      case 'eth_getBlockByNumber':
        if (request.params[0] !== '0x2b')
          throw Error('Unexpected fixture block');
        result = { hash: BLOCK_HASH, number: '0x2b', timestamp: '0x6553f100' };
        break;
    }
    if (held && request.method === 'eth_getTransactionReceipt')
      await new Promise<void>((resolve) => {
        // Intentionally settle even after cancellation to exercise stale-result guards.
        const abort = () => {
          call.cancelled = true;
        };
        const resume = () => {
          waiting.delete(resume);
          init.signal?.removeEventListener('abort', abort);
          resolve();
        };
        waiting.add(resume);
        init.signal?.addEventListener('abort', abort, { once: true });
      });
    return captured === 'error'
      ? new Response('Fixture unavailable', { status: 503 })
      : json({ jsonrpc: '2.0', id: request.id, result });
  };
  const locals: readonly LocalActivityRecord[] = retained
    ? [
        {
          walletFingerprint: scope.walletFingerprint,
          accountId: scope.accountId,
          address: scope.address,
          networkId: scope.network.id,
          registrationHash: scope.network.registrationHash,
          chainId: scope.network.chainId,
          hash: HASH,
          phase: 'submitted',
          nonce: 1,
          createdAt: 1700000000000,
          recipient: OTHER,
          amountUnits: '1000000000000000000',
          maximumFeeUnits: '21000',
        },
      ]
    : [];
  const observeLocal: NativeActivityRuntime['observeLocal'] = retained
    ? async (record, guard) =>
        observeEvmTransaction(
          {
            chainId: scope.network.chainId,
            from: scope.address,
            hash: record.hash,
            nonce: String(record.nonce),
            to: record.recipient,
          },
          async (method) => {
            calls.push({ method: `retained:${method}`, cancelled: false });
            if (method === 'eth_chainId')
              return `0x${BigInt(scope.network.chainId).toString(16)}`;
            if (method === 'eth_getTransactionCount') return '0x1';
            if (method === 'eth_getTransactionReceipt')
              return retained === 'missing'
                ? null
                : {
                    transactionHash: HASH,
                    from: scope.address,
                    to: OTHER,
                    status: '0x1',
                    blockNumber: '0x2a',
                    blockHash: BLOCK_HASH,
                  };
            return { number: '0x2a', hash: BLOCK_HASH, gasLimit: '0x1c9c380' };
          },
          guard
        )
    : undefined;
  return {
    locals,
    observeLocal,
    explorer: new ActivityExplorerReader(fetcher),
    receipts: new ActivityReceiptReader({ fetch: fetcher }),
  };
}
