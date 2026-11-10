import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import type { NativePsbtReview } from '../connections/psbtRequests';
import type { NativeConnectionsView, NativeSigningReview } from '../connections/types';
import { NativeLedgerConnectionModal } from './NativeLedger';

type Review = NativeSigningReview | NativePsbtReview;
const reviewKindIsAuthorizable = (review: Review) => !('kind' in review) || review.kind !== 'smart-transaction' || review.operation.phase === 'authorize';
const kind = (review: Review) => 'attempted' in review ? 'psbt' : review.kind;
const availableReview = (review: Review) => (reviewKindIsAuthorizable(review)) && !review.busy && !review.error && ('attempted' in review
  ? !review.attempted && !!review.details
  : !review.dispatched && !review.needsAccountSwitch);

/** Reuse the existing picker for a host-owned review; connecting never authorizes it. */
export function useOwnedLedgerConnection({ owner: source, revision, expiresAt, available, isReviewCurrent, ledgerConnection }: {
  owner: object;
  revision: string | number;
  expiresAt: number;
  available: boolean;
  isReviewCurrent(): boolean;
  ledgerConnection?: NativeLedgerConnectionView;
}) {
  const scope = useMemo(() => ({ source, revision, expiresAt, available, isReviewCurrent, ledgerConnection }),
    [source, revision, expiresAt, available, isReviewCurrent, ledgerConnection]);
  const [expiredScope, setExpiredScope] = useState<object | null>(null);
  const expired = expiredScope === scope;
  const allowed = available && !expired;
  type Picker = { scope: typeof scope; source: NativeLedgerConnectionView; controller: NativeLedgerConnectionView };
  const owner = useRef<typeof scope | null>(scope), held = useRef<Picker | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const ready = useSyncExternalStore(
    listener => ledgerConnection?.subscribe(listener) ?? (() => undefined),
    () => ledgerConnection?.isConnected() ?? true,
    () => false,
  );
  const retire = useCallback((ticket: Picker) => {
    if (held.current !== ticket) return;
    held.current = null;
    setPicker(current => current === ticket ? null : current);
    void ticket.source.close().catch(() => undefined);
  }, []);
  useLayoutEffect(() => {
    owner.current = scope;
    return () => {
      if (owner.current === scope) owner.current = null;
      if (held.current?.scope === scope) retire(held.current);
    };
  }, [scope, retire]);
  useEffect(() => {
    if (!ledgerConnection) return;
    const timer = setTimeout(() => {
      setExpiredScope(scope);
      if (held.current?.scope === scope) retire(held.current);
    }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [ledgerConnection, expiresAt, scope, retire]);
  const isCurrent = () => {
    if (owner.current !== scope || !scope.available || Date.now() >= scope.expiresAt) return false;
    try {
      return scope.isReviewCurrent();
    } catch { return false; }
  };
  const activePicker = picker?.scope === scope && allowed ? picker : null;
  return {
    ready,
    blocked: !!ledgerConnection && (!ready || !!activePicker || expired),
    showConnect: !!ledgerConnection && !ready && allowed,
    canApprove: () => !ledgerConnection || isCurrent() && !held.current && ledgerConnection.isConnected(),
    connect() {
      if (!ledgerConnection || held.current || !isCurrent() || ledgerConnection.isConnected()) return;
      let ticket: Picker;
      const check = () => {
        if (held.current !== ticket || !isCurrent()) throw new Error('REQUEST_EXPIRED');
      };
      const invoke = async <T,>(operation: () => Promise<T>): Promise<T> => {
        check(); const value = await operation(); check(); return value;
      };
      const bound: NativeLedgerConnectionView = {
        purpose: 'connect',
        getSnapshot: () => ledgerConnection.getSnapshot(),
        subscribe: listener => ledgerConnection.subscribe(() => { if (held.current === ticket) listener(); }),
        isConnected: () => held.current === ticket && ledgerConnection.isConnected(),
        start: () => invoke(() => ledgerConnection.start()),
        select: id => invoke(() => ledgerConnection.select(id)),
        finishConnection: () => invoke(() => ledgerConnection.finishConnection()),
        close: () => held.current === ticket ? ledgerConnection.close() : Promise.resolve(),
      };
      ticket = { scope, source: ledgerConnection, controller: bound };
      held.current = ticket; setPicker(ticket);
    },
    modal: activePicker ? <NativeLedgerConnectionModal controller={activePicker.controller}
      onClose={() => retire(activePicker)} onFinished={() => retire(activePicker)} /> : null,
  };
}

/** Dapp identity and current request state remain owned by the connection controller. */
export function useDappLedgerConnection({review, controller, ledgerConnection}: {
  review: Review;
  controller: Pick<NativeConnectionsView, 'getSnapshot'>;
  ledgerConnection?: NativeLedgerConnectionView;
}) {
  const reviewKind = kind(review);
  const isReviewCurrent = useCallback(() => {
    const snapshot = controller.getSnapshot();
    const current = reviewKind === 'psbt' ? snapshot.psbtReview : snapshot.signingReview;
    return current?.id === review.id && current.revision === review.revision && current.expiresAt === review.expiresAt &&
      kind(current) === reviewKind && availableReview(current);
  }, [controller, review.id, review.revision, review.expiresAt, reviewKind]);
  return useOwnedLedgerConnection({owner: controller, revision: `${reviewKind}:${review.id}:${review.revision}`, expiresAt: review.expiresAt,
    available: availableReview(review), isReviewCurrent, ledgerConnection});
}
