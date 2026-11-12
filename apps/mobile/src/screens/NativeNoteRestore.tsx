import { useNativeTranslation } from '../platform/localization';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { INoteBackupPreview, INoteBackupConfirmation } from '../../../../source/wallet/noteBackupService';
import { Button, Card, colors, Header, Notice, Screen, styles, Text } from '../ui';
import { NoteBackupPasswordField } from './NoteBackupPasswordField';

export type NativeNoteRestoreStep =
  | { phase: 'select' }
  | { phase: 'password' }
  | { phase: 'review'; preview: INoteBackupPreview }
  | { phase: 'restored'; receipt: INoteBackupConfirmation }
  | { phase: 'unconfirmed' };

type Props = {
  step: NativeNoteRestoreStep;
  busy: boolean;
  /** Static user-facing copy from the owned controller. */
  error: string;
  onChoose(): void;
  onOpen(password: string): void;
  onRestore(id: string): void;
  onBack(): void;
};

export function NoteRestoreUnconfirmedNotice({ reopen = false }: { reopen?: boolean }) {
  const { t } = useNativeTranslation();
  return <Notice title={t('mobile.noteFlows.restore.restoreCouldNotBeConfirmed')} body={reopen
    ? t('mobile.noteFlows.restore.closeAndReopenPaliThenOpenTheBackup')
    : t('mobile.noteFlows.restore.openTheBackupAgainAfterUnlockingToCheck')} tone="amber" />;
}

export function NativeNoteRestore({ step, busy, error, onChoose, onOpen, onRestore, onBack }: Props) {
  const { t } = useNativeTranslation();
  useLayoutEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => back.remove();
  }, [onBack]);

  const header = <Header title={step.phase === 'review' ? t('mobile.noteFlows.restore.reviewRestore') : t('mobile.noteFlows.restore.restorePrivateNotes')} onBack={onBack} />;
  const feedback = error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null;
  let content;
  if (step.phase === 'password') {
    content = <PasswordStep key="file" header={header} label={t('mobile.noteFlows.export.backupPassword')} button={t('mobile.noteFlows.restore.openBackup')}
      detail={t('mobile.noteFlows.restore.enterThePasswordYouSetWhenSavingThis')} busy={busy} onSubmit={onOpen} feedback={feedback} />;
  } else if (step.phase === 'review') {
    const { preview } = step;
    content = <Screen footer={<Button title={busy ? t('mobile.noteFlows.restore.restoring') : t('privacy.bundle.confirmRestore')} disabled={busy}
      onPress={() => { if (!busy && AppState.currentState === 'active') onRestore(preview.id); }} />}>{header}
      <Card style={s.counts}>
        <Count label={t('mobile.noteFlows.restore.newNotes')} count={preview.added} />
        <Count label={t('mobile.noteFlows.restore.alreadyInThisWallet')} count={preview.duplicates} />
      </Card>
      <Text style={styles.muted}>{t('mobile.noteFlows.restore.existingNotesAreKeptTheBackupMayFlag')}</Text>
      {feedback}
    </Screen>;
  } else if (step.phase === 'restored' || step.phase === 'unconfirmed') {
    content = <Screen footer={<Button title={t('privacy.deposit.done')} onPress={onBack} />}>{header}
      {step.phase === 'restored'
        ? <Notice title={step.receipt.added === 0 ? t('mobile.noteFlows.restore.noNewNotes') : t('mobile.noteFlows.restore.notesRestored')} body={step.receipt.added === 0
          ? t('mobile.noteFlows.restore.yourExistingNotesWereKeptTheirStatusMay')
          : t('mobile.noteFlows.restore.yourNotesAreSavedInThisWalletTheir')} />
        : <NoteRestoreUnconfirmedNotice />}
    </Screen>;
  } else {
    content = <Screen footer={<Button title={busy ? t('mobile.noteFlows.export.openingFiles') : t('mobile.noteFlows.restore.chooseBackupFile')} onPress={onChoose} disabled={busy} />}>{header}
      <Text style={styles.muted}>{t('mobile.noteFlows.restore.chooseAnEncryptedPaliBackupToAddIts')}</Text>
      {feedback}
    </Screen>;
  }
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>{content}</SafeAreaView>;
}

function PasswordStep({ header, label, button, detail, busy, onSubmit, feedback, children }: {
  header: React.ReactNode; label: string; button: string; detail: string; busy: boolean;
  onSubmit(value: string): void; feedback: React.ReactNode; children?: React.ReactNode;
}) {
  const { t } = useNativeTranslation();
  const [value, setValue] = useState('');
  const entered = useRef('');
  const changeValue = (next: string) => { entered.current = next; setValue(next); };
  useLayoutEffect(() => {
    const clear = () => { entered.current = ''; setValue(''); Keyboard.dismiss(); };
    const change = AppState.addEventListener('change', state => { if (state !== 'active') clear(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', clear) : null;
    return () => { entered.current = ''; change.remove(); blur?.remove(); };
  }, []);
  const submit = () => {
    const password = entered.current;
    if (busy || !password || AppState.currentState !== 'active') return;
    changeValue('');
    Keyboard.dismiss();
    onSubmit(password);
  };
  const disabled = busy || !value;
  return <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen footer={<Button title={busy ? t('mobile.noteFlows.export.working') : button} onPress={submit} disabled={disabled} variant={disabled ? 'secondary' : 'primary'} />}>
      {header}
      {children}
      <Text style={styles.muted}>{detail}</Text>
      <NoteBackupPasswordField label={label} value={value} onChange={changeValue} busy={busy} />
      {feedback}
    </Screen>
  </KeyboardAvoidingView>;
}

function Count({ label, count }: { label: string; count: number }) {
  return <View style={s.countRow}><Text style={s.countLabel}>{label}</Text><Text>{count}</Text></View>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, fill: { flex: 1 },
  counts: { gap: 14, padding: 18 }, countRow: { flexDirection: 'row', gap: 12 }, countLabel: { flex: 1 },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
