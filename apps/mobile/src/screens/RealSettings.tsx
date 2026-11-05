import React, { useLayoutEffect, useState } from 'react';
import { HelpAbout } from './HelpAbout';
import type { ShellLeafNavigation } from './RealAppShell';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, Header, Notice, Row, Screen } from '../ui';

export function RealSettings({ accountLabel, watchOnly, onSecurity, onAutoLock, onLock, onBack, navigation }: {
  accountLabel: string; watchOnly: boolean; navigation: ShellLeafNavigation; onSecurity?: () => void; onAutoLock?: () => void; onLock(): void; onBack(): void;
}) {
  const [about, setAbout] = useState(false);
  useLayoutEffect(() => navigation.registerBack(() => { if (about) setAbout(false); else onBack(); return true; }), [navigation, about, onBack]);
  useLayoutEffect(() => { navigation.setImmersive(about); return () => navigation.setImmersive(false); }, [navigation, about]);
  if (about) return <HelpAbout onBack={() => setAbout(false)} />;
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen>
    <Header title="Settings" subtitle={accountLabel} onBack={onBack} />
    {onSecurity && <Card><Row title="Security & backups" subtitle="Recovery phrase and account private key" icon="shield" onPress={onSecurity} last /></Card>}
    {onAutoLock && <Card><Row title="Auto-lock" subtitle="Foreground inactivity" icon="lock" onPress={onAutoLock} last /></Card>}
    {watchOnly && <Notice title="Watch-only account" body="This account contains a public address, not its private key or recovery phrase. Keep backups in the wallet that controls it." />}
    <Notice title="Device privacy" body="Pali hides and locks the current session when the app leaves the foreground. Public blockchain activity remains public." />
    <Card><Row title="Help & about" subtitle="Support, documentation and version" icon="info" onPress={() => setAbout(true)} last /></Card>
    <Button title={watchOnly ? 'Hide accounts' : 'Lock wallet'} icon="lock" variant="secondary" onPress={onLock} />
  </Screen></SafeAreaView>;
}
