import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import type { NativeConnectionsView, NativeSigningReview } from '../connections/types';
import { NativeLedgerConnectionModal } from './NativeLedger';

/** A device connection belongs to this review; connecting never approves it. */
export function useDappLedgerConnection({ review, controller, ledgerConnection }: {
  review: NativeSigningReview;
  controller: Pick<NativeConnectionsView, 'getSnapshot'>;
  ledgerConnection?: NativeLedgerConnectionView;
}) {
  const identity = `${review.id}:${review.revision}:${review.expiresAt}`;
  const [expiredIdentity, setExpiredIdentity] = useState<string | null>(null);
  const expired = expiredIdentity === identity;
  const available = !expired && !review.busy && !review.dispatched && !review.error && !review.needsAccountSwitch;
  const scope = useMemo(() => ({ controller, ledgerConnection, id: review.id, revision: review.revision,
    expiresAt: review.expiresAt, kind: review.kind, available }),
  [controller, ledgerConnection, review.id, review.revision, review.expiresAt, review.kind, available]);
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
      setExpiredIdentity(identity);
      if (held.current?.scope === scope) retire(held.current);
    }, Math.max(0, review.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [identity, ledgerConnection, review.expiresAt, scope, retire]);
  const isCurrent = () => {
    if (owner.current !== scope || !scope.available || Date.now() >= scope.expiresAt) return false;
    try {
      const current = controller.getSnapshot().signingReview;
      return current?.id === scope.id && current.revision === scope.revision && current.expiresAt === scope.expiresAt &&
        current.kind === scope.kind && !current.busy && !current.dispatched && !current.error && !current.needsAccountSwitch;
    } catch { return false; }
  };
  const activePicker = picker?.scope === scope && available ? picker : null;
  return {
    ready,
    blocked: !!ledgerConnection && (!ready || !!activePicker || expired),
    showConnect: !!ledgerConnection && !ready && available,
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
