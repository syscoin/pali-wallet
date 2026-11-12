import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { useNativeTranslation } from '../platform/localization';
import { colors, Icon, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';

/** Public address only; the caller retains its account/lifecycle clipboard guard. */
export function CopyableAddress({ address, label, onCopy, disabled = false, style, testID }: {
  address: string;
  label?: string;
  onCopy(): void;
  disabled?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const { t } = useNativeTranslation();
  return <IdlePressable accessibilityRole="button"
    accessibilityLabel={t('mobile.chartInteraction.copyAddress', { address: label ?? address })}
    accessibilityHint={t('mobile.chartInteraction.copyHint')} disabled={disabled}
    onPress={onCopy} onLongPress={onCopy} style={({ pressed }) => [s.container, pressed && !disabled && s.pressed]} testID={testID ? `${testID}-copy` : undefined}>
    <Text style={[s.address, style]} testID={testID}>{address}</Text>
    <Icon name="copy" size={18} color={disabled ? colors.muted : colors.blue} />
  </IdlePressable>;
}
const s = StyleSheet.create({
  container: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  address: { flex: 1, flexShrink: 1, minWidth: 0 },
  pressed: { opacity: 0.65 },
});
