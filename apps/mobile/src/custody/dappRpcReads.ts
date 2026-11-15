import { isReadOnlyRpcMethod } from '@sidhujag/sysweb3-keyring/cjs/rpc-transport.js';
import {
  classifyDappRpcMethod,
  executeDappRpcRequest,
  type DappPublicRpcRequest,
} from '../../../../source/shared/dappRpcReads.ts';
import { EthereumRpcErrorHandler } from '../../../../source/helpers/errors/errorClassesHandlers.ts';
import { createBoundedRpcFetch } from './boundedRpcFetch.ts';
import { EvmTransferReadError } from './evmFeeContracts.ts';
import {
  snapshotNativeNetwork,
  type NativeNetworkRegistration,
} from './networkContext.ts';
import { EvmTransferReadRpc } from './evmTransferReadRpc.ts';

export type NativeConnectionReadHost = Readonly<{
  read(
    request: DappPublicRpcRequest,
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<unknown>;
  reset?(): void;
}>;
type SharedRead = {
  controller: AbortController;
  promise: Promise<unknown>;
  subscribers: number;
  settled: boolean;
};
type QueuedRead = {
  request: DappPublicRpcRequest;
  controller: AbortController;
  resolve(value: unknown): void;
  reject(error: unknown): void;
};
type ReadOwner = {
  key: string;
  controller: AbortController;
  rpc: EvmTransferReadRpc;
  verifiedUntil: number;
  verification?: { controller: AbortController; promise: Promise<void> };
  pending: Map<string, SharedRead>;
  queued: QueuedRead[];
};
const IDENTITY_LEASE_MS = 30_000;
const cancelled = () => new Error('CONTEXT_CHANGED');

/** Public node queries share one selected-session owner; controls remain single-attempt. */
export function createNativeDappRpcReadHost(
  ports: Readonly<{
    registration(): NativeNetworkRegistration;
    context?(): string;
    fetch(url: string, init: RequestInit): Promise<Response>;
    verifyPersonalMessage(message: string, signature: string): string;
    now?(): number;
  }>
): NativeConnectionReadHost {
  const fetch = createBoundedRpcFetch(ports.fetch);
  const now = ports.now ?? (() => performance.now());
  let owner: ReadOwner | undefined;
  const key = () =>
    JSON.stringify([
      ports.context?.() ?? '',
      snapshotNativeNetwork(ports.registration()).registrationHash,
    ]);
  const reset = () => {
    owner?.controller.abort();
    owner = undefined;
  };
  const current = (captured: ReadOwner) => {
    if (
      owner !== captured ||
      captured.controller.signal.aborted ||
      key() !== captured.key
    ) {
      if (owner === captured) reset();
      throw cancelled();
    }
  };
  const invalidateAfterFailure = (
    captured: ReadOwner,
    error: unknown,
    signal: AbortSignal
  ) => {
    if (owner !== captured || error instanceof EthereumRpcErrorHandler) return;
    if (error instanceof EvmTransferReadError) {
      if (error.code === 'PROFILE_CHANGED') {
        reset();
        return;
      }
      if (error.code === 'CANCELLED' && signal.aborted) return;
    }
    captured.verifiedUntil = 0;
    captured.verification?.controller.abort();
  };
  const capture = () => {
    const identity = key();
    if (!owner || owner.key !== identity) {
      reset();
      owner = {
        key: identity,
        controller: new AbortController(),
        rpc: new EvmTransferReadRpc(
          snapshotNativeNetwork(ports.registration()),
          { fetch }
        ),
        verifiedUntil: 0,
        pending: new Map(),
        queued: [],
      };
    }
    return owner;
  };
  const verify = async (captured: ReadOwner) => {
    current(captured);
    const remaining = captured.verifiedUntil - now();
    if (remaining > 0 && remaining <= IDENTITY_LEASE_MS) return;
    let verification = captured.verification;
    if (!verification || verification.controller.signal.aborted) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      captured.controller.signal.addEventListener('abort', abort, {
        once: true,
      });
      const next = { controller, promise: Promise.resolve() };
      captured.verification = next;
      next.promise = captured.rpc
        .verifyNetwork(controller.signal, () => current(captured))
        .then(() => {
          current(captured);
          if (controller.signal.aborted) throw new EvmTransferReadError('CANCELLED');
          captured.verifiedUntil = now() + IDENTITY_LEASE_MS;
        })
        .finally(() => {
          captured.controller.signal.removeEventListener('abort', abort);
          if (captured.verification === next) captured.verification = undefined;
        });
      verification = next;
    }
    await verification.promise;
    current(captured);
  };
  const flushQueries = async (captured: ReadOwner) => {
    const queued = captured.queued;
    captured.queued = [];
    const live = queued.filter(row => {
      if (!row.controller.signal.aborted) return true;
      row.reject(new EvmTransferReadError('CANCELLED'));
      return false;
    });
    if (!live.length) return;
    const lifetime = new AbortController();
    const abortOwner = () => lifetime.abort();
    const abortUnused = () => {
      if (live.every(row => row.controller.signal.aborted)) lifetime.abort();
    };
    captured.controller.signal.addEventListener('abort', abortOwner, { once: true });
    live.forEach(row => row.controller.signal.addEventListener('abort', abortUnused, { once: true }));
    try {
      current(captured);
      const results = await captured.rpc.dappReadBatch(live.map(row => row.request), lifetime.signal,
        () => current(captured));
      await verify(captured);
      current(captured);
      results.forEach((result, index) => {
        const row = live[index]!;
        if (row.controller.signal.aborted) row.reject(new EvmTransferReadError('CANCELLED'));
        else if (result.status === 'fulfilled') row.resolve(result.value);
        else row.reject(result.reason);
      });
    } catch (error) {
      live.forEach(row => row.reject(error));
    } finally {
      captured.controller.signal.removeEventListener('abort', abortOwner);
      live.forEach(row => row.controller.signal.removeEventListener('abort', abortUnused));
      lifetime.abort();
    }
  };
  const readQuery = async (captured: ReadOwner, request: DappPublicRpcRequest, controller: AbortController) => {
    await verify(captured);
    current(captured);
    if (controller.signal.aborted) throw new EvmTransferReadError('CANCELLED');
    if ((request.method === 'eth_call' || request.method === 'eth_estimateGas') &&
        (request.params[0] as { chainId?: string }).chainId !== undefined &&
        BigInt((request.params[0] as { chainId: string }).chainId) !== BigInt(ports.registration().chainId))
      throw new EthereumRpcErrorHandler(-32602, 'Transaction chainId does not match selected chain');
    if (!isReadOnlyRpcMethod(request.method))
      return captured.rpc.dappRequest(request, controller.signal, () => current(captured), () => verify(captured));
    return new Promise<unknown>((resolve, reject) => {
      captured.queued.push({ request, controller, resolve, reject });
      if (captured.queued.length === 1) queueMicrotask(() => void flushQueries(captured));
    });
  };
  const query = (
    captured: ReadOwner,
    request: DappPublicRpcRequest,
    signal: AbortSignal,
    check: () => void
  ) => {
    const requestKey = JSON.stringify(request);
    let shared = captured.pending.get(requestKey);
    if (!shared || shared.controller.signal.aborted) {
      if (captured.pending.size >= 32)
        return Promise.reject(new Error('Too many public reads'));
      const controller = new AbortController();
      const abort = () => controller.abort();
      captured.controller.signal.addEventListener('abort', abort, {
        once: true,
      });
      const next: SharedRead = {
        controller,
        subscribers: 0,
        settled: false,
        promise: Promise.resolve(),
      };
      captured.pending.set(requestKey, next);
      next.promise = readQuery(captured, request, controller)
        .catch((error) => {
          invalidateAfterFailure(captured, error, controller.signal);
          throw error;
        })
        .finally(() => {
          next.settled = true;
          captured.controller.signal.removeEventListener('abort', abort);
          if (captured.pending.get(requestKey) === next)
            captured.pending.delete(requestKey);
        });
      shared = next;
    }
    const selected = shared;
    selected.subscribers++;
    return new Promise<unknown>((resolve, reject) => {
      let complete = false;
      const finish = (value: unknown, error?: unknown) => {
        if (complete) return;
        complete = true;
        signal.removeEventListener('abort', abort);
        captured.controller.signal.removeEventListener('abort', abort);
        selected.subscribers--;
        if (!selected.subscribers && !selected.settled) {
          selected.controller.abort();
          if (captured.pending.get(requestKey) === selected)
            captured.pending.delete(requestKey);
          if (!captured.pending.size) captured.verification?.controller.abort();
        }
        try {
          current(captured);
          check();
          if (error !== undefined) throw error;
          resolve(JSON.parse(JSON.stringify(value)));
        } catch (cause) {
          reject(cause);
        }
      };
      const abort = () => finish(undefined, cancelled());
      signal.addEventListener('abort', abort, { once: true });
      captured.controller.signal.addEventListener('abort', abort, {
        once: true,
      });
      if (signal.aborted || captured.controller.signal.aborted) abort();
      selected.promise.then(
        (value) => finish(value),
        (error) => finish(undefined, error)
      );
    });
  };
  return Object.freeze({
    reset,
    async read(request, signal, assertCurrent) {
      const captured = capture();
      const check = () => {
        assertCurrent();
        current(captured);
        if (signal.aborted) throw cancelled();
      };
      check();
      const result = await executeDappRpcRequest(request, {
        assertCurrent: check,
        verifyPersonalMessage: ports.verifyPersonalMessage,
        request: (request) =>
          classifyDappRpcMethod(request.method) === 'node-query'
            ? query(captured, request, signal, check)
            : captured.rpc
                .dappRequest(request, signal, check, () =>
                  captured.rpc.verifyNetwork(signal, check)
                )
                .catch((error) => {
                  invalidateAfterFailure(captured, error, signal);
                  throw error;
                }),
      });
      check();
      return result;
    },
  });
}
