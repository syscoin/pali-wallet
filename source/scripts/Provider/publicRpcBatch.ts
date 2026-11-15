import { isReadOnlyRpcMethod } from '@sidhujag/sysweb3-keyring/cjs/rpc-transport.js';

import {
  classifyDappRpcMethod,
  type DappPublicRpcRequest,
} from '../../shared/dappRpcReads';
import {
  assertRequestActive,
  requestCancelledError,
} from '../Background/controllers/message-handler/request-lifetime';

type Provider = {
  readMany?: (
    requests: readonly DappPublicRpcRequest[],
    options: { signal: AbortSignal }
  ) => Promise<PromiseSettledResult<unknown>[]>;
  send(method: string, params: unknown[]): Promise<unknown>;
};
type PendingRead = {
  check(): void;
  reject(error: unknown): void;
  request: DappPublicRpcRequest;
  resolve(value: unknown): void;
  signal: AbortSignal;
};
const queues = new WeakMap<Provider, Map<string, PendingRead[]>>();

/** Co-batch public queries from one selected context; each request retains its own lifetime. */
export function readPublicRpc(
  provider: Provider,
  scope: string,
  request: DappPublicRpcRequest,
  signal: AbortSignal,
  check: () => void
): Promise<unknown> {
  check();
  if (
    !provider.readMany ||
    classifyDappRpcMethod(request.method) !== 'node-query' ||
    !isReadOnlyRpcMethod(request.method)
  )
    return provider.send(request.method, [...request.params]);
  let owned = queues.get(provider);
  if (!owned) {
    owned = new Map();
    queues.set(provider, owned);
  }
  let pending = owned.get(scope);
  if (!pending) {
    pending = [];
    owned.set(scope, pending);
    const captured = pending;
    queueMicrotask(() => {
      if (owned!.get(scope) === captured) owned!.delete(scope);
      void flush(provider, captured);
    });
  }
  if (pending.length >= 128)
    return Promise.reject(new Error('Too many public reads'));
  return new Promise((resolve, reject) => {
    const cancel = () => reject(requestCancelledError());
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const finish = (error: unknown, value?: unknown) => {
      signal.removeEventListener('abort', cancel);
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    pending!.push({
      request,
      signal,
      check,
      resolve: (value) => finish(undefined, value),
      reject: (error) => finish(error),
    });
  });
}

async function flush(provider: Provider, queued: PendingRead[]): Promise<void> {
  const live = queued.filter((row) => {
    try {
      assertRequestActive(row.signal);
      row.check();
      return true;
    } catch (error) {
      row.reject(error);
      return false;
    }
  });
  if (!live.length) return;
  const controller = new AbortController();
  const cancelUnused = () => {
    if (live.every((row) => row.signal.aborted)) controller.abort();
  };
  live.forEach((row) =>
    row.signal.addEventListener('abort', cancelUnused, { once: true })
  );
  try {
    const results = await provider.readMany!(
      live.map((row) => row.request),
      { signal: controller.signal }
    );
    if (!Array.isArray(results) || results.length !== live.length)
      throw new Error('Invalid public RPC response');
    live.forEach((row, index) => {
      try {
        assertRequestActive(row.signal);
        row.check();
        const result = results[index]!;
        if (result.status === 'rejected') throw result.reason;
        if (result.status !== 'fulfilled')
          throw new Error('Invalid public RPC response');
        row.resolve(result.value);
      } catch (error) {
        row.reject(error);
      }
    });
  } catch (error) {
    live.forEach((row) => row.reject(error));
  } finally {
    live.forEach((row) =>
      row.signal.removeEventListener('abort', cancelUnused)
    );
    controller.abort();
  }
}
