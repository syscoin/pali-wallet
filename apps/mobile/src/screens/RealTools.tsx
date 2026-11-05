import React, { useLayoutEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, colors, Header, Notice, Row, Screen, Text } from '../ui';
import type { ShellLeafNavigation } from './RealAppShell';
import { TrustedSiteLookup } from './TrustedSiteLookup';

export function RealTools({ accountLabel, networkLabel, watchOnly, onAccounts, onNetworks, onBack, navigation }: {
  accountLabel: string; networkLabel: string; watchOnly: boolean; onAccounts(): void; onNetworks?: () => void; onBack(): void;
  navigation: ShellLeafNavigation;
}) {
  const [lookup, setLookup] = useState(false);
  useLayoutEffect(() => navigation.registerBack(() => {
    if (lookup) setLookup(false); else onBack();
    return true;
  }), [lookup, navigation, onBack]);
  useLayoutEffect(() => {
    navigation.setImmersive(lookup);
    return () => navigation.setImmersive(false);
  }, [lookup, navigation]);
  if (lookup) return <TrustedSiteLookup onBack={() => setLookup(false)} />;
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen>
    <Header title="Tools" subtitle={`${accountLabel} · ${networkLabel}`} onBack={onBack} />
    <Card><Row title="Accounts" subtitle={watchOnly ? 'Manage public watch addresses' : 'Manage wallet and watch accounts'} icon="wallet" onPress={onAccounts} />
      {onNetworks && <Row title="Network" subtitle="Choose a registered network" icon="globe" onPress={onNetworks} />}
      <Row title="Check a site" subtitle="Look up a domain on Pali’s list" icon="shield" onPress={() => setLookup(true)} last /></Card>
    {watchOnly && <Notice title="Public address tools" body="These tools manage saved public addresses. They cannot sign transactions or recover their wallets." />}
    <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>Receive and any supported testnet faucet are available on Wallet. QR scanning, swaps and connected apps are not available yet.</Text>
  </Screen></SafeAreaView>;
}
