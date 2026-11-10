import React, { useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { INoteBackupPreview, INoteBackupConfirmation } from '../../../../source/wallet/noteBackupService';
import { Button, Card, colors, Header, Notice, Screen, styles, Text } from '../ui';
import { NoteBackupPasswordField } from './NoteBackupPasswordField';
import { PinField } from './PinEntry';

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
  onRestore(id: string, password: string): void;
  onBack(): void;
};

export function NoteRestoreUnconfirmedNotice({ reopen = false }: { reopen?: boolean }) {
  return <Notice title="Restore could not be confirmed" body={reopen
    ? 'Close and reopen Pali, then open the backup to check which notes are already saved.'
    : 'Open the backup again after unlocking to check which notes are already saved.'} tone="amber" />;
}

export function NativeNoteRestore({ step, busy, error, onChoose, onOpen, onRestore, onBack }: Props) {
  useLayoutEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => back.remove();
  }, [onBack]);

  const header = <Header title={step.phase === 'review' ? 'Review restore' : 'Restore private notes'} onBack={onBack} />;
  const feedback = error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null;
  let content;
  if (step.phase === 'password') {
    content = <PasswordStep key="file" header={header} label="Backup password" button="Open backup"
      detail="Enter the password you set when saving this file." busy={busy} onSubmit={onOpen} feedback={feedback} />;
  } else if (step.phase === 'review') {
    const { preview } = step;
    content = <PasswordStep key={preview.id} walletPin header={header} label="Wallet PIN" button="Restore notes"
      detail="Confirm your wallet PIN to add these notes." busy={busy} onSubmit={password => onRestore(preview.id, password)} feedback={feedback}>
      <Card style={s.counts}>
        <Count label="New notes" count={preview.added} />
        <Count label="Already in this wallet" count={preview.duplicates} />
      </Card>
      <Text style={styles.muted}>Existing notes are kept. The backup may flag notes that need a status check before use.</Text>
    </PasswordStep>;
  } else if (step.phase === 'restored' || step.phase === 'unconfirmed') {
    content = <Screen footer={<Button title="Done" onPress={onBack} />}>{header}
      {step.phase === 'restored'
        ? <Notice title={step.receipt.added === 0 ? 'No new notes' : 'Notes restored'} body={step.receipt.added === 0
          ? 'Your existing notes were kept. Their status may still need to be checked.'
          : 'Your notes are saved in this wallet. Their current status still needs to be checked.'} />
        : <NoteRestoreUnconfirmedNotice />}
    </Screen>;
  } else {
    content = <Screen footer={<Button title={busy ? 'Opening Files…' : 'Choose backup file'} onPress={onChoose} disabled={busy} />}>{header}
      <Text style={styles.muted}>Choose an encrypted Pali backup to add its private notes to this wallet.</Text>
      {feedback}
    </Screen>;
  }
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>{content}</SafeAreaView>;
}

function PasswordStep({ header, label, button, detail, busy, onSubmit, feedback, children, walletPin = false }: {
  header: React.ReactNode; label: string; button: string; detail: string; busy: boolean;
  onSubmit(value: string): void; feedback: React.ReactNode; children?: React.ReactNode; walletPin?: boolean;
}) {
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
  const CredentialField = walletPin ? PinField : NoteBackupPasswordField;
  return <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen footer={<Button title={busy ? 'Working…' : button} onPress={submit} disabled={disabled} variant={disabled ? 'secondary' : 'primary'} />}>
      {header}
      {children}
      <Text style={styles.muted}>{detail}</Text>
      <CredentialField label={label} value={value} onChange={changeValue} busy={busy} />
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
