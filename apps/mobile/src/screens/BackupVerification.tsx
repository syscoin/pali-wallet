import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, Header, Screen, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';
import type { SeedBackupPresentation } from '../custody/seedBackup';

export function BackupVerification({ presentation, onBack, onConfirm, busy, error }: {
  presentation: SeedBackupPresentation; onBack(): void; onConfirm(words: readonly string[]): void; busy: boolean; error?: string;
}) {
  const scope = presentation;
  const owner = useRef<object | null>(null);
  const submitted = useRef(false);
  useLayoutEffect(() => {
    owner.current = scope; submitted.current = false;
    return () => { if (owner.current === scope) owner.current = null; };
  }, [scope]);
  useLayoutEffect(() => { if (!busy) submitted.current = false; }, [busy, error]);
  const choices = useMemo(() => {
    const words = presentation.words.map((word, id) => ({ word, id }));
    for (let index = words.length - 1; index > 0; index--) {
      const bytes = new Uint32Array(1); crypto.getRandomValues(bytes);
      const other = bytes[0]! % (index + 1);
      [words[index], words[other]] = [words[other]!, words[index]!];
    }
    return words;
  }, [presentation]);
  const [selection, setSelection] = useState<{ scope: object; values: number[] }>({ scope, values: [] });
  const selected = selection.scope === scope ? selection.values : [];
  const select = (change: (values: number[]) => number[]) => {
    if (owner.current !== scope || busy || submitted.current) return;
    setSelection(previous => ({ scope, values: change(previous.scope === scope ? previous.values : []) }));
  };
  const answer = selected.map(id => presentation.words[id]!);
  return <SafeAreaView style={s.root} edges={['top', 'bottom']}>
    <Screen footer={<Button title="Confirm backup" disabled={busy || selected.length !== choices.length} onPress={() => {
      if (owner.current !== scope || busy || submitted.current || selected.length !== choices.length) return;
      submitted.current = true; onConfirm(answer);
    }} />}>
      <Header title="Verify backup" onBack={onBack} right={<Text style={s.step}>2 of 2</Text>} />
      <Text accessibilityRole="header" style={s.title}>Select your words in order</Text>
      <Text style={s.description}>This confirms that your written copy is complete.</Text>
      <Card style={s.slots}>{presentation.words.map((_, index) => <IdlePressable key={index} accessibilityRole="button"
        accessibilityLabel={`Word ${index + 1}${answer[index] ? `, ${answer[index]}, selected` : ', empty'}`}
        accessibilityHint={answer[index] ? 'Remove this and later words.' : undefined}
        disabled={busy || index >= selected.length} onPress={() => select(values => values.slice(0, index))} style={s.slot}>
        <Text style={s.number}>{index + 1}</Text><Text style={s.word}>{answer[index] ?? '—'}</Text>
      </IdlePressable>)}</Card>
      <View style={s.choices}>{choices.map(choice => <Button key={choice.id} title={choice.word} variant="secondary" size="compact"
        disabled={busy || selected.includes(choice.id)} style={s.choice} onPress={() => select(values => values.includes(choice.id) ? values : [...values, choice.id])} />)}</View>
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    </Screen>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, step: { color: colors.muted, fontSize: 13 },
  title: { fontSize: 25, lineHeight: 33, fontWeight: '600' }, description: { color: colors.muted, fontSize: 16, lineHeight: 25 },
  slots: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 4 },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '48%', minHeight: 44 },
  number: { color: colors.muted, fontSize: 13, minWidth: 20 }, word: { fontSize: 15, flexShrink: 1 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, choice: { minWidth: '28%', flexGrow: 1 },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});
