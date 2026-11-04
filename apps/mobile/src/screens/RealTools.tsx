import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, colors, Header, Notice, Row, Screen, Text } from '../ui';

export function RealTools({ accountLabel, networkLabel, watchOnly, onAccounts, onNetworks, onBack }: {
  accountLabel: string; networkLabel: string; watchOnly: boolean; onAccounts(): void; onNetworks?: () => void; onBack(): void;
}) {
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen>
    <Header title="Tools" subtitle={`${accountLabel} · ${networkLabel}`} onBack={onBack} />
    <Card><Row title="Accounts" subtitle={watchOnly ? 'Manage public watch addresses' : 'Manage wallet and watch accounts'} icon="wallet" onPress={onAccounts} last={!onNetworks} />
      {onNetworks && <Row title="Network" subtitle="Choose a registered network" icon="globe" onPress={onNetworks} last />}</Card>
    {watchOnly && <Notice title="Public address tools" body="These tools manage saved public addresses. They cannot sign transactions or recover their wallets." />}
    <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>Receive and any supported testnet faucet are available on Wallet. QR scanning, swaps and connected apps are not available yet.</Text>
  </Screen></SafeAreaView>;
}
