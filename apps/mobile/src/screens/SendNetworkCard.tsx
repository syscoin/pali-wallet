import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeSendContext } from '../custody/networkContext';
import { Button, Card, Coin, colors, styles, Text } from '../ui';

/** The network shown for either native transaction engine's current send form. */
export function SendNetworkCard({ context, disabled, onChange }: {
  context: NativeSendContext;
  disabled: boolean;
  onChange?: () => void;
}) {
  return <Card style={s.card}>
    <Coin id={context.networkId} size={32} />
    <View style={s.description}>
      <Text style={s.name}>{context.name}</Text>
      <Text style={styles.muted}>{context.symbol}{context.testnet ? ' · Test network' : ''}</Text>
    </View>
    {onChange && <Button title="Change" variant="secondary" size="compact" disabled={disabled} onPress={onChange} />}
  </Card>;
}

const s = StyleSheet.create({
  card: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  description: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 14, fontWeight: '600', color: colors.text },
});
