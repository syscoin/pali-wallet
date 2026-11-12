import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FiCopy } from './Icon/Icon';

/** Explicit export of an already-visible secret; never reads or later clears the clipboard. */
export function SecretCopyButton({
  secret,
  isCurrent,
  label,
}: {
  isCurrent(): boolean;
  label: string;
  secret: string;
}) {
  const { t } = useTranslation();
  const owner = useRef({ live: false, secret, revision: 0, pending: false });
  const [feedback, setFeedback] = useState<'copied' | 'failed' | null>(null);
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    const state = owner.current;
    state.live = true;
    state.secret = secret;
    state.revision++;
    state.pending = false;
    setFeedback(null);
    setPending(false);
    return () => {
      state.live = false;
      state.secret = '';
      state.revision++;
    };
  }, [secret]);
  const copy = () => {
    const state = owner.current,
      revision = state.revision;
    if (
      !state.live ||
      state.pending ||
      state.secret !== secret ||
      !authorized()
    )
      return;
    state.pending = true;
    setPending(true);
    setFeedback(null);
    const current = () =>
      state.live &&
      state.revision === revision &&
      state.secret === secret &&
      authorized();
    let writing: Promise<void>;
    try {
      writing = Promise.resolve(navigator.clipboard.writeText(secret));
    } catch (error) {
      writing = Promise.reject(error);
    }
    void writing
      .then(
        () => {
          if (current()) setFeedback('copied');
        },
        () => {
          if (current()) setFeedback('failed');
        }
      )
      .finally(() => {
        if (current()) {
          state.pending = false;
          setPending(false);
        }
      });
  };
  function authorized() {
    try {
      return isCurrent() === true;
    } catch {
      return false;
    }
  }
  return (
    <div className="mt-3 text-left">
      <p className="text-xs text-brand-gray200">
        {t('secretClipboard.warning')}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={copy}
        className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-brand-blue200 px-4 text-sm text-brand-blue200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue200 disabled:opacity-50"
      >
        <FiCopy aria-hidden="true" size={16} />
        {label}
      </button>
      {feedback && (
        <p
          role={feedback === 'failed' ? 'alert' : 'status'}
          className="mt-2 text-xs"
        >
          {t(
            feedback === 'copied'
              ? 'components.copied'
              : 'transactions.copyFailed'
          )}
        </p>
      )}
    </div>
  );
}
