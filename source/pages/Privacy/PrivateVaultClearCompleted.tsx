import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function PrivateVaultClearCompleted({
  controllerEmitter,
  noteIds,
  onComplete,
  onRemoved,
}: {
  controllerEmitter: (...args: any[]) => Promise<unknown>;
  noteIds: string[];
  onComplete: () => void;
  onRemoved: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    removed: number;
    unresolved: number;
  }>();
  const [error, setError] = useState(false);
  const [progress, setProgress] = useState({ checked: 0, total: 0 });
  const owner = useRef({ active: true, busy: false, revision: 0 });
  const current = (revision: number) =>
    owner.current.active &&
    owner.current.revision === revision &&
    document.visibilityState !== 'hidden';
  useEffect(() => {
    owner.current.active = true;
    return () => {
      owner.current.active = false;
      owner.current.revision++;
    };
  }, []);
  const clear = async () => {
    if (owner.current.busy || !confirming) return;
    owner.current.busy = true;
    const revision = ++owner.current.revision;
    const ids = [...new Set(noteIds)];
    setPending(true);
    setError(false);
    setResult(undefined);
    setProgress({ checked: 0, total: ids.length });
    let removed = 0;
    let unresolved = 0;
    try {
      for (let i = 0; i < ids.length; i += 1) {
        if (!current(revision)) return;
        const batch = ids.slice(i, i + 1);
        const value = (await controllerEmitter(
          ['privateVault', 'clearCompletedNotes'],
          [batch],
          120000,
          false
        )) as { removed?: unknown; unresolved?: unknown } | null;
        if (
          !value ||
          !Array.isArray(value.removed) ||
          !Array.isArray(value.unresolved)
        )
          throw new Error('privacy_vault_unavailable');
        const all = [...value.removed, ...value.unresolved];
        if (
          all.length !== batch.length ||
          new Set(all).size !== batch.length ||
          all.some((id) => typeof id !== 'string' || !batch.includes(id))
        )
          throw new Error('privacy_vault_unavailable');
        if (current(revision) && value.removed.length) onRemoved(value.removed);
        removed += value.removed.length;
        unresolved += value.unresolved.length;
        if (current(revision))
          setProgress({ checked: removed + unresolved, total: ids.length });
      }
      if (current(revision)) {
        setResult({ removed, unresolved });
        setConfirming(false);
        onComplete();
      }
    } catch {
      if (current(revision)) {
        setError(true);
        onComplete();
      }
    } finally {
      if (current(revision)) {
        owner.current.busy = false;
        setPending(false);
      }
    }
  };
  return (
    <div className="space-y-2 text-xs" aria-busy={pending}>
      {noteIds.length > 0 &&
        (!confirming ? (
          <button
            type="button"
            className="rounded p-1 text-brand-royalbluemedium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
            onClick={() => setConfirming(true)}
          >
            {t('privacy.capacity.clear')}
          </button>
        ) : (
          <div
            className="space-y-2"
            role="group"
            aria-label={t('privacy.capacity.clear')}
          >
            <p>{t('privacy.capacity.clearHelp')}</p>
            <button
              type="button"
              className="rounded p-1 text-brand-royalbluemedium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
              disabled={pending}
              onClick={() => void clear()}
            >
              {t('privacy.capacity.confirmClear')}
            </button>{' '}
            <button
              type="button"
              className="rounded p-1 text-brand-royalbluemedium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              {t('buttons.cancel')}
            </button>
          </div>
        ))}
      {pending && (
        <p role="status">{t('privacy.capacity.clearProgress', progress)}</p>
      )}
      {result && (
        <p role="status">{t('privacy.capacity.clearResult', result)}</p>
      )}
      {error && <p role="alert">{t('privacy.capacity.clearError')}</p>}
    </div>
  );
}
