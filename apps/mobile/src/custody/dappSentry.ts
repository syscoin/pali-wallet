import type { NativeSentryApprovals } from './sentryApprovals.ts';
import type { NativeSentryNodeManagement } from './sentryNodeManagement.ts';
import type { NativeConnectionSentryHost, NativeSentryAssent, NativeSentryDetails } from '../connections/sentryRequests.ts';

/** Every request opens a private instance of the existing typed Sentry consent lifecycle. */
export function createNativeDappSentryHost(ports: Readonly<{
  openApprovals(): Promise<NativeSentryApprovals>;
  openNodes(signal: AbortSignal, check: () => void): Promise<NativeSentryNodeManagement>;
}>): NativeConnectionSentryHost {
  let retained: NativeSentryApprovals | undefined;
  return Object.freeze({ revalidate() { retained?.operations.revalidate(); }, async prepare(request, signal, assertCurrent, assertGrantCurrent) {
    let disposed = false;
    if (typeof assertGrantCurrent !== 'function') throw new Error('SENTRY_AUTHORITY_REQUIRED');
    const check = () => { assertCurrent(); assertGrantCurrent(); if (disposed || signal.aborted) throw new Error('CONTEXT_CHANGED'); };
    check();
    if (request.method === 'sys_linkSentryNode') {
      const nodes = await ports.openNodes(signal, check);
      let approval: Awaited<ReturnType<typeof nodes.prepareLink>> | undefined;
      try {
        check(); approval = await nodes.prepareLink(request.raw, request.origin); check();
        const reviewed = approval;
        return Object.freeze({ details: Object.freeze({ kind: 'link' as const, approval: reviewed }), assertCurrent: check,
          async approve(assent: NativeSentryAssent, guard: () => void) {
            check(); guard(); if (assent.kind !== 'link') throw new Error('INVALID_INPUT');
            const result = await nodes.confirmLink(reviewed); check(); guard(); return result;
          },
          disclose: check,
          dispose() { disposed = true; nodes.cancelLink(reviewed.id); nodes.dispose(); } });
      } catch (cause) { if (approval) nodes.cancelLink(approval.id); nodes.dispose(); throw cause; }
    }
    const approvals = await ports.openApprovals();
    retained = approvals;
    const manager = request.method === 'sys_signSentryVote' ? approvals.votes : approvals.operations;
    let id: string | undefined;
    try {
      check(); id = await manager.prepare(request.raw, request.origin, assertGrantCurrent, { assertCurrent: check, signal }); check();
      const retained = id, vote = request.method === 'sys_signSentryVote';
      const details: NativeSentryDetails = vote ? { kind: 'vote', approval: approvals.votes.getApproval(retained) } : { kind: 'operation', approval: approvals.operations.getApproval(retained) };
      return Object.freeze({ details: Object.freeze(details), assertCurrent: check,
        async approve(assent: NativeSentryAssent, guard: () => void) {
          check(); guard(); if (assent.kind !== details.kind) throw new Error('INVALID_INPUT');
          const result = assent.kind === 'vote'
            ? await approvals.votes.sign({ id: retained })
            : await approvals.operations.sign({ id: retained, keyId: assent.keyId, authorizationId: assent.authorizationId });
          check(); guard(); return result;
        },
        disclose() { check(); if (!vote) approvals.operations.publishFeeAuthorization(retained); },
        dispose() { disposed = true; manager.cancel(retained); } });
    } catch (cause) { if (id) manager.cancel(id); throw cause; }
  } });
}
