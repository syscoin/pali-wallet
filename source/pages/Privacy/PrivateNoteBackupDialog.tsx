import { Form } from 'antd';
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
} from 'components/Dialog/Dialog';
import { ValidatedPasswordInput } from 'components/Input/ValidatedPasswordInput';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

interface IPrivateNoteBackupDialogProps {
  noteId: string | null;
  onClose: () => void;
}

function BackupBody({
  noteId,
  close,
  controllerEmitter,
}: {
  close: () => void;
  controllerEmitter: (...args: any[]) => Promise<unknown>;
  noteId: string;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [note, setNote] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const owner = useRef({ active: true, revision: 0 });
  const current = (revision: number) =>
    owner.current.active &&
    owner.current.revision === revision &&
    document.visibilityState !== 'hidden';
  useLayoutEffect(() => {
    owner.current.active = true;
    return () => {
      owner.current.active = false;
      owner.current.revision++;
    };
  }, []);
  return (
    <DialogPrimitive presentation="center" onClose={close} initialFocus={panel}>
      <CenterPanel
        ref={panel}
        tabIndex={-1}
        padded={false}
        scroll={false}
        className="flex flex-col"
      >
        <DialogHeader title={t('privacy.revealNote')} onClose={close} />
        <DialogBody>
          <div className="space-y-3 text-left text-xs">
            <p>{t('privacy.deposit.backupWarning')}</p>
            {note ? (
              <>
                <label htmlFor="privacy-backup-note" className="block">
                  {t('privacy.privateNote')}
                </label>
                <textarea
                  id="privacy-backup-note"
                  readOnly
                  value={note}
                  rows={4}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full resize-y rounded-lg border border-alpha-whiteAlpha300 bg-bkg-4 p-3 text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-royalblue"
                />
                <p>{t('privacy.noteSecret')}</p>
              </>
            ) : (
              <Form form={form} autoComplete="off">
                <label htmlFor="privacy-backup-password" className="block mb-2">
                  {t('privacy.revealPassword')}
                </label>
                <ValidatedPasswordInput
                  id="privacy-backup-password"
                  form={form}
                  validationTrigger="submit"
                  placeholder={t('settings.enterYourPassword')}
                  errorMessage={t('privacy.noteRevealFailed')}
                  onValidate={async (password) => {
                    const revision = owner.current.revision;
                    try {
                      const value = await controllerEmitter(
                        ['privateVault', 'revealNote'],
                        [noteId, password],
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
                      throw new Error('privacy_note_reveal_failed');
                    }
                  }}
                  onValidationSuccess={(result) => {
                    if (result && current(result.revision)) {
                      form.resetFields();
                      setNote(result.value);
                    }
                  }}
                  onValidationReset={() => {
                    owner.current.revision++;
                    setNote('');
                  }}
                />
              </Form>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogActions>
            <DialogActionButton type="button" onClick={close}>
              {t('privacy.hideNote')}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
      </CenterPanel>
    </DialogPrimitive>
  );
}

export default function PrivateNoteBackupDialog({
  noteId,
  onClose,
}: IPrivateNoteBackupDialogProps) {
  const { controllerEmitter, isUnlocked, isLoading, connectionUnavailable } =
    useController();
  const scope = useSelector((state: RootState) => {
    const { vault, vaultGlobal } = state;
    const ref = vault.activeAccount;
    const account = vault.accounts?.[ref.type]?.[ref.id];
    return JSON.stringify([
      ref.type,
      ref.id,
      account?.address,
      account?.xpub,
      vault.activeNetwork.url,
      vault.activeNetwork.chainId,
      vaultGlobal.activeSlip44,
      vaultGlobal.lastLogin,
      vault.passkeyCredentialProfile?.credentialIdHash,
    ]);
  });
  const scopeRef = useRef(scope);
  const live = useRef({ noteId, onClose });
  live.current = { noteId, onClose };
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  const [dismissed, setDismissed] = useState<string | null>(null);
  const ready = isUnlocked && !isLoading && !connectionUnavailable;
  const close = useCallback(() => {
    setDismissed(live.current.noteId);
    live.current.onClose();
  }, []);
  useEffect(() => {
    const visibility = () => {
      const showing = document.visibilityState !== 'hidden';
      setVisible(showing);
      if (!showing && live.current.noteId) close();
    };
    const hide = () => {
      setVisible(false);
      if (live.current.noteId) close();
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
      if (noteId) close();
    }
  }, [scope, noteId, close]);
  useEffect(() => {
    if (!ready && noteId) close();
  }, [ready, noteId, close]);
  useEffect(() => {
    if (!noteId) setDismissed(null);
  }, [noteId]);
  if (
    !noteId ||
    dismissed === noteId ||
    !visible ||
    !ready ||
    scopeRef.current !== scope
  )
    return null;
  return (
    <BackupBody
      key={`${scope}:${noteId}`}
      noteId={noteId}
      close={close}
      controllerEmitter={controllerEmitter}
    />
  );
}
