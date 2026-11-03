import { Form } from 'antd';
import React, {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ValidatedPasswordInput } from 'components/Input/ValidatedPasswordInput';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { verifiedNoteBalance } from 'utils/privacy/balance';
import type { IPrivateNoteView } from 'utils/privacy/privateVaultTypes';

import PrivateDeposit from './PrivateDeposit';
import PrivateNoteBackupDialog from './PrivateNoteBackupDialog';
import PrivateVaultCapacitySettings from './PrivateVaultCapacitySettings';
import PrivateVaultClearCompleted from './PrivateVaultClearCompleted';
import PrivateWithdrawal from './PrivateWithdrawal';
import { usePrivateNotes } from './usePrivateNotes';

const PrivateNoteBundleDialog = lazy(
  () =>
    import(
      /* webpackChunkName: "private-note-bundle-dialog" */ './PrivateNoteBundleDialog'
    )
);

const actionClass =
  'rounded p-1 text-xs text-brand-royalbluemedium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50';
const fieldClass =
  'block w-full resize-y rounded-lg border border-alpha-whiteAlpha300 bg-bkg-4 p-3 text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-royalblue';

function importError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  switch (message) {
    case 'privacy_note_invalid':
      return 'noteInvalid';
    case 'privacy_note_not_found':
      return 'noteNotFound';
    case 'privacy_verification_pending':
      return 'notePending';
    case 'privacy_note_duplicate':
      return 'noteDuplicate';
    case 'privacy_note_limit':
      return 'noteLimit';
    default:
      return 'noteImportFailed';
  }
}

function NotesView() {
  const { t } = useTranslation();
  const {
    controllerEmitter,
    loading,
    notes,
    refresh,
    remember,
    forget,
    unavailable,
    unsupportedFormat,
  } = usePrivateNotes();
  const verificationPending = notes.some(
    ({ phase }) => phase === 'waiting' || phase === 'not-found'
  );
  const [form] = Form.useForm();
  const [importing, setImporting] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState('');
  const [deposit, setDeposit] = useState(false);
  const [capacitySettings, setCapacitySettings] = useState(false);
  const [showSpent, setShowSpent] = useState(false);
  const [backupNoteId, setBackupNoteId] = useState<string | null>(null);
  const [bundleMode, setBundleMode] = useState<'export' | 'import' | null>(
    null
  );
  const [withdrawing, setWithdrawing] = useState<IPrivateNoteView | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [reportedStatus, setReportedStatus] = useState<{
    id: string;
    status: string;
  } | null>(null);
  const owner = useRef({ active: true, revision: 0 });
  const importField = useRef<HTMLTextAreaElement>(null);
  const statusRevisions = useRef(new Map<string, number>());
  const clear = () => {
    setCapacitySettings(false);
    owner.current.revision += 1;
    setStatusNote(null);
    setImporting(false);
    setNoteText('');
    setPending(false);
    setError('');
    setSelected(null);
    setRevealed('');
    if (selected && !revealed) form.resetFields();
  };
  const current = (revision: number) =>
    owner.current.active &&
    owner.current.revision === revision &&
    document.visibilityState !== 'hidden';

  useLayoutEffect(() => {
    owner.current.active = true;
    return () => {
      owner.current.active = false;
      owner.current.revision += 1;
    };
  }, []);
  useEffect(() => {
    if (importing) importField.current?.focus();
  }, [importing]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || !noteText.trim()) return;
    const revision = owner.current.revision;
    setPending(true);
    setError('');
    try {
      const result = await controllerEmitter(
        ['privateVault', 'importNote'],
        [noteText],
        30000,
        false
      );
      if (!current(revision)) return;
      remember(result);
      clear();
    } catch (failure) {
      if (current(revision)) setError(importError(failure));
    } finally {
      if (current(revision)) setPending(false);
    }
  };

  const content = withdrawing ? (
    <PrivateWithdrawal
      note={withdrawing}
      onBack={() => {
        setWithdrawing(null);
        void refresh();
      }}
    />
  ) : deposit ? (
    <PrivateDeposit
      onBack={() => {
        setBackupNoteId(null);
        setDeposit(false);
        void refresh();
      }}
      onBackup={setBackupNoteId}
    />
  ) : (
    <section
      aria-labelledby="privacy-notes-title"
      className="space-y-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape') clear();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="privacy-notes-title" className="text-sm font-medium text-white">
          {t('privacy.yourNotes')}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {!importing && (
            <button
              type="button"
              className={actionClass}
              onClick={() => {
                if (capacitySettings) setCapacitySettings(false);
                else {
                  clear();
                  setCapacitySettings(true);
                }
              }}
              aria-expanded={capacitySettings}
            >
              {t('privacy.capacity.settings')}
            </button>
          )}
          {!importing && (
            <button
              type="button"
              className={actionClass}
              onClick={() => {
                clear();
                setDeposit(true);
              }}
            >
              {t('privacy.deposit.title')}
            </button>
          )}
          {notes.length > 0 && !importing && (
            <button
              type="button"
              className={actionClass}
              disabled={loading}
              onClick={() => void refresh()}
              aria-label={t('privacy.refreshNotes')}
            >
              {t('privacy.refresh')}
            </button>
          )}
          {!importing && (
            <button
              type="button"
              className={actionClass}
              aria-expanded={false}
              aria-controls="privacy-import-form"
              onClick={() => {
                clear();
                setImporting(true);
              }}
            >
              {t('privacy.importNote')}
            </button>
          )}
          {!importing && (
            <>
              <button
                type="button"
                className={actionClass}
                disabled={loading || unavailable || !notes.length}
                onClick={() => {
                  clear();
                  setBundleMode('export');
                }}
              >
                {t('privacy.bundle.exportTitle')}
              </button>
              <button
                type="button"
                className={actionClass}
                onClick={() => {
                  clear();
                  setBundleMode('import');
                }}
              >
                {t('privacy.bundle.importTitle')}
              </button>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-brand-gray200">{t('privacy.notesLocal')}</p>
      {importing && (
        <form
          id="privacy-import-form"
          onSubmit={submit}
          className="space-y-2"
          autoComplete="off"
        >
          <label
            htmlFor="privacy-import-note"
            className="block text-xs text-white"
          >
            {t('privacy.noteLabel')}
          </label>
          <textarea
            ref={importField}
            id="privacy-import-note"
            className={fieldClass}
            value={noteText}
            onChange={(event) => {
              setNoteText(event.target.value);
              setError('');
            }}
            rows={3}
            maxLength={512}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            readOnly={pending}
            aria-invalid={error === 'noteInvalid' || undefined}
            aria-describedby={
              error === 'noteInvalid'
                ? 'privacy-note-help privacy-note-error'
                : 'privacy-note-help'
            }
          />
          <p id="privacy-note-help" className="text-xs text-brand-gray200">
            {t('privacy.noteSecret')}
          </p>
          {error && (
            <p
              id="privacy-note-error"
              role="alert"
              className="text-xs text-brand-red"
            >
              {t(`privacy.${error}`)}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className={actionClass}
              disabled={pending || !noteText.trim()}
              aria-busy={pending}
            >
              {t(pending ? 'privacy.checking' : 'privacy.importNote')}
            </button>
            <button type="button" className={actionClass} onClick={clear}>
              {t('buttons.cancel')}
            </button>
          </div>
        </form>
      )}
      {capacitySettings && (
        <PrivateVaultCapacitySettings
          controllerEmitter={controllerEmitter}
          noteCount={notes.length}
        />
      )}
      {!capacitySettings &&
        !importing &&
        !selected &&
        notes.some((note) => note.phase === 'spent') && (
          <div className="space-y-2 text-xs">
            <button
              type="button"
              className={actionClass}
              aria-expanded={showSpent}
              onClick={() => setShowSpent((value) => !value)}
            >
              {t('privacy.capacity.reportedSpent', {
                count: notes.filter((note) => note.phase === 'spent').length,
              })}
            </button>
          </div>
        )}
      {!capacitySettings && !importing && !selected && (
        <PrivateVaultClearCompleted
          controllerEmitter={controllerEmitter}
          noteIds={notes
            .filter(
              (note) =>
                note.phase === 'spent' ||
                (note.withdrawal?.phase === 'submitted' &&
                  note.withdrawal.transactionHash)
            )
            .map((note) => note.id)}
          onRemoved={(ids) => {
            if (!owner.current.active || document.visibilityState === 'hidden')
              return;
            for (const id of ids)
              statusRevisions.current.set(
                id,
                (statusRevisions.current.get(id) || 0) + 1
              );
            forget(ids);
            setStatusNote((current) =>
              current && ids.includes(current) ? null : current
            );
            setStatusError((current) =>
              current && ids.includes(current) ? null : current
            );
            setReportedStatus((current) =>
              current && ids.includes(current.id) ? null : current
            );
          }}
          onComplete={() => {
            if (owner.current.active && document.visibilityState !== 'hidden')
              void refresh();
          }}
        />
      )}
      <div
        role="status"
        aria-live="polite"
        className="text-xs text-brand-gray200"
      >
        {loading
          ? t('privacy.checking')
          : unavailable
          ? t(
              unsupportedFormat
                ? 'privacy.notesUnsupported'
                : 'privacy.notesUnavailable'
            )
          : !notes.length
          ? t('privacy.noNotes')
          : null}
        {(notes.length > 0 || (!loading && !unavailable)) && (
          <p className="text-white">
            {t('privacy.verifiedBalance', {
              amount: verifiedNoteBalance(notes),
            })}
          </p>
        )}
        {verificationPending && <p>{t('privacy.balancePending')}</p>}
      </div>
      {unavailable && (
        <button
          type="button"
          className={actionClass}
          onClick={() => void refresh()}
        >
          {t('privacy.retry')}
        </button>
      )}
      <ul className="space-y-2">
        {notes
          .filter((note) => note.phase !== 'spent' || showSpent)
          .map((note) => (
            <li
              key={note.id}
              className="rounded-lg border border-alpha-whiteAlpha300 p-3 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-white">
                  {note.amount} ETH
                </span>
                <span className="text-brand-gray200">
                  {t(`privacy.notePhase.${note.phase}`)}
                </span>
              </div>
              {note.blockNumber !== undefined && (
                <p className="text-xs text-brand-gray200">
                  {t('privacy.noteAsOfBlock', { block: note.blockNumber })}
                </p>
              )}
              {note.withdrawal && (
                <div className="space-y-2 text-xs text-brand-gray200">
                  {note.phase !== 'spent' && (
                    <p>
                      {t(
                        `privacy.withdrawal.${
                          note.withdrawal.phase === 'unknown'
                            ? 'statusUnknown'
                            : 'statusPending'
                        }`
                      )}
                    </p>
                  )}
                  {note.withdrawal.transactionHash && (
                    <p className="break-all">
                      {t('privacy.deposit.txHash')}:{' '}
                      {note.withdrawal.transactionHash}
                    </p>
                  )}
                  {note.withdrawal.jobId && (
                    <p className="break-all">
                      {t('privacy.withdrawal.jobId')}: {note.withdrawal.jobId}
                    </p>
                  )}
                  {note.withdrawal.mode === 'relayed' &&
                    note.withdrawal.jobId && (
                      <button
                        type="button"
                        className={actionClass}
                        disabled={statusNote !== null}
                        onClick={async () => {
                          const revision = owner.current.revision;
                          const statusRevision =
                            statusRevisions.current.get(note.id) || 0;
                          const statusCurrent = () =>
                            current(revision) &&
                            (statusRevisions.current.get(note.id) || 0) ===
                              statusRevision;
                          setStatusNote(note.id);
                          setStatusError(null);
                          try {
                            const result = await controllerEmitter(
                              ['privacyWithdrawals', 'statusByNote'],
                              [note.id],
                              30000,
                              false
                            );
                            if (statusCurrent()) {
                              const status = (
                                result as { claimedStatus?: unknown } | null
                              )?.claimedStatus;
                              if (
                                [
                                  'QUEUED',
                                  'ACCEPTED',
                                  'SENT',
                                  'MINED',
                                  'RESUBMITTED',
                                  'CONFIRMED',
                                  'FAILED',
                                ].includes(
                                  typeof status === 'string' ? status : ''
                                )
                              )
                                setReportedStatus({
                                  id: note.id,
                                  status: String(status),
                                });
                              await refresh(true);
                            }
                          } catch {
                            if (statusCurrent()) setStatusError(note.id);
                          } finally {
                            if (statusCurrent()) setStatusNote(null);
                          }
                        }}
                      >
                        {t('privacy.withdrawal.checkStatus')}
                      </button>
                    )}
                  {statusError === note.id && (
                    <p role="alert">{t('privacy.withdrawal.statusFailed')}</p>
                  )}
                  {reportedStatus?.id === note.id && (
                    <p>
                      {t('privacy.withdrawal.reportedStatus', {
                        status: reportedStatus.status,
                      })}
                    </p>
                  )}
                </div>
              )}
              {note.phase === 'verified' && !note.withdrawal && (
                <button
                  type="button"
                  className={actionClass}
                  onClick={() => {
                    clear();
                    setWithdrawing(note);
                  }}
                >
                  {t('privacy.withdrawal.open')}
                </button>
              )}
              {selected !== note.id ? (
                <button
                  type="button"
                  className={actionClass}
                  aria-label={t('privacy.revealNoteLabel', {
                    amount: note.amount,
                  })}
                  onClick={() => {
                    clear();
                    setSelected(note.id);
                  }}
                >
                  {t('privacy.revealNote')}
                </button>
              ) : (
                <div className="space-y-2">
                  {revealed ? (
                    <>
                      <label
                        htmlFor="privacy-revealed-note"
                        className="block text-xs text-white"
                      >
                        {t('privacy.privateNote')}
                      </label>
                      <textarea
                        id="privacy-revealed-note"
                        className={fieldClass}
                        readOnly
                        rows={3}
                        value={revealed}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <p className="text-xs text-brand-gray200">
                        {t('privacy.noteSecret')}
                      </p>
                    </>
                  ) : (
                    <Form form={form} autoComplete="off">
                      <label
                        htmlFor="privacy-note-password"
                        className="block text-xs text-white mb-2"
                      >
                        {t('privacy.revealPassword')}
                      </label>
                      <ValidatedPasswordInput
                        id="privacy-note-password"
                        form={form}
                        validationTrigger="submit"
                        errorMessage={t('privacy.noteRevealFailed')}
                        placeholder={t('settings.enterYourPassword')}
                        onValidate={async (password) => {
                          const revision = owner.current.revision;
                          try {
                            const value = await controllerEmitter(
                              ['privateVault', 'revealNote'],
                              [note.id, password],
                              30000,
                              false
                            );
                            if (!current(revision)) return undefined;
                            if (
                              typeof value !== 'string' ||
                              !value ||
                              value.length > 512
                            )
                              throw new Error();
                            return { value, revision };
                          } catch {
                            // The shared password input logs errors; never pass through
                            // a controller response that could contain a secret.
                            throw new Error('privacy_note_reveal_failed');
                          }
                        }}
                        onValidationSuccess={(result) => {
                          if (result && current(result.revision)) {
                            form.resetFields();
                            setError('');
                            setRevealed(result.value);
                          }
                        }}
                        onValidationError={() => setError('noteRevealFailed')}
                        onValidationReset={() => {
                          setRevealed('');
                          setError('');
                        }}
                      />
                    </Form>
                  )}
                  <button type="button" className={actionClass} onClick={clear}>
                    {t('privacy.hideNote')}
                  </button>
                </div>
              )}
            </li>
          ))}
      </ul>
    </section>
  );
  return (
    <>
      {content}
      {/* Keep the deposit review mounted while the local backup dialog is open. */}
      <PrivateNoteBackupDialog
        noteId={backupNoteId}
        onClose={() => setBackupNoteId(null)}
      />
      {bundleMode && (
        <Suspense fallback={null}>
          <PrivateNoteBundleDialog
            mode={bundleMode}
            onClose={() => setBundleMode(null)}
            onRestored={() => void refresh()}
          />
        </Suspense>
      )}
    </>
  );
}

export default function PrivateNotes() {
  const { isUnlocked, isLoading, connectionUnavailable } = useController();
  const scope = useSelector((state: RootState) => {
    const {
      activeAccount: ref,
      accounts,
      passkeyCredentialProfile,
    } = state.vault;
    const account = ref && accounts?.[ref.type]?.[ref.id];
    return JSON.stringify([
      ref?.type,
      ref?.id,
      account?.address,
      account?.xpub,
      passkeyCredentialProfile?.credentialIdHash,
      state.vaultGlobal.activeSlip44,
      state.vaultGlobal.lastLogin,
      state.vaultGlobal.isSwitchingAccount,
    ]);
  });
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  useEffect(() => {
    const visibility = () => setVisible(document.visibilityState !== 'hidden');
    const hide = () => setVisible(false);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', visibility);
    };
  }, []);
  // A new scope gets a new component, including a fresh password form.
  // The vault listing itself has no account or network filter.
  if (!visible || !isUnlocked || isLoading || connectionUnavailable)
    return null;
  return <NotesView key={scope} />;
}
