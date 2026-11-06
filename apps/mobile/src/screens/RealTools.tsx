import React, { useCallback, useLayoutEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, colors, Header, Notice, Row, Screen, Text } from '../ui';
import type { ShellLeafNavigation } from './RealAppShell';
import { TrustedSiteLookup } from './TrustedSiteLookup';
import { WatchGuardianRecovery, type WatchGuardianRecoveryTool } from './WatchGuardianRecovery';

export function RealTools({ accountLabel, networkLabel, watchOnly, onAccounts, onNetworks, onPrivateNotes, onBack, navigation, guardianRecovery }: {
  accountLabel: string; networkLabel: string; watchOnly: boolean; onAccounts(): void; onNetworks?: () => void; onPrivateNotes?: () => void; onBack(): void;
  navigation: ShellLeafNavigation; guardianRecovery?: WatchGuardianRecoveryTool;
}) {
  const [pane, setPane] = useState<{ kind: 'lookup' } | { kind: 'guardian'; scope: string; lifetime: AbortController } | null>(null);
  const lookup = pane?.kind === 'lookup';
  const guardian = pane?.kind === 'guardian' && pane.scope === guardianRecovery?.scope ? pane : undefined;
  const immersive = lookup || !!guardian;
  const closePane = useCallback(() => { if (pane?.kind === 'guardian') pane.lifetime.abort(); setPane(null); }, [pane]);
  useLayoutEffect(() => navigation.registerBack(() => {
    if (immersive) closePane(); else onBack();
    return true;
  }), [closePane, immersive, navigation, onBack]);
  useLayoutEffect(() => {
    navigation.setImmersive(immersive);
    return () => navigation.setImmersive(false);
  }, [immersive, navigation]);
  if (lookup) return <TrustedSiteLookup onBack={closePane} />;
  if (guardian && guardianRecovery) return <WatchGuardianRecovery key={guardian.scope} address={guardianRecovery.address}
    networkLabel={networkLabel} onBack={closePane} lifetime={guardian.lifetime.signal} read={guardianRecovery.read} />;
  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen>
    <Header title="Tools" subtitle={`${accountLabel} · ${networkLabel}`} onBack={onBack} />
    <Card><Row title="Accounts" subtitle={watchOnly ? 'Manage public watch addresses' : 'Manage wallet and watch accounts'} icon="wallet" onPress={onAccounts} />
      {onNetworks && <Row title="Network" subtitle="Choose a registered network" icon="globe" onPress={onNetworks} />}
      <Row title="Check a site" subtitle="Look up a domain on Pali’s list" icon="shield" onPress={() => setPane({ kind: 'lookup' })} last={!onPrivateNotes && !guardianRecovery} />
      {guardianRecovery && <Row title="Guardian recovery" subtitle="Check on-chain recovery status" icon="shield" onPress={() =>
        setPane({ kind: 'guardian', scope: guardianRecovery.scope, lifetime: new AbortController() })
      } last={!onPrivateNotes} />}
      {onPrivateNotes && <Row title="Private notes" subtitle="View, back up or restore notes" icon="lock" onPress={onPrivateNotes} last />}</Card>
    {watchOnly && <Notice title="Public address tools" body="These tools manage saved public addresses. They cannot sign transactions or recover their wallets." />}
    <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 22 }}>Receive and any supported testnet faucet are available on Wallet. QR scanning, swaps and connected apps are not available yet.</Text>
  </Screen></SafeAreaView>;
}
