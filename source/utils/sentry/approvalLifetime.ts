import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard';
import { dappSigningApprovalExpired } from '../../wallet/dappSigningApproval';
import store from 'state/store';
import { createDappApprovalLifetime } from 'utils/dappApprovalLifetime';

const sentryMethods = [
  'sys_signSentryOperation',
  'sys_signSentryVote',
  'sys_linkSentryNode',
];
type Approval = {
  assertCurrent(): void;
  disclose(): void;
  dispose(): void;
  method: string;
  release(): void;
  retainResponse(
    result: unknown,
    publication: Readonly<{ disclose(): void; retire(): void }>
  ): void;
  signal: AbortSignal;
};
const responses = new WeakMap<object, Approval>();

/** Request ownership stays live through the final runtime-channel disclosure. */
export function createSentryDappApprovalLifetime(
  method: string,
  assertOwner: () => void,
  parentSignal?: AbortSignal
): Approval {
  if (!sentryMethods.includes(method)) throw dappSigningApprovalExpired();
  const lifetime = createDappApprovalLifetime(() => {
    try {
      assertSynchronousEvmFeeGuard(assertOwner);
      return true;
    } catch {
      return false;
    }
  }, parentSignal);
  const unsubscribe = store.subscribe(lifetime.isCurrent);
  let retained = false;
  let publication: Readonly<{ disclose(): void; retire(): void }> | undefined;
  let disposed = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    publication?.retire();
    unsubscribe();
    if (timeout) clearTimeout(timeout);
    lifetime.signal.removeEventListener('abort', dispose);
    lifetime.dispose();
  };
  lifetime.signal.addEventListener('abort', dispose, { once: true });
  const assertCurrent = () => {
    if (!lifetime.isCurrent()) throw dappSigningApprovalExpired();
  };
  const approval: Approval = {
    method,
    assertCurrent,
    dispose,
    signal: lifetime.signal,
    disclose() {
      assertCurrent();
      if (!publication) throw dappSigningApprovalExpired();
      assertSynchronousEvmFeeGuard(publication.disclose);
    },
    retainResponse(result: unknown, retainedPublication) {
      assertCurrent();
      if (!result || typeof result !== 'object') return;
      if (retained) throw dappSigningApprovalExpired();
      if (
        !retainedPublication ||
        typeof retainedPublication.disclose !== 'function' ||
        typeof retainedPublication.retire !== 'function'
      )
        throw dappSigningApprovalExpired();
      publication = retainedPublication;
      retained = true;
      responses.set(result, approval);
      // Abandoned internal callers cannot retain a store subscription forever.
      // The dead capability remains in the WeakMap and still rejects disclosure.
      timeout = setTimeout(dispose, 10 * 60 * 1000);
    },
    release() {
      if (!retained) dispose();
    },
  };
  try {
    assertCurrent();
    return approval;
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Called synchronously immediately before Chrome receives a provider reply. */
export function assertSentryDappResponseCurrent(
  method: unknown,
  result: unknown
) {
  const approval =
    result && typeof result === 'object' ? responses.get(result) : undefined;
  if (
    !approval &&
    (typeof method !== 'string' || !sentryMethods.includes(method))
  )
    return;
  // Provider errors contain no accepted authorization response.
  if (
    !approval &&
    result &&
    typeof result === 'object' &&
    Object.keys(result).length === 1 &&
    'error' in result &&
    result.error &&
    typeof result.error === 'object' &&
    Object.keys(result.error).every(
      (key) => key === 'code' || key === 'message'
    ) &&
    'code' in result.error &&
    typeof result.error.code === 'number' &&
    'message' in result.error &&
    typeof result.error.message === 'string'
  )
    return;
  if (!result || typeof result !== 'object') throw dappSigningApprovalExpired();
  if (!approval) throw dappSigningApprovalExpired();
  try {
    if (approval.method !== method) throw dappSigningApprovalExpired();
    approval.assertCurrent();
    approval.disclose();
  } finally {
    responses.delete(result);
    approval.dispose();
  }
}
