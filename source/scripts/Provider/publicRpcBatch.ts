import { RpcReadError } from '@sidhujag/sysweb3-keyring/cjs/rpc-read-client.js';
import { isReadOnlyRpcMethod } from '@sidhujag/sysweb3-keyring/cjs/rpc-transport.js';

import {
  classifyDappRpcMethod,
  normalizeDappRpcRequest,
  publicRpcReadKey,
  type DappPublicRpcRequest,
} from '../../shared/dappRpcReads';
import { createRpcIdentityLease } from '../../shared/rpcIdentityLease';
import { assertPublicResponseBudget } from '../../utils/requestPayloadBudget';
import {
  assertRequestActive,
  requestCancelledError,
} from '../Background/controllers/message-handler/request-lifetime';

type Provider = {
  readMany?: (
    requests: readonly DappPublicRpcRequest[],
    options: { signal: AbortSignal }
  ) => Promise<PromiseSettledResult<unknown>[]>;
  send(
    method: string,
    params: unknown[],
    options?: { signal: AbortSignal }
  ): Promise<unknown>;
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
type Identity = { chainId: number; key: string };
type Owner = {
  identity?: { key: string; lease: ReturnType<typeof createRpcIdentityLease> };
  scopes: Map<string | symbol, Scope>;
  subscribers: number;
};
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
  check: () => void,
  identity?: Identity
): Promise<unknown> {
  assertRequestActive(signal);
  check();
  if (identity) {
    const lease = identityLease(provider, identity);
    return withRequestSignal(signal, async () => {
      try {
        const control =
          classifyDappRpcMethod(request.method) === 'node-control';
        await lease.ensure(signal, control);
        check();
        const result = await readPublicRpc(
          provider,
          scopeKey,
          request,
          signal,
          check
        );
        await lease.ensure(signal, control);
        check();
        return result;
      } catch (error) {
        if (!signal.aborted && !(error instanceof RpcReadError))
          lease.invalidate();
        throw error;
      }
    });
  }
  if (
    !provider.readMany ||
    classifyDappRpcMethod(request.method) !== 'node-query' ||
    !isReadOnlyRpcMethod(request.method)
  )
    return withRequestSignal(signal, () =>
      provider.send(request.method, [...request.params], { signal })
    );
  const normalized = normalizeDappRpcRequest(request.method, request.params);
  const key = publicRpcReadKey(normalized);
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
        assertPublicResponseBudget(result.value);
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

function withRequestSignal<T>(
  signal: AbortSignal,
  work: () => Promise<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(requestCancelledError());
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      signal.removeEventListener('abort', cancel);
      cancel();
    } else
      void work()
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', cancel));
  });
}

function identityLease(provider: Provider, identity: Identity) {
  let owner = owners.get(provider);
  if (!owner) {
    owner = { scopes: new Map(), subscribers: 0 };
    owners.set(provider, owner);
  }
  if (owner.identity?.key !== identity.key) {
    owner.identity?.lease.invalidate();
    const lease = createRpcIdentityLease(async (signal) => {
      const [result] = provider.readMany
        ? await provider.readMany(
            [{ method: 'eth_chainId', params: [] }] as any,
            { signal }
          )
        : await Promise.allSettled([
            provider.send('eth_chainId', [], { signal }),
          ]);
      if (result.status === 'rejected') throw result.reason;
      if (
        typeof result.value !== 'string' ||
        !/^0x[\da-f]+$/i.test(result.value) ||
        BigInt(result.value) !== BigInt(identity.chainId)
      )
        throw Object.assign(
          new Error('RPC chain does not match the selected network'),
          { code: 4901 }
        );
    });
    owner.identity = { key: identity.key, lease };
  }
  return owner.identity!.lease;
}
