import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Coin, colors, Icon, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';
import type { AssetIconIdentity } from '../../../../source/shared/assetIconIdentity';

export function activityDate(milliseconds: number | null | undefined, now = new Date()) {
  if (!milliseconds || !Number.isFinite(milliseconds)) return { key: 'unknown', label: 'Date unavailable', time: '' };
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return { key: 'unknown', label: 'Date unavailable', time: '' };
  const key = (value: Date) => `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return { key: key(date),
    label: key(date) === key(now) ? 'Today' : key(date) === key(yesterday) ? 'Yesterday'
      : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }),
    time: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  };
}

/** Compact public summary. The full amount and identifiers remain in details. */
export function ActivityListRow({ title, subtitle, amount, time, direction, heading, first, last, label, onPress, rowRef, testID, disabled = false, networkBadge, networkId, networkSymbol, asset, registrationHash, assetSymbol }: {
  title: string; subtitle: string; amount: string; time: string;
  direction: 'sent' | 'received' | 'self' | 'unknown'; heading?: string;
  first: boolean; last: boolean; label: string; onPress(): void;
  rowRef?: React.ComponentProps<typeof IdlePressable>['ref']; testID: string; disabled?: boolean;
  networkBadge?: string;
  networkId?: string;
  networkSymbol?: string;
  asset?: AssetIconIdentity;
  registrationHash?: string;
  assetSymbol?: string;
}) {
  const accent = direction === 'sent' ? colors.pink : colors.blue;
  return <View>
    {heading && <Text accessibilityRole="header" style={s.heading}>{heading}</Text>}
    <IdlePressable ref={rowRef} accessibilityRole="button" accessibilityLabel={label} testID={testID}
      disabled={disabled} onPress={onPress} style={({ pressed }) => [s.row, first && s.first, last && s.last, pressed && s.pressed]}>
      <View style={[s.icon, { backgroundColor: direction === 'sent' ? '#312139' : colors.raised }]}>
        {asset ? <Coin id="activity-asset" asset={asset} registrationHash={registrationHash} fallbackSymbol={assetSymbol} size={30} />
          : <Icon name={direction === 'sent' ? 'arrow-up-right' : direction === 'received' ? 'arrow-down-left' : 'activity'} size={18} color={accent} />}
      </View>
      <View style={s.description}><Text style={s.title}>{title}</Text>
        {networkBadge && <View style={s.badge}>
          {networkId && <View testID={`activity-network-icon-${networkId}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Coin id={networkId} fallbackSymbol={networkSymbol} size={13} />
          </View>}
          <Text style={s.badgeText} numberOfLines={1}>{networkBadge}</Text>
        </View>}
        <Text style={s.subtitle}>{subtitle}</Text></View>
      <View style={s.value}><Text style={[s.amount, direction === 'received' && { color: colors.blue }]} numberOfLines={2}>{amount}</Text><Text style={s.time}>{time}</Text></View>
    </IdlePressable>
  </View>;
}
const s = StyleSheet.create({
  heading: { fontSize: 14, lineHeight: 22, fontWeight: '600', paddingTop: 18, paddingBottom: 8 },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: colors.surface, borderColor: colors.border, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: StyleSheet.hairlineWidth },
  first: { borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  last: { borderBottomWidth: 1, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  pressed: { backgroundColor: colors.raised }, icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  description: { flex: 1, minWidth: 0, gap: 3 }, title: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 18 }, value: { flexShrink: 1, maxWidth: '48%', minWidth: 0, alignItems: 'flex-end', gap: 3 },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: colors.raised },
  badgeText: { color: colors.blue, fontSize: 10, lineHeight: 15, fontWeight: '600', flexShrink: 1 },
  amount: { fontSize: 13, lineHeight: 19, fontWeight: '600', textAlign: 'right', maxWidth: '100%' }, time: { color: colors.muted, fontSize: 11, lineHeight: 17 },
});
