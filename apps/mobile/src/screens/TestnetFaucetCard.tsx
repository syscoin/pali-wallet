import React from 'react';
import { StyleSheet } from 'react-native';
import { getTestnetFaucet } from '../custody/testnetFaucet';
import type { NativeNetworkRegistration } from '../custody/networkContext';
import { getNetwork } from '../core/networks';
import { Button, Card, colors, styles, Text } from '../ui';

export function TestnetFaucetCard({ registration, busy, opening, onCopy, onOpen }: {
  registration: NativeNetworkRegistration;
  busy: boolean;
  opening: boolean;
  onCopy?: () => void;
  onOpen(): void;
}) {
  const faucet = getTestnetFaucet(registration);
  if (!faucet) return null;
  return <Card style={s.card}>
    <Text style={s.label}>{getNetwork(registration.id).name.toUpperCase()} TEST FUNDS</Text>
    <Text style={styles.muted}>Open the faucet in your browser. Copy your address and paste it there. Pali does not send your address to the faucet.</Text>
    <Text style={s.host}>faucet-zk.tanenbaum.io</Text>
    {onCopy && <Button title="Copy address" variant="secondary" icon="copy" disabled={busy} onPress={onCopy} testID="native-faucet-copy" />}
    <Button title={opening ? 'Opening faucet…' : 'Get test funds'} icon="arrow-up-right" disabled={busy} onPress={onOpen} testID="native-faucet-open" />
  </Card>;
}

const s = StyleSheet.create({
  card: { padding: 18, gap: 10 },
  label: { color: colors.muted, fontSize: 11, lineHeight: 17, fontWeight: '600', letterSpacing: 1 },
  host: { color: colors.muted, fontSize: 12, lineHeight: 19 },
});
