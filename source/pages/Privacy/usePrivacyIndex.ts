import { useCallback, useEffect, useRef, useState } from 'react';

import { useController } from 'hooks/useController';
import type { PrivacyPoolId, PrivacySyncStatus } from 'utils/privacy/types';

const PHASES = ['idle', 'syncing', 'verifying', 'ready', 'paused', 'error'];

export function isPrivacySyncStatus(
  value: any,
  poolId: PrivacyPoolId
): value is PrivacySyncStatus {
  return (
    value?.poolId === poolId &&
    PHASES.includes(value.phase) &&
    ['blockNumber', 'completed', 'leafCount', 'total', 'verifiedAt'].every(
      (key) =>
        value[key] === undefined ||
        (Number.isSafeInteger(value[key]) && value[key] >= 0)
    )
  );
}

// Each mounted pool view owns its replies and its polling timer. The background
// keeps the public cache; neither account data nor a private note is an input.
export function usePrivacyIndex(poolId: PrivacyPoolId) {
  const { controllerEmitter } = useController();
  const [status, setStatus] = useState<PrivacySyncStatus>({
    phase: 'idle',
    poolId,
  });
  const [initialLoading, setInitialLoading] = useState(true);
  const [action, setAction] = useState<'start' | 'pause' | 'clear' | null>(
    null
  );
  const [unavailable, setUnavailable] = useState(false);
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  const owner = useRef({ active: false, revision: 0, action: false });

  const invoke = useCallback(
    async (method: 'getStatus' | 'start' | 'pause' | 'clear') => {
      const revision = ++owner.current.revision;
      try {
        const result = await controllerEmitter(
          ['privacy', method],
          [poolId],
          10000,
          false
        );
        if (!owner.current.active || revision !== owner.current.revision)
          return;
        if (!isPrivacySyncStatus(result, poolId)) {
          throw new Error('Invalid privacy preparation status');
        }
        setStatus(result);
        setUnavailable(false);
      } catch {
        if (owner.current.active && revision === owner.current.revision) {
          // Retain the last verified cache metadata when a status read fails.
          setUnavailable(true);
        }
      } finally {
        if (owner.current.active && revision === owner.current.revision) {
          setInitialLoading(false);
          setAction(null);
          owner.current.action = false;
        }
      }
    },
    [controllerEmitter, poolId]
  );

  useEffect(() => {
    owner.current.active = true;
    void invoke('getStatus');
    return () => {
      owner.current.active = false;
      owner.current.revision += 1;
    };
  }, [invoke]);

  useEffect(() => {
    const updateVisibility = () =>
      setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', updateVisibility);
    return () =>
      document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    if (initialLoading || action || !visible || unavailable) return;
    const delay = ['syncing', 'verifying'].includes(status.phase)
      ? 1500
      : ['ready', 'error'].includes(status.phase)
      ? 15000
      : undefined;
    if (delay === undefined) return;
    // Observe the local job only. Background refresh admission and remote
    // requests belong to the controller, never to this page's polling timer.
    const timer = setTimeout(() => void invoke('getStatus'), delay);
    return () => clearTimeout(timer);
  }, [action, initialLoading, invoke, status, unavailable, visible]);

  const run = (method: 'start' | 'pause' | 'clear') => {
    if (!owner.current.active || owner.current.action) return;
    owner.current.action = true;
    setAction(method);
    void invoke(method);
  };

  return { action, initialLoading, run, status, unavailable };
}
