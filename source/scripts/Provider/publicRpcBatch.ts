import { isReadOnlyRpcMethod } from '@sidhujag/sysweb3-keyring/cjs/rpc-transport.js';

import {
  classifyDappRpcMethod,
  normalizeDappRpcRequest,
  type DappPublicRpcRequest,
} from '../../shared/dappRpcReads';
import { assertJsonWorkBudget } from '../../utils/requestPayloadBudget';
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
type Subscriber = {
  check(): void;
  settle(result: PromiseSettledResult<unknown>): void;
};
type PendingRead = {
  batch?: { controller: AbortController; reads: PendingRead[] };
  key: string;
  request: DappPublicRpcRequest;
  subscribers: Set<Subscriber>;
};
type Scope = {
  queued: PendingRead[];
  reads: Map<string, PendingRead>;
  timer?: ReturnType<typeof setTimeout>;
};
type Owner = { scopes: Map<string | symbol, Scope>; subscribers: number };
const owners = new WeakMap<Provider, Owner>();
// Collect adjacent IPC events without extending the collection window on arrival.
const COLLECTION_MS = 4;
const MAX_SUBSCRIBERS = 128;

/** Join outstanding exact public reads within one selected document and wallet context. */
export function readPublicRpc(
  provider: Provider,
  scopeKey: string | symbol,
  request: DappPublicRpcRequest,
  signal: AbortSignal,
  check: () => void
): Promise<unknown> {
  assertRequestActive(signal);
  check();
  if (
    !provider.readMany ||
    classifyDappRpcMethod(request.method) !== 'node-query' ||
    !isReadOnlyRpcMethod(request.method)
  )
    return provider.send(request.method, [...request.params]);
  const normalized = normalizeDappRpcRequest(request.method, request.params);
  const key = JSON.stringify(normalized, (_name, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((name) => [name, value[name]])
        )
      : value
  );
  let owner = owners.get(provider);
  if (!owner) {
    owner = { scopes: new Map(), subscribers: 0 };
    owners.set(provider, owner);
  }
  if (owner.subscribers >= MAX_SUBSCRIBERS)
    return Promise.reject(new Error('Too many public reads'));
  let scope = owner.scopes.get(scopeKey);
  if (!scope) {
    scope = { reads: new Map(), queued: [] };
    owner.scopes.set(scopeKey, scope);
  }
  let read = scope.reads.get(key);
  if (!read) {
    read = { key, request: normalized, subscribers: new Set() };
    scope.reads.set(key, read);
    scope.queued.push(read);
    if (scope.timer === undefined) {
      const captured = scope;
      scope.timer = setTimeout(() => {
        captured.timer = undefined;
        const queued = captured.queued;
        captured.queued = [];
        void flush(provider, queued, () =>
          retireScope(owner!, scopeKey, captured)
        );
      }, COLLECTION_MS);
    }
  }
  const capturedRead = read;
  const capturedScope = scope;
  const capturedOwner = owner;
  return new Promise((resolve, reject) => {
    const subscriber: Subscriber = {
      check: () => {
        assertRequestActive(signal);
        check();
      },
      settle: (result) => {
        if (!capturedRead.subscribers.delete(subscriber)) return;
        signal.removeEventListener('abort', cancel);
        capturedOwner.subscribers--;
        if (!capturedRead.subscribers.size) {
          if (capturedScope.reads.get(key) === capturedRead)
            capturedScope.reads.delete(key);
          const batch = capturedRead.batch;
          if (!batch) {
            const index = capturedScope.queued.indexOf(capturedRead);
            if (index >= 0) capturedScope.queued.splice(index, 1);
          }
          if (batch?.reads.every((item) => !item.subscribers.size))
            batch.controller.abort();
          retireScope(capturedOwner, scopeKey, capturedScope);
        }
        if (result.status === 'rejected') reject(result.reason);
        else resolve(result.value);
      },
    };
    const cancel = () =>
      subscriber.settle({
        status: 'rejected',
        reason: requestCancelledError(),
      });
    capturedRead.subscribers.add(subscriber);
    capturedOwner.subscribers++;
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

function retireScope(owner: Owner, key: string | symbol, scope: Scope): void {
  if (scope.reads.size) return;
  if (scope.timer !== undefined) clearTimeout(scope.timer);
  scope.queued = [];
  if (owner.scopes.get(key) === scope) owner.scopes.delete(key);
}

async function flush(
  provider: Provider,
  queued: PendingRead[],
  retire: () => void
): Promise<void> {
  const live = queued.filter((read) => {
    for (const subscriber of [...read.subscribers]) {
      try {
        subscriber.check();
      } catch (reason) {
        subscriber.settle({ status: 'rejected', reason });
      }
    }
    return read.subscribers.size > 0;
  });
  if (!live.length) return;
  const batch = { controller: new AbortController(), reads: live };
  live.forEach((read) => {
    read.batch = batch;
  });
  try {
    const results = await provider.readMany!(
      live.map((read) => read.request),
      { signal: batch.controller.signal }
    );
    if (!Array.isArray(results) || results.length !== live.length)
      throw new Error('Invalid public RPC response');
    live.forEach((read, index) => {
      const result = results[index]!;
      let serialized: string | undefined;
      let failure: PromiseRejectedResult | undefined;
      try {
        if (result.status === 'rejected') throw result.reason;
        if (result.status !== 'fulfilled')
          throw new Error('Invalid public RPC response');
        assertJsonWorkBudget(result.value);
        if (result.value && typeof result.value === 'object')
          serialized = JSON.stringify(result.value);
      } catch (error) {
        failure = { status: 'rejected', reason: error };
      }
      for (const subscriber of [...read.subscribers]) {
        try {
          subscriber.check();
          subscriber.settle(
            failure ?? {
              status: 'fulfilled',
              value:
                serialized === undefined
                  ? (result as PromiseFulfilledResult<unknown>).value
                  : JSON.parse(serialized),
            }
          );
        } catch (reason) {
          subscriber.settle({ status: 'rejected', reason });
        }
      }
    });
  } catch (reason) {
    live.forEach((read) => {
      for (const subscriber of [...read.subscribers])
        subscriber.settle({ status: 'rejected', reason });
    });
  } finally {
    batch.controller.abort();
    retire();
  }
}
