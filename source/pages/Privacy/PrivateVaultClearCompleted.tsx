import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineFeedback } from 'components/InlineFeedback';
import { useUtils } from 'hooks/useUtils';

const isVisible = () => document.visibilityState !== 'hidden';
const actionClass =
  'rounded p-1 text-brand-royalbluemedium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50';

export default function PrivateVaultClearCompleted({
  confirming,
  controllerEmitter,
  earlierAttempts,
  noteId,
  onCancel,
  onComplete,
  onRemoved,
  onSelect,
}: {
  confirming: boolean;
  controllerEmitter: (...args: any[]) => Promise<unknown>;
  earlierAttempts?: number;
  noteId: string;
  onCancel: () => void;
  onComplete: () => void;
  onRemoved: (id: string) => void;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const { alert } = useUtils();
  const [pending, setPending] = useState<'latest' | 'earlier' | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const owner = useRef({ active: true, busy: false });
  useEffect(() => {
    owner.current.active = true;
    return () => {
      owner.current.active = false;
    };
  }, []);
  const clear = async (selection?: 'earlier') => {
    if (owner.current.busy || !confirming || !isVisible()) return;
    owner.current.busy = true;
    setPending(selection ?? 'latest');
    try {
      const value = (await controllerEmitter(
        ['privateVault', 'clearCompletedNotes'],
        selection ? [[noteId], selection] : [[noteId]],
        120000,
        false
      )) as { removed?: unknown; unresolved?: unknown } | null;
      if (
        !Array.isArray(value?.removed) ||
        !Array.isArray(value?.unresolved) ||
        value.removed.length + value.unresolved.length !== 1 ||
        (value.removed[0] ?? value.unresolved[0]) !== noteId
      )
        throw new Error('privacy_vault_unavailable');
      // A committed removal still belongs to the parent if the row unmounted.
      if (value.removed.length) onRemoved(noteId);
      else if (owner.current.active) setUnresolved(true);
    } catch (failure) {
      if (owner.current.active && isVisible())
        alert.error(
          t(
            failure instanceof Error &&
              failure.message === 'privacy_archive_limit'
              ? 'privacy.archive.full'
              : 'privacy.capacity.clearError'
          )
        );
    } finally {
      owner.current.busy = false;
      if (owner.current.active) setPending(null);
      onComplete();
    }
  };
  return (
    <div className="space-y-2 text-xs" aria-busy={!!pending}>
      {!confirming ? (
        <button
          type="button"
          className={actionClass}
          disabled={!!pending}
          onClick={() => {
            setUnresolved(false);
            onSelect();
          }}
        >
          {t('privacy.capacity.clear')}
        </button>
      ) : (
        <div
          className="space-y-2"
          role="group"
          aria-label={t('privacy.capacity.clear')}
        >
          <InlineFeedback>{t('privacy.capacity.clearHelp')}</InlineFeedback>
          <button
            type="button"
            className={actionClass}
            disabled={!!pending}
            onClick={() => void clear()}
          >
            {t(
              pending === 'latest'
                ? 'privacy.checking'
                : 'privacy.capacity.confirmClear'
            )}
          </button>{' '}
          <button
            type="button"
            className={actionClass}
            disabled={!!pending}
            onClick={onCancel}
          >
            {t('buttons.cancel')}
          </button>
          {!!earlierAttempts && (
            <div className="space-y-1">
              <p>
                {t('privacy.capacity.earlierAttempts', {
                  count: earlierAttempts,
                })}
              </p>
              {unresolved && (
                <>
                  <p>{t('privacy.capacity.checkEarlierHelp')}</p>
                  <button
                    type="button"
                    className={actionClass}
                    disabled={!!pending}
                    onClick={() => void clear('earlier')}
                  >
                    {t(
                      pending === 'earlier'
                        ? 'privacy.checking'
                        : 'privacy.capacity.checkEarlier'
                    )}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {confirming && unresolved && !pending && (
        <p role="status">
          {t('privacy.capacity.clearResult', { removed: 0, unresolved: 1 })}
        </p>
      )}
    </div>
  );
}
