import { useNativeTranslation } from '../platform/localization';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, Header, Notice, Row, Screen, styles, Text } from '../ui';
import { NoteBackupPasswordField } from './NoteBackupPasswordField';

export type NativeNoteExportStep =
  | { phase: 'select' }
  | { phase: 'passwords' }
  | { phase: 'saved' | 'verify' | 'verified'; noteCount: number; canVerify?: boolean }
  | { phase: 'unconfirmed' };

type Props = {
  step: NativeNoteExportStep;
  busy: boolean;
  error: string;
  onChoose(): void;
  onSave(backupPassword: string): void;
  onShowVerify(): void;
  onVerify(backupPassword: string): void;
  onBack(): void;
  doneLabel?: string;
};

export function NativeNoteFilesMenu({ onBack, onExport, onRestore, onCapacity, onInventory, onImport, onDeposit, onMaintenance, onPrivacySettings }: { onBack(): void; onExport(): void; onRestore(): void; onCapacity?(): void; onInventory?(): void; onImport?(): void; onDeposit?(): void; onMaintenance?(): void; onPrivacySettings?(): void }) {
  const { t } = useNativeTranslation();
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}><Screen>
    <Header title={t('mobile.tools.notes')} onBack={onBack} />
    <Card>
      {onDeposit && <Row title={t('privacy.deposit.title')} subtitle={t('mobile.noteFlows.export.createAndFundAPrivateNote')} icon="plus" onPress={onDeposit} />}
      {onInventory && <Row title={t('mobile.noteFlows.export.savedNotes')} subtitle={t('mobile.noteFlows.export.viewNotesStoredOnThisDevice')} icon="wallet" onPress={onInventory} />}
      {onImport && <Row title={t('mobile.noteFlows.export.importOneNote')} subtitle={t('mobile.noteFlows.export.restoreARawPrivateNote')} icon="plus" onPress={onImport} />}
      <Row title={t('mobile.noteFlows.export.backUpPrivateNotes')} subtitle={t('mobile.noteFlows.export.saveAnEncryptedCopy')} icon="lock" onPress={onExport} />
      <Row title={t('mobile.noteFlows.export.restoreNoteBackup')} subtitle={t('mobile.noteFlows.export.addNotesFromAnEncryptedFile')} icon="wallet" onPress={onRestore} last={!onCapacity && !onMaintenance && !onPrivacySettings} />
      {onCapacity && <Row title={t('privacy.capacity.settings')} icon="settings" subtitle={t('mobile.noteFlows.export.changeTheSavedNoteLimit')} onPress={onCapacity} last={!onMaintenance && !onPrivacySettings} />}
      {onMaintenance && <Row title={t('mobile.noteFlows.export.manageCompletedNotes')} icon="refresh" subtitle={t('mobile.noteFlows.export.clearCompletedNotesOrRecoverAFailedWithdrawal')} onPress={onMaintenance} last={!onPrivacySettings} />}
      {onPrivacySettings && <Row title={t('privacy.serviceSettings')} icon="globe" subtitle={t('mobile.noteFlows.export.serviceOriginAndPublicPoolData')} onPress={onPrivacySettings} last />}
    </Card>
  </Screen></SafeAreaView>;
}

export function NativeNoteExport({ step, busy, error, onChoose, onSave, onShowVerify, onVerify, onBack, doneLabel }: Props) {
  const { t } = useNativeTranslation();
  useLayoutEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => back.remove();
  }, [onBack]);
  const feedback = error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null;
  const header = <Header title={step.phase === 'verify' ? t('mobile.noteFlows.export.verifyBackup') : t('mobile.noteFlows.export.backUpPrivateNotes')} onBack={onBack} />;
  let content;
  switch (step.phase) {
    case 'passwords':
    case 'verify':
      content = <BackupForm key={step.phase} verify={step.phase === 'verify'} busy={busy} header={header} feedback={feedback}
        submit={step.phase === 'verify' ? onVerify : onSave} />;
      break;
    case 'saved':
    case 'verified': {
      const count = t('mobile.noteFlows.export.noteCount', { count: step.noteCount });
      const verified = step.phase === 'verified';
      content = <Screen footer={<Button title={doneLabel ?? t('privacy.deposit.done')} onPress={onBack} />}>{header}
        <Notice title={verified ? t('mobile.noteFlows.export.backupVerified') : t('mobile.noteFlows.export.encryptedBackupSaved')} body={verified
          ? t('mobile.noteFlows.export.verifiedContents', { notes: count })
          : t('mobile.noteFlows.export.savedContents', { notes: count })} />
        {!verified && step.canVerify !== false && <Button title={t('mobile.noteFlows.export.verifySavedBackup')} variant="secondary" onPress={onShowVerify} />}
        {feedback}
      </Screen>;
      break;
    }
    case 'unconfirmed':
      content = <Screen footer={<Button title={t('privacy.deposit.done')} onPress={onBack} />}>{header}
        <Notice title={t('mobile.noteFlows.export.saveCouldNotBeConfirmed')} body={t('mobile.noteFlows.export.checkYourChosenFolderForTheEncryptedFile')} tone="amber" />
      </Screen>;
      break;
    default:
      content = <Screen footer={<Button title={busy ? t('mobile.noteFlows.export.openingFiles') : t('mobile.noteFlows.export.chooseFolder')} onPress={onChoose} disabled={busy} />}>{header}
        <Text style={styles.muted}>{t('mobile.noteFlows.export.saveAnEncryptedCopyOfThePrivateNotes')}</Text>
        {feedback}
      </Screen>;
  }
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>{content}</SafeAreaView>;
}

const empty = () => ({ backup: '', repeat: '' });
function BackupForm({ verify, busy, header, feedback, submit }: {
  verify: boolean; busy: boolean; header: React.ReactNode; feedback: React.ReactNode;
  submit(backup: string): void;
}) {
  const { t } = useNativeTranslation();
  const [values, setValues] = useState(empty);
  const entered = useRef(values);
  const reset = () => { entered.current = empty(); setValues(entered.current); Keyboard.dismiss(); };
  useLayoutEffect(() => {
    const change = AppState.addEventListener('change', state => { if (state !== 'active') reset(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', reset) : null;
    return () => { entered.current = empty(); change.remove(); blur?.remove(); };
  }, []);
  const valid = (value: typeof values) => value.backup &&
    (verify || value.backup === value.repeat);
  const disabled = busy || !valid(values);
  const field = (name: keyof typeof values, label: string) => {
    return <NoteBackupPasswordField label={label} value={values[name]} onChange={value => {
      entered.current = { ...entered.current, [name]: value };
      setValues(entered.current);
    }} busy={busy} />;
  };
  return <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen footer={<Button title={busy ? t('mobile.noteFlows.export.working') : verify ? t('mobile.noteFlows.export.verifyBackup') : t('mobile.noteFlows.export.saveEncryptedBackup')}
      variant={disabled ? 'secondary' : 'primary'} disabled={disabled} onPress={() => {
        const value = entered.current;
        if (busy || !valid(value) || AppState.currentState !== 'active') return;
        reset();
        submit(value.backup);
      }} />}>
      {header}
      <Text style={styles.muted}>{verify ? t('mobile.noteFlows.export.enterThePasswordForThisFileToVerify') : t('mobile.noteFlows.export.useASeparateBackupPasswordWithAtLeast')}</Text>
      {field('backup', t('mobile.noteFlows.export.backupPassword'))}
      {!verify && field('repeat', t('mobile.noteFlows.export.confirmBackupPassword'))}
      {!verify && !!values.repeat && values.backup !== values.repeat &&
        <Text accessibilityLiveRegion="polite" style={s.error}>{t('mobile.noteFlows.export.theBackupPasswordsDoNotMatch')}</Text>}
      {feedback}
    </Screen>
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, fill: { flex: 1 },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
