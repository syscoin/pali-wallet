import React, { useLayoutEffect, useState } from 'react';
import { DisplayCurrency } from './DisplayCurrency';
import { HelpAbout } from './HelpAbout';
import type { ShellLeafNavigation } from './RealAppShell';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, Header, Notice, Row, Screen } from '../ui';

export function RealSettings({ accountLabel, watchOnly, onSecurity, onAutoLock, onLock, onBack, navigation }: {
  accountLabel: string; watchOnly: boolean; navigation: ShellLeafNavigation; onSecurity?: () => void; onAutoLock?: () => void; onLock(): void; onBack(): void;
}) {
  const [leaf, setLeaf] = useState<'about' | 'currency' | null>(null);
  const back = () => { if (leaf) setLeaf(null); else onBack(); };
  useLayoutEffect(() => navigation.registerBack(() => { back(); return true; }));
  useLayoutEffect(() => { navigation.setImmersive(leaf !== null); return () => navigation.setImmersive(false); }, [navigation, leaf]);
  if (leaf === 'about') return <HelpAbout onBack={back} />;
  if (leaf === 'currency') return <DisplayCurrency onBack={back} />;
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen>
    <Header title="Settings" subtitle={accountLabel} onBack={onBack} />
    {onSecurity && <Card><Row title="Security & backups" subtitle="Recovery phrase and account private key" icon="shield" onPress={onSecurity} last /></Card>}
    {onAutoLock && <Card><Row title="Auto-lock" subtitle="Foreground inactivity" icon="lock" onPress={onAutoLock} last /></Card>}
    {watchOnly && <Notice title="Watch-only account" body="This account contains a public address, not its private key or recovery phrase. Keep backups in the wallet that controls it." />}
    <Notice title="Device privacy" body="Pali hides and locks the current session when the app leaves the foreground. Public blockchain activity remains public." />
    <Card>
      <Row title="Display currency" subtitle="Estimated wallet values" icon="globe" onPress={() => setLeaf('currency')} />
      <Row title="Help & about" subtitle="Support, documentation and version" icon="info" onPress={() => setLeaf('about')} last />
    </Card>
    <Button title={watchOnly ? 'Hide accounts' : 'Lock wallet'} icon="lock" variant="secondary" onPress={onLock} />
  </Screen></SafeAreaView>;
}
