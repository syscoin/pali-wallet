import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  CenterPanel,
  DialogActionButton,
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogPrimitive,
} from 'components/Dialog';
import { useController } from 'hooks/useController';
import type { RootState } from 'state/store';
import type { INoteBackupController } from 'utils/privacy/noteBackupTypes';
import {
  decodeNoteBackupFile,
  encodeNoteBackupFile,
  NOTE_BACKUP_FILE_LIMIT,
} from 'utils/privacy/noteBackupWire';

type Mode = 'export' | 'import';
interface IProps {
  mode: Mode | null;
  onClose: () => void;
  onRestored: () => void;
}
interface ISummary {
  added: number;
  duplicates: number;
  guarded: number;
}
const TIMEOUT = 120_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fieldClass =
  'block w-full rounded-lg border border-alpha-whiteAlpha300 bg-bkg-4 p-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-royalblue';
const invalid = (): never => {
  throw new Error('BACKUP_INVALID_FORMAT');
};
const isDate = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 8_640_000_000_000_000;
const validPassword = (value: string, encrypting = false) => {
  if (!value || value.length > 1024) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return (
    (!encrypting || Array.from(value).length >= 12) &&
    new TextEncoder().encode(value).length <= 1024
  );
};
const readSummary = (value: unknown, id: string): ISummary => {
  const data = value as ISummary & { id?: unknown };
  if (
    !data ||
    data.id !== id ||
    ![data.added, data.duplicates, data.guarded].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 512
    ) ||
    data.added + data.duplicates > 512 ||
    data.guarded > data.added + data.duplicates
  )
    return invalid();
  if (data.added + data.duplicates === 0) throw new Error('BACKUP_EMPTY');
  return {
    added: data.added,
    duplicates: data.duplicates,
    guarded: data.guarded,
  };
};
const errorKey = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  switch (message) {
    case 'BACKUP_EMPTY':
      return 'empty';
    case 'BACKUP_INVALID_PASSWORD':
      return 'passwordInvalid';
    case 'BACKUP_AUTHENTICATION_FAILED':
      return 'authentication';
    case 'BACKUP_OPEN_FAILED':
    case 'BACKUP_INVALID_PAYLOAD':
    case 'BACKUP_INVALID_FORMAT':
      return 'fileInvalid';
    case 'BACKUP_STALE':
    case 'BACKUP_CANCELLED':
      return 'expired';
    case 'BACKUP_NOTE_LIMIT':
      return 'capacity';
    case 'BACKUP_BUSY':
      return 'busy';
    default:
      return 'failed';
  }
};

function BundleBody({
  mode,
  close,
  onRestored,
  controllerEmitter,
}: {
  close: () => void;
  controllerEmitter: (...args: any[]) => Promise<unknown>;
  mode: Mode;
  onRestored: () => void;
}) {
  const { t, i18n } = useTranslation();
  const text = (key: string, values?: Record<string, unknown>) =>
    t(`privacy.bundle.${key}`, values);
  const [walletPassword, setWalletPassword] = useState('');
  const [filePassword, setFilePassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [hasFile, setHasFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<
    'form' | 'exported' | 'preview' | 'confirmed' | 'unconfirmed' | 'retry'
  >('form');
  const [summary, setSummary] = useState<ISummary>();
  const [exportInfo, setExportInfo] = useState<{
    createdAt: number;
    noteCount: number;
  }>();
  const [handedOff, setHandedOff] = useState(false);
  const [verified, setVerified] = useState(false);
  const [receiptChecked, setReceiptChecked] = useState(false);
  const file = useRef<File>();
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const url = useRef<string>();
  const operationId = useRef<string>();
  const owner = useRef({ active: true, revision: 0, pending: false });
  const emitter = useRef(controllerEmitter);
  emitter.current = controllerEmitter;
  const call = (method: keyof INoteBackupController, params: unknown[] = []) =>
    emitter.current(['noteBackups', method], params, TIMEOUT, false);
  const cancel = useCallback((id: string) => {
    void emitter
      .current(['noteBackups', 'cancel'], [id], TIMEOUT, false)
      .catch(() => undefined);
  }, []);
  const revokeUrl = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = undefined;
  };
  const clearFile = () => {
    file.current = undefined;
    if (input.current) input.current.value = '';
    setHasFile(false);
  };
  const current = (revision: number) =>
    owner.current.active &&
    owner.current.revision === revision &&
    document.visibilityState !== 'hidden';
  useLayoutEffect(() => {
    owner.current.active = true;
    return () => {
      owner.current.active = false;
      owner.current.revision++;
      if (operationId.current) cancel(operationId.current);
      operationId.current = undefined;
      file.current = undefined;
      revokeUrl();
    };
  }, [cancel]);
  const start = async (revision: number) => {
    const id = await call('begin');
    if (typeof id !== 'string' || !UUID.test(id)) return invalid();
    if (!current(revision)) {
      cancel(id);
      return undefined;
    }
    operationId.current = id;
    return id;
  };
  const readFile = async (revision: number) => {
    const selected = file.current;
    if (
      !selected ||
      selected.size > NOTE_BACKUP_FILE_LIMIT ||
      selected.size < 80
    )
      return invalid();
    const buffer = await selected.arrayBuffer();
    if (!current(revision)) {
      new Uint8Array(buffer).fill(0);
      return undefined;
    }
    if (
      buffer.byteLength !== selected.size ||
      buffer.byteLength > NOTE_BACKUP_FILE_LIMIT
    )
      return invalid();
    return new Uint8Array(buffer);
  };
  const selectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    setError('');
    file.current = undefined;
    setHasFile(false);
    if (!selected) return;
    if (selected.size > NOTE_BACKUP_FILE_LIMIT) {
      clearFile();
      setError('fileTooLarge');
      return;
    }
    if (selected.size < 80) {
      clearFile();
      setError('fileInvalid');
      return;
    }
    file.current = selected;
    setHasFile(true);
  };
  const prepare = async (event: React.FormEvent) => {
    event.preventDefault();
    if (owner.current.pending) return;
    if (!validPassword(filePassword, mode === 'export')) {
      setError('passwordInvalid');
      return;
    }
    if (mode === 'export' && filePassword !== confirmation) {
      setError('passwordMismatch');
      return;
    }
    if (mode === 'export' && !walletPassword) {
      setError('authentication');
      return;
    }
    if (mode === 'import' && !file.current) {
      setError('fileInvalid');
      return;
    }
    const password = filePassword;
    const wallet = walletPassword;
    const revision = owner.current.revision;
    owner.current.pending = true;
    setBusy(true);
    setError('');
    setWalletPassword('');
    setFilePassword('');
    setConfirmation('');
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    try {
      bytes = mode === 'import' ? await readFile(revision) : undefined;
      if (!current(revision)) return;
      const id = await start(revision);
      if (!id) return;
      if (mode === 'export') {
        const result = (await call('exportEncrypted', [
          id,
          wallet,
          password,
        ])) as {
          createdAt?: unknown;
          file?: unknown;
          id?: unknown;
          noteCount?: unknown;
        };
        if (!current(revision)) return;
        if (
          !result ||
          result.id !== id ||
          !Number.isInteger(result.noteCount) ||
          Number(result.noteCount) < 0 ||
          Number(result.noteCount) > 512 ||
          !isDate(result.createdAt)
        )
          return invalid();
        if (result.noteCount === 0) throw new Error('BACKUP_EMPTY');
        const encrypted = decodeNoteBackupFile(result.file);
        try {
          revokeUrl();
          url.current = URL.createObjectURL(
            new Blob([encrypted], { type: 'application/octet-stream' })
          );
        } finally {
          encrypted.fill(0);
        }
        setExportInfo({
          noteCount: Number(result.noteCount),
          createdAt: result.createdAt,
        });
        setStage('exported');
      } else {
        if (!bytes) return invalid();
        try {
          const result = await call('prepareImport', [
            id,
            encodeNoteBackupFile(bytes),
            password,
          ]);
          if (!current(revision)) return;
          setSummary(readSummary(result, id));
          setStage('preview');
          clearFile();
        } finally {
          bytes.fill(0);
        }
      }
    } catch (failure) {
      if (current(revision)) {
        if (operationId.current) cancel(operationId.current);
        operationId.current = undefined;
        setError(errorKey(failure));
      }
    } finally {
      bytes?.fill(0);
      if (current(revision)) {
        owner.current.pending = false;
        setBusy(false);
      }
    }
  };
  const verify = async () => {
    if (
      owner.current.pending ||
      !operationId.current ||
      !validPassword(filePassword) ||
      !hasFile
    )
      return;
    const revision = owner.current.revision;
    const password = filePassword;
    owner.current.pending = true;
    setBusy(true);
    setError('');
    setFilePassword('');
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    try {
      bytes = await readFile(revision);
      if (!current(revision) || !bytes) return;
      const result = (await call('verifyExport', [
        operationId.current,
        encodeNoteBackupFile(bytes),
        password,
      ])) as {
        createdAt?: unknown;
        id?: unknown;
        noteCount?: unknown;
        verified?: unknown;
      };
      if (!current(revision)) return;
      if (
        !result ||
        result.id !== operationId.current ||
        result.verified !== true ||
        result.noteCount !== exportInfo?.noteCount ||
        result.createdAt !== exportInfo?.createdAt
      )
        return invalid();
      setVerified(true);
      clearFile();
      operationId.current = undefined;
    } catch (failure) {
      if (current(revision)) setError(errorKey(failure));
    } finally {
      bytes?.fill(0);
      if (current(revision)) {
        owner.current.pending = false;
        setBusy(false);
      }
    }
  };
  const commit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (owner.current.pending || !operationId.current || !walletPassword)
      return;
    const revision = owner.current.revision;
    const id = operationId.current;
    const password = walletPassword;
    owner.current.pending = true;
    setBusy(true);
    setError('');
    setWalletPassword('');
    try {
      const result = (await call('commitImport', [id, password])) as {
        confirmed?: unknown;
      };
      if (!current(revision)) return;
      const checked = readSummary(result, id);
      if (
        result.confirmed !== true ||
        JSON.stringify(checked) !== JSON.stringify(summary)
      )
        return invalid();
      setStage('confirmed');
      onRestored();
    } catch (failure) {
      if (!current(revision)) return;
      const key = errorKey(failure);
      if (key === 'authentication') {
        setStage('retry');
        setError(key);
      } else setStage('unconfirmed');
    } finally {
      if (current(revision)) {
        owner.current.pending = false;
        setBusy(false);
      }
    }
  };
  const checkReceipt = async () => {
    if (owner.current.pending || !operationId.current) return;
    const revision = owner.current.revision;
    const id = operationId.current;
    owner.current.pending = true;
    setBusy(true);
    setError('');
    try {
      const result = (await call('readCommitReceipt', [id])) as {
        confirmed?: unknown;
      } | null;
      if (!current(revision)) return;
      if (result) {
        const checked = readSummary(result, id);
        if (
          result.confirmed !== true ||
          JSON.stringify(checked) !== JSON.stringify(summary)
        )
          return invalid();
        setStage('confirmed');
        onRestored();
      } else setReceiptChecked(true);
    } catch {
      if (current(revision)) setReceiptChecked(true);
    } finally {
      if (current(revision)) {
        owner.current.pending = false;
        setBusy(false);
      }
    }
  };
  const reset = () => {
    if (operationId.current) cancel(operationId.current);
    operationId.current = undefined;
    owner.current.revision++;
    owner.current.pending = false;
    revokeUrl();
    clearFile();
    setWalletPassword('');
    setFilePassword('');
    setConfirmation('');
    setError('');
    setStage('form');
    setBusy(false);
  };
  const passwordField = (
    id: string,
    label: string,
    value: string,
    change: (nextValue: string) => void
  ) => (
    <label className="block space-y-1" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        className={fieldClass}
        type="password"
        value={value}
        onChange={(event) => change(event.target.value)}
        disabled={busy}
        maxLength={1024}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
      />
    </label>
  );
  const fileField = (
    <label className="block space-y-2" htmlFor="privacy-bundle-file">
      <span>{text('selectFile')}</span>
      <input
        ref={input}
        id="privacy-bundle-file"
        type="file"
        accept=".palibak,application/octet-stream"
        onChange={selectFile}
        disabled={busy}
        className={fieldClass}
      />
    </label>
  );
  return (
    <DialogPrimitive presentation="center" onClose={close} initialFocus={panel}>
      <CenterPanel
        ref={panel}
        tabIndex={-1}
        padded={false}
        scroll={false}
        className="flex flex-col"
      >
        <DialogHeader
          title={text(mode === 'export' ? 'exportTitle' : 'importTitle')}
          onClose={close}
        />
        <form
          autoComplete="off"
          className="contents"
          onSubmit={(event) => {
            if (stage === 'form') void prepare(event);
            else if (stage === 'preview') void commit(event);
            else {
              event.preventDefault();
              if (stage === 'exported' && !verified) void verify();
            }
          }}
        >
          <DialogBody>
            <div className="space-y-4 text-left text-xs">
              {stage === 'form' && (
                <div className="space-y-3">
                  <p>{text(mode === 'export' ? 'scope' : 'importHelp')}</p>
                  {mode === 'import'
                    ? fileField
                    : passwordField(
                        'privacy-bundle-wallet',
                        text('walletPassword'),
                        walletPassword,
                        setWalletPassword
                      )}
                  {passwordField(
                    'privacy-bundle-password',
                    text('filePassword'),
                    filePassword,
                    setFilePassword
                  )}
                  {mode === 'export' && (
                    <>
                      {passwordField(
                        'privacy-bundle-confirm',
                        text('confirmPassword'),
                        confirmation,
                        setConfirmation
                      )}
                      <p className="text-brand-gray200">
                        {text('passwordHint')}
                      </p>
                    </>
                  )}
                </div>
              )}
              {stage === 'exported' && (
                <>
                  <p>{text('exportReady', { count: exportInfo?.noteCount })}</p>
                  {exportInfo && (
                    <p className="text-brand-gray200">
                      {text('snapshotTime', {
                        time: new Date(exportInfo.createdAt).toLocaleString(
                          i18n?.resolvedLanguage
                        ),
                        interpolation: { escapeValue: false },
                      })}
                    </p>
                  )}
                  <DialogActionButton
                    type="button"
                    disabled={!url.current}
                    onClick={() => {
                      if (!url.current) return;
                      const anchor = document.createElement('a');
                      anchor.href = url.current;
                      anchor.download = 'pali-private-notes.palibak';
                      document.body.appendChild(anchor);
                      try {
                        anchor.click();
                        setHandedOff(true);
                      } catch {
                        setError('failed');
                      } finally {
                        anchor.remove();
                      }
                    }}
                  >
                    {text('saveFile')}
                  </DialogActionButton>
                  {handedOff && <p role="status">{text('handoff')}</p>}
                  {!verified ? (
                    <div className="space-y-3 border-t border-alpha-whiteAlpha300 pt-3">
                      <p>{text('verifyHelp')}</p>
                      {fileField}
                      {passwordField(
                        'privacy-bundle-verify-password',
                        text('filePassword'),
                        filePassword,
                        setFilePassword
                      )}
                      <DialogActionButton
                        type="button"
                        disabled={
                          busy || !hasFile || !validPassword(filePassword)
                        }
                        onClick={() => void verify()}
                      >
                        {text('verifyFile')}
                      </DialogActionButton>
                    </div>
                  ) : (
                    <p role="status">{text('verified')}</p>
                  )}
                </>
              )}
              {summary && stage !== 'form' && (
                <p>{text('summary', { ...summary })}</p>
              )}
              {stage === 'preview' && (
                <div className="space-y-3">
                  <p>{text('reconciliation')}</p>
                  <p className="text-brand-gray200">{text('expires')}</p>
                  {passwordField(
                    'privacy-bundle-wallet',
                    text('walletPassword'),
                    walletPassword,
                    setWalletPassword
                  )}
                </div>
              )}
              {stage === 'confirmed' && <p role="status">{text('restored')}</p>}
              {stage === 'unconfirmed' && (
                <>
                  <p role="alert">{text('unconfirmed')}</p>
                  <DialogActionButton
                    type="button"
                    disabled={busy}
                    onClick={() => void checkReceipt()}
                  >
                    {text('checkReceipt')}
                  </DialogActionButton>
                  {receiptChecked && (
                    <p role="status">{text('receiptUnavailable')}</p>
                  )}
                </>
              )}
              {error && (
                <p role="alert" className="text-brand-red">
                  {text(error)}
                </p>
              )}
              {busy && (
                <p role="status" aria-live="polite">
                  {text('working')}
                </p>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogActions>
              {stage === 'form' && (
                <DialogActionButton
                  type="submit"
                  disabled={
                    busy ||
                    (mode === 'export'
                      ? !walletPassword || !filePassword || !confirmation
                      : !hasFile || !filePassword)
                  }
                >
                  {text(mode === 'export' ? 'createFile' : 'reviewImport')}
                </DialogActionButton>
              )}
              {stage === 'preview' && (
                <DialogActionButton
                  type="submit"
                  disabled={busy || !walletPassword}
                >
                  {text('confirmRestore')}
                </DialogActionButton>
              )}
              {stage === 'retry' && (
                <DialogActionButton type="button" onClick={reset}>
                  {text('startAgain')}
                </DialogActionButton>
              )}
              <DialogActionButton
                type="button"
                tone="secondary"
                onClick={close}
              >
                {t('buttons.close')}
              </DialogActionButton>
            </DialogActions>
          </DialogFooter>
        </form>
      </CenterPanel>
    </DialogPrimitive>
  );
}

export default function PrivateNoteBundleDialog({
  mode,
  onClose,
  onRestored,
}: IProps) {
  const { controllerEmitter, isUnlocked, isLoading, connectionUnavailable } =
    useController();
  const scope = useSelector((state: RootState) => {
    const { vault, vaultGlobal } = state;
    const ref = vault.activeAccount;
    const account = ref && vault.accounts?.[ref.type]?.[ref.id];
    return JSON.stringify([
      ref?.type,
      ref?.id,
      account?.address,
      account?.xpub,
      vault.activeNetwork.url,
      vault.activeNetwork.chainId,
      vaultGlobal.activeSlip44,
      vaultGlobal.lastLogin,
      vaultGlobal.isSwitchingAccount,
      vault.passkeyCredentialProfile?.credentialIdHash,
    ]);
  });
  const scopeRef = useRef(scope);
  const live = useRef({ mode, onClose });
  live.current = { mode, onClose };
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  const [dismissed, setDismissed] = useState(false);
  const close = useCallback(() => {
    setDismissed(true);
    live.current.onClose();
  }, []);
  useEffect(() => {
    const visibility = () => {
      const showing = document.visibilityState !== 'hidden';
      setVisible(showing);
      if (!showing && live.current.mode) close();
    };
    const hide = () => {
      setVisible(false);
      if (live.current.mode) close();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', visibility);
    };
  }, [close]);
  useLayoutEffect(() => {
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      if (mode) close();
    }
  }, [scope, mode, close]);
  const ready = isUnlocked && !isLoading && !connectionUnavailable;
  useEffect(() => {
    if (!ready && mode) close();
  }, [ready, mode, close]);
  useEffect(() => {
    if (!mode) setDismissed(false);
  }, [mode]);
  if (!mode || dismissed || !visible || !ready || scopeRef.current !== scope)
    return null;
  return (
    <BundleBody
      key={`${scope}:${mode}`}
      mode={mode}
      close={close}
      onRestored={onRestored}
      controllerEmitter={controllerEmitter}
    />
  );
}
