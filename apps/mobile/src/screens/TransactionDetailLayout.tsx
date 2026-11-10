import React from 'react';
import { StyleSheet, View } from 'react-native';
import { compactActivityAmountLabel } from '../activity/activityAmountLabel';
import { Button, Card, colors, Icon, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';

export type TransactionDetailRow = Readonly<{
  label: string;
  value: string;
  displayValue?: string;
  actionLabel?: string;
  disabled?: boolean;
  onPress?(): void;
}>;

const bounded = (value: string) => value.length > 42 ? `${value.slice(0, 16)}…${value.slice(-12)}` : value;

export function TransactionDetailLayout({ amount, direction, status, tone, rows, onExplorer, explorerDisabled = false }: {
  amount: string;
  direction: string;
  status: string;
  tone: 'confirmed' | 'failed' | 'pending' | 'unknown';
  rows: readonly TransactionDetailRow[];
  onExplorer?(): void;
  explorerDisabled?: boolean;
}) {
  const accent = tone === 'failed' ? colors.pink : tone === 'unknown' ? colors.muted : colors.blue;
  return <View style={s.content}>
    <View style={s.hero}>
      <View style={[s.statusIcon, { backgroundColor: tone === 'failed' ? '#312139' : colors.raised }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon name={tone === 'confirmed' ? 'check' : tone === 'failed' ? 'close' : tone === 'pending' ? 'clock' : 'activity'} size={26} color={accent} />
      </View>
      <Text style={s.direction}>{direction}</Text>
      <Text accessibilityLabel={amount} style={s.amount} numberOfLines={2}>{compactActivityAmountLabel(amount.replace(/^−/, '-'))}</Text>
      <Text style={[s.status, { color: accent }]}>{status}</Text>
    </View>
    <Card>
      {rows.map((row, index) => {
        const content = <>
          <Text style={s.label}>{row.label}</Text>
          <View style={s.valueGroup}><Text style={s.value} accessibilityLabel={row.value} numberOfLines={2}>{row.displayValue ?? bounded(compactActivityAmountLabel(row.value))}</Text>
            {row.onPress && <Icon name="copy" size={14} color={colors.muted} />}</View>
        </>;
        const style = [s.row, index < rows.length - 1 && s.divider];
        return row.onPress ? <IdlePressable key={row.label} accessibilityRole="button" accessibilityLabel={`${row.actionLabel ?? row.label}: ${row.value}`} accessibilityState={{ disabled: row.disabled === true }} disabled={row.disabled} onPress={row.onPress} style={style}>{content}</IdlePressable>
          : <View key={row.label} style={style}>{content}</View>;
      })}
    </Card>
    {onExplorer && <Button title="View on explorer" icon="external" variant="secondary" size="compact" disabled={explorerDisabled} onPress={onExplorer} />}
  </View>;
}

const s = StyleSheet.create({
  content: { gap: 16 },
  hero: { alignItems: 'center', paddingTop: 20, paddingBottom: 12, gap: 8 },
  statusIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  direction: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  amount: { color: colors.text, fontSize: 26, lineHeight: 34, fontWeight: '600', textAlign: 'center', maxWidth: '100%' },
  status: { fontSize: 14, lineHeight: 20 },
  row: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  label: { color: colors.muted, fontSize: 13, lineHeight: 19, width: 94 },
  valueGroup: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  value: { flexShrink: 1, color: colors.text, fontSize: 13, lineHeight: 19, textAlign: 'right' },
});
