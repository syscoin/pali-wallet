import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

export function NoteBackupPasswordField({ label, value, onChange, busy }: {
  label: string; value: string; onChange(value: string): void; busy: boolean;
}) {
  return <View style={s.field}>
    <Text style={s.label}>{label}</Text>
    <IdleTextInput accessibilityLabel={label} secureTextEntry value={value} onChangeText={onChange}
      editable={!busy} autoCapitalize="none" autoComplete="off" autoCorrect={false} spellCheck={false}
      importantForAutofill="noExcludeDescendants" textContentType="none" maxLength={1024}
      selectionColor={colors.pink} style={s.input} />
  </View>;
}

const s = StyleSheet.create({
  field: { gap: 8 }, label: { color: colors.muted, fontWeight: '600' },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16, minHeight: 56, fontSize: 16 },
});
