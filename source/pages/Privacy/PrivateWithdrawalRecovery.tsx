import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Explicit consent precedes any note-specific RPC request or durable change. */
export default function PrivateWithdrawalRecovery({
  id,
  controllerEmitter,
  onRecovered,
}: {
  controllerEmitter: (...args: any[]) => Promise<unknown>;
  id: string;
  onRecovered: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const owner = useRef({ active: true, busy: false, revision: 0 });
  useEffect(() => {
    owner.current.active = true;
    return () => {
      owner.current.active = false;
      owner.current.revision++;
    };
  }, []);
  const current = (revision: number) =>
    owner.current.active &&
    owner.current.revision === revision &&
    document.visibilityState !== 'hidden';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (owner.current.busy || !password) return;
    const value = password,
      revision = owner.current.revision;
    owner.current.busy = true;
    setBusy(true);
    setFailed(false);
    setPassword('');
    try {
      await controllerEmitter(
        ['privateVault', 'recoverFailedWithdrawal'],
        [id, value],
        120000,
        false
      );
      if (current(revision)) setOpen(false);
    } catch {
      if (current(revision)) setFailed(true);
    } finally {
      // Refresh even after a lost acknowledgement; a durable recovery is never replayed automatically.
      if (current(revision)) {
        owner.current.busy = false;
        setBusy(false);
        onRecovered();
      }
    }
  };
  const action =
    'rounded p-1 text-brand-royalbluemedium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50';
  if (!open)
    return (
      <button type="button" className={action} onClick={() => setOpen(true)}>
        {t('privacy.recovery.action')}
      </button>
    );
  return (
    <form
      className="space-y-2"
      onSubmit={submit}
      autoComplete="off"
      aria-busy={busy}
    >
      <p>{t('privacy.recovery.help')}</p>
      <p>{t('privacy.recovery.disclosure')}</p>
      <label className="block" htmlFor={`recover-${id}`}>
        {t('privacy.recovery.password')}
      </label>
      <input
        id={`recover-${id}`}
        type="password"
        autoComplete="off"
        maxLength={1024}
        value={password}
        disabled={busy}
        className="w-full rounded border border-alpha-whiteAlpha300 bg-bkg-4 p-2 text-white"
        onChange={(event) => setPassword(event.target.value)}
      />
      {failed && <p role="alert">{t('privacy.recovery.failed')}</p>}
      {busy && <p role="status">{t('privacy.recovery.checking')}</p>}
      <button type="submit" className={action} disabled={busy || !password}>
        {t('privacy.recovery.confirm')}
      </button>
      <button
        type="button"
        className={action}
        disabled={busy}
        onClick={() => {
          setPassword('');
          setOpen(false);
          setFailed(false);
          owner.current.revision++;
        }}
      >
        {t('buttons.cancel')}
      </button>
    </form>
  );
}
