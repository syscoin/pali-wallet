import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, Header, Notice, Row, Screen, Text } from '../ui';

export function RealSettings({ accountLabel, watchOnly, onSecurity, onLock, onBack }: {
  accountLabel: string; watchOnly: boolean; onSecurity?: () => void; onLock(): void; onBack(): void;
}) {
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen>
    <Header title="Settings" subtitle={accountLabel} onBack={onBack} />
    {onSecurity && <Card><Row title="Security & backups" subtitle="Recovery phrase and account private key" icon="shield" onPress={onSecurity} last /></Card>}
    {watchOnly && <Notice title="Watch-only account" body="This account contains a public address, not its private key or recovery phrase. Keep backups in the wallet that controls it." />}
    <Notice title="Device privacy" body="Pali hides and locks the current session when the app leaves the foreground. Public blockchain activity remains public." />
    <Card style={{ padding: 18, gap: 8 }}><Text style={{ fontSize: 18, fontWeight: '600' }}>About Pali</Text>
      <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>Version 0.1.0 · Development build</Text>
      <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>Biometric unlock and connected apps are not available. Use only test wallets and testnet funds.</Text></Card>
    <Button title={watchOnly ? 'Hide accounts' : 'Lock wallet'} icon="lock" variant="secondary" onPress={onLock} />
  </Screen></SafeAreaView>;
}
