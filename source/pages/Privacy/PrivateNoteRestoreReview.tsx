import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Local password-confirmed review; it neither makes an RPC call nor starts a withdrawal. */
export default function PrivateNoteRestoreReview({
  id,
  blockNumber,
  controllerEmitter,
  onReviewed,
}: {
  blockNumber?: number;
  controllerEmitter: (...args: any[]) => Promise<unknown>;
  id: string;
  onReviewed: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const owner = useRef({ active: true, busy: false, revision: 0 });
  useEffect(() => {
    const local = owner.current;
    local.active = true;
    setPassword('');
    setOpen(false);
    setFailed(false);
    const hide = () => {
      local.revision++;
      setPassword('');
      setOpen(false);
      setFailed(false);
    };
    const change = () => {
      if (document.visibilityState === 'hidden') hide();
    };
    document.addEventListener('visibilitychange', change);
    window.addEventListener('pagehide', hide);
    return () => {
      local.active = false;
      local.revision++;
      document.removeEventListener('visibilitychange', change);
      window.removeEventListener('pagehide', hide);
    };
  }, [id]);
  const current = (revision: number) =>
    owner.current.active &&
    owner.current.revision === revision &&
    document.visibilityState !== 'hidden';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      owner.current.busy ||
      !password ||
      document.visibilityState === 'hidden'
    )
      return;
    const value = password,
      revision = owner.current.revision;
    owner.current.busy = true;
    setBusy(true);
    setPassword('');
    setFailed(false);
    try {
      await controllerEmitter(
        ['privateVault', 'reviewRestoredNote'],
        [id, value],
        120000,
        false
      );
      if (current(revision)) setOpen(false);
    } catch {
      if (current(revision)) setFailed(true);
    } finally {
      owner.current.busy = false;
      if (owner.current.active) setBusy(false);
      // A lost acknowledgement can follow a successful write. Refresh, never replay.
      if (current(revision)) onReviewed();
    }
  };
  const action =
    'rounded p-1 text-xs text-brand-royalbluemedium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50';
  if (!open)
    return (
      <button
        type="button"
        className={action}
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        {t('privacy.restoreReview.action')}
      </button>
    );
  return (
    <form
      className="space-y-2 text-xs text-brand-gray200"
      onSubmit={submit}
      autoComplete="off"
      aria-busy={busy}
    >
      <p>{t('privacy.restoreReview.help')}</p>
      <p>{t('privacy.restoreReview.disclosure')}</p>
      <p>
        {blockNumber === undefined
          ? t('privacy.restoreReview.noSnapshot')
          : t('privacy.restoreReview.snapshot', { block: blockNumber })}
      </p>
      <label className="block" htmlFor={`restore-review-${id}`}>
        {t('privacy.restoreReview.password')}
      </label>
      <input
        id={`restore-review-${id}`}
        type="password"
        autoComplete="off"
        maxLength={1024}
        value={password}
        disabled={busy}
        className="w-full rounded border border-alpha-whiteAlpha300 bg-bkg-4 p-2 text-white"
        onChange={(event) => setPassword(event.target.value)}
      />
      {failed && <p role="alert">{t('privacy.restoreReview.failed')}</p>}
      {busy && <p role="status">{t('privacy.restoreReview.busy')}</p>}
      <button type="submit" className={action} disabled={busy || !password}>
        {t('privacy.restoreReview.confirm')}
      </button>
      <button
        type="button"
        className={action}
        disabled={busy}
        onClick={() => {
          owner.current.revision++;
          setPassword('');
          setOpen(false);
          setFailed(false);
        }}
      >
        {t('buttons.cancel')}
      </button>
    </form>
  );
}
