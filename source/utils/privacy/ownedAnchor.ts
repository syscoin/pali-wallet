import {
  type PrivacyAnchorRead,
  type PrivacyJsonResponse,
  readPrivacyRpcResponse,
  verifyPrivacySnapshotAnchor,
} from './publicSyncProtocol.ts';
import { getPrivacyPool, PRIVACY_CHAIN_ID } from './registry.ts';
import { validatePrivacyRpcUrl } from './snapshotValidation.ts';
import type { PrivacyPoolId, PrivacySnapshot } from './types.ts';

export type AnchorBinding = Readonly<{
  blockNumber: number;
  poolAddress: string;
  root: string;
  rpcUrl: string;
}>;

type AnchorOperation = Readonly<{
  // Cancels an incomplete operation and drains its exact handle before reuse.
  release(): Promise<void>;
  // The trusted port rechecks at native start and around pulls, including
  // after any bridge turn. The response belongs to this exact handle.
  start(
    assertCurrent: () => void
  ): Promise<PrivacyJsonResponse & Pick<Response, 'ok' | 'redirected' | 'url'>>;
}>;

type AnchorOwner = Readonly<{
  // Synchronous guard for the captured registration, pool, and owner generation.
  assertCurrent(): void;
  // Reserves the transport's sole slot without starting I/O.
  prepare(
    binding: AnchorBinding,
    read: PrivacyAnchorRead,
    id: number,
    signal: AbortSignal
  ): AnchorOperation;
  signal: AbortSignal;
  // A monotonic deadline for the whole run, including time between the anchors.
  timeoutMs: number;
}>;

const cancelled = () => new Error('privacy_cancelled');
let ownedRequestId = 0;

/** Owns the before-work and after-work checks for one validated public snapshot. */
export function createOwnedSnapshotAnchor(
  poolId: PrivacyPoolId,
  snapshot: PrivacySnapshot,
  registeredRpcUrl: string,
  { timeoutMs, signal, assertCurrent, prepare }: AnchorOwner
) {
  const rpcUrl = validatePrivacyRpcUrl(registeredRpcUrl);
  const poolAddress = getPrivacyPool(poolId).address;
  if (!rpcUrl.startsWith('https:')) throw new Error('privacy_rpc_unavailable');
  if (
    snapshot.poolAddress !== poolAddress ||
    snapshot.chainId !== PRIVACY_CHAIN_ID
  )
    throw new Error('privacy_data_invalid');
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 0x7fffffff
  )
    throw cancelled();

  const { asOfBlockNumber, asOfBlockHash, leafCount, root } = snapshot;
  const facts = Object.freeze({
    asOfBlockNumber,
    asOfBlockHash,
    leafCount,
    root,
  });
  const binding = Object.freeze({
    rpcUrl,
    poolAddress,
    blockNumber: asOfBlockNumber,
    root,
  });
  const ownerAbort = new AbortController();
  const deadline = performance.now() + timeoutMs;
  let closed = false;
  let pending = false;
  let passes = 0;
  const timer = setTimeout(close, timeoutMs);
  signal.addEventListener('abort', close, { once: true });
  if (signal.aborted) close();

  function retire() {
    closed = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', close);
  }

  function close() {
    if (closed) return;
    retire();
    ownerAbort.abort();
  }

  function checkLifetime() {
    if (!closed && performance.now() >= deadline) close();
    if (closed) throw cancelled();
  }

  function check() {
    checkLifetime();
    const returned = assertCurrent();
    if (returned !== undefined) {
      void Promise.resolve(returned).catch(() => undefined);
      throw cancelled();
    }
    checkLifetime();
  }

  async function read(kind: PrivacyAnchorRead) {
    check();
    const id = ++ownedRequestId;
    const handle = prepare(binding, kind, id, ownerAbort.signal);
    const release = handle.release.bind(handle);
    let draining: Promise<void> | undefined;
    const drain = () => (draining ??= Promise.resolve().then(release));
    const abortRead = () => {
      void drain().catch(() => undefined);
    };
    ownerAbort.signal.addEventListener('abort', abortRead, { once: true });
    try {
      check();
      const response = await handle.start(check);
      check();
      if (response.redirected || (response.url && response.url !== rpcUrl))
        throw new Error('privacy_rpc_unavailable');
      return await readPrivacyRpcResponse(response, id, kind === 'block');
    } finally {
      ownerAbort.signal.removeEventListener('abort', abortRead);
      await drain();
      check();
    }
  }

  async function verify(requestSignal: AbortSignal) {
    checkLifetime();
    if (pending) throw cancelled();
    pending = true;
    const onAbort = () => close();
    requestSignal.addEventListener('abort', onAbort, { once: true });
    if (requestSignal.aborted) close();

    // A held transport or release must not extend the owner's deadline.
    let refuse: () => void;
    const abandoned = new Promise<never>((_, reject) => {
      refuse = () => reject(cancelled());
      ownerAbort.signal.addEventListener('abort', refuse, { once: true });
      if (ownerAbort.signal.aborted) refuse();
    });
    try {
      // Keep the private owner retired on abort even while its native slot drains.
      const result = await Promise.race([
        abandoned,
        verifyPrivacySnapshotAnchor(poolId, facts, rpcUrl, ownerAbort.signal, {
          read,
        }),
      ]);
      check();
      if (++passes === 2) retire();
      return result;
    } catch (error) {
      close();
      throw error;
    } finally {
      requestSignal.removeEventListener('abort', onAbort);
      ownerAbort.signal.removeEventListener('abort', refuse!);
      pending = false;
    }
  }

  return { verify, close };
}
