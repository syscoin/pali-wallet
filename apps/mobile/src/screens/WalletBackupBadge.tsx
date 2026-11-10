import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, Icon, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';

export function WalletBackupBadge({ onPress }: { onPress?(): void }) {
  const content = <>
    <View style={s.icon}><Icon name="shield" size={19} color={colors.amber} /></View>
    <View style={s.text}><Text style={s.title}>Back up your wallet</Text><Text style={s.body}>Protect access if this phone is lost.</Text></View>
    {onPress && <Icon name="chevron-right" size={17} color={colors.amber} />}
  </>;
  return onPress ? <IdlePressable accessibilityRole="button" accessibilityLabel="Back up your wallet. Protect access if this phone is lost." onPress={onPress} style={s.badge}>{content}</IdlePressable>
    : <View style={s.badge}>{content}</View>;
}

const s = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: '#6c5734', backgroundColor: '#29251f', minHeight: 60 },
  icon: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#393023', alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  title: { color: colors.amber, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  body: { color: colors.muted, fontSize: 12, lineHeight: 18 },
});
