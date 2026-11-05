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
  onSave(walletPassword: string, backupPassword: string): void;
  onShowVerify(): void;
  onVerify(backupPassword: string): void;
  onBack(): void;
};

export function NativeNoteFilesMenu({ onBack, onExport, onRestore, onCapacity, onInventory }: { onBack(): void; onExport(): void; onRestore(): void; onCapacity?(): void; onInventory?(): void }) {
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}><Screen>
    <Header title="Private notes" onBack={onBack} />
    <Card>
      {onInventory && <Row title="Saved notes" subtitle="View notes stored on this device" icon="wallet" onPress={onInventory} />}
      <Row title="Back up private notes" subtitle="Save an encrypted copy" icon="lock" onPress={onExport} />
      <Row title="Restore note backup" subtitle="Add notes from an encrypted file" icon="wallet" onPress={onRestore} last={!onCapacity} />
      {onCapacity && <Row title="Note capacity" subtitle="Change the saved note limit" onPress={onCapacity} last />}
    </Card>
  </Screen></SafeAreaView>;
}

export function NativeNoteExport({ step, busy, error, onChoose, onSave, onShowVerify, onVerify, onBack }: Props) {
  useLayoutEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => back.remove();
  }, [onBack]);
  const feedback = error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null;
  const header = <Header title={step.phase === 'verify' ? 'Verify backup' : 'Back up private notes'} onBack={onBack} />;
  let content;
  switch (step.phase) {
    case 'passwords':
    case 'verify':
      content = <BackupForm key={step.phase} verify={step.phase === 'verify'} busy={busy} header={header} feedback={feedback}
        submit={step.phase === 'verify' ? (_wallet, backup) => onVerify(backup) : onSave} />;
      break;
    case 'saved':
    case 'verified': {
      const count = step.noteCount === 1 ? '1 private note' : step.noteCount + ' private notes';
      const verified = step.phase === 'verified';
      content = <Screen footer={<Button title="Done" onPress={onBack} />}>{header}
        <Notice title={verified ? 'Backup verified' : 'Encrypted backup saved'} body={verified
          ? 'Pali opened the saved file and confirmed it contains ' + count + '.'
          : 'The file contains ' + count + '. Keep its password separate from the file.'} />
        {!verified && step.canVerify !== false && <Button title="Verify saved backup" variant="secondary" onPress={onShowVerify} />}
        {feedback}
      </Screen>;
      break;
    }
    case 'unconfirmed':
      content = <Screen footer={<Button title="Done" onPress={onBack} />}>{header}
        <Notice title="Save could not be confirmed" body="Check your chosen folder for the encrypted file before saving another copy." tone="amber" />
      </Screen>;
      break;
    default:
      content = <Screen footer={<Button title={busy ? 'Opening Files…' : 'Choose folder'} onPress={onChoose} disabled={busy} />}>{header}
        <Text style={styles.muted}>Save an encrypted copy of the private notes in this wallet. A recovery phrase does not restore private notes.</Text>
        {feedback}
      </Screen>;
  }
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>{content}</SafeAreaView>;
}

const empty = () => ({ wallet: '', backup: '', repeat: '' });
function BackupForm({ verify, busy, header, feedback, submit }: {
  verify: boolean; busy: boolean; header: React.ReactNode; feedback: React.ReactNode;
  submit(wallet: string, backup: string): void;
}) {
  const [values, setValues] = useState(empty);
  const entered = useRef(values);
  const reset = () => { entered.current = empty(); setValues(entered.current); Keyboard.dismiss(); };
  useLayoutEffect(() => {
    const change = AppState.addEventListener('change', state => { if (state !== 'active') reset(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', reset) : null;
    return () => { entered.current = empty(); change.remove(); blur?.remove(); };
  }, []);
  const valid = (value: typeof values) => value.backup &&
    (verify || (value.wallet && value.backup !== value.wallet && value.backup === value.repeat));
  const disabled = busy || !valid(values);
  const field = (name: keyof typeof values, label: string) => <NoteBackupPasswordField
    label={label} value={values[name]} onChange={value => {
      entered.current = { ...entered.current, [name]: value };
      setValues(entered.current);
    }} busy={busy} />;
  return <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen footer={<Button title={busy ? 'Working…' : verify ? 'Verify backup' : 'Save encrypted backup'}
      variant={disabled ? 'secondary' : 'primary'} disabled={disabled} onPress={() => {
        const value = entered.current;
        if (busy || !valid(value) || AppState.currentState !== 'active') return;
        reset();
        submit(value.wallet, value.backup);
      }} />}>
      {header}
      <Text style={styles.muted}>{verify ? 'Enter the password for this file to verify it can be opened.' : 'Use a separate backup password with at least 12 characters. Pali cannot recover it for you.'}</Text>
      {!verify && field('wallet', 'Wallet password')}
      {field('backup', 'Backup password')}
      {!verify && field('repeat', 'Confirm backup password')}
      {!verify && !!values.wallet && values.wallet === values.backup &&
        <Text accessibilityLiveRegion="polite" style={s.error}>Use a different password for the backup.</Text>}
      {!verify && !!values.repeat && values.backup !== values.repeat &&
        <Text accessibilityLiveRegion="polite" style={s.error}>The backup passwords do not match.</Text>}
      {feedback}
    </Screen>
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, fill: { flex: 1 },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
