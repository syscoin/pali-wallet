import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { NativeSmartAccountOperation } from '../smartAccount/operation';

type Attempt = Readonly<{ operation: NativeSmartAccountOperation; revision: number }>;
const emptySubscribe = () => () => undefined;
const emptyRevision = () => null;

function pendingRevision(operation: NativeSmartAccountOperation | null | undefined) {
  const snapshot = operation?.getSnapshot();
  return snapshot?.phase === 'waiting' && snapshot.transactionHash ? snapshot.revision : null;
}

export function useSmartAccountSubmissionLeave(
  currentOperation: () => NativeSmartAccountOperation | null | undefined,
  close: () => void
) {
  const latest = useRef<Attempt | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const revision = useSyncExternalStore(
    attempt?.operation.subscribe ?? emptySubscribe,
    () => pendingRevision(attempt?.operation),
    emptyRevision
  );
  const visible = attempt !== null && attempt.revision === revision && attempt.operation === currentOperation();

  const update = useCallback((next: Attempt | null) => {
    latest.current = next;
    setAttempt(next);
  }, []);
  useLayoutEffect(() => {
    if (attempt && !visible && latest.current === attempt) update(null);
  }, [attempt, update, visible]);

  const requestBack = useCallback((): false | undefined => {
    const operation = currentOperation();
    const revision = pendingRevision(operation);
    if (operation && revision !== null) {
      if (latest.current?.operation !== operation || latest.current.revision !== revision) update({ operation, revision });
      return false;
    }
    update(null);
    close();
  }, [close, currentOperation, update]);

  return {
    requestBack,
    visible,
    stay: () => { if (latest.current === attempt) update(null); },
    leave: () => {
      if (!attempt || latest.current !== attempt) return;
      update(null);
      if (attempt.operation === currentOperation() && pendingRevision(attempt.operation) === attempt.revision) close();
    },
  };
}
