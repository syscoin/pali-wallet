import React from 'react';
import { StyleSheet } from 'react-native';
import { getTestnetFaucet } from '../custody/testnetFaucet';
import type { NativeNetworkRegistration } from '../custody/networkContext';
import { getNetwork } from '../core/networks';
import { Button, Card, colors, styles, Text } from '../ui';
import { useNativeTranslation } from '../platform/localization';

export function TestnetFaucetCard({ registration, busy, opening, onCopy, onOpen }: {
  registration: NativeNetworkRegistration;
  busy: boolean;
  opening: boolean;
  onCopy?: () => void;
  onOpen(): void;
}) {
  const { t } = useNativeTranslation();
  const faucet = getTestnetFaucet(registration);
  if (!faucet) return null;
  return <Card style={s.card}>
    <Text style={s.label}>{t('mobile.portfolioCopy.testFundsTitle', { network: getNetwork(registration.id).name.toUpperCase() })}</Text>
    <Text style={styles.muted}>{t('mobile.portfolioCopy.faucetHelp')}</Text>
    <Text style={s.host}>faucet-zk.tanenbaum.io</Text>
    {onCopy && <Button title={t('transactions.copyAddress')} variant="secondary" icon="copy" disabled={busy} onPress={onCopy} testID="native-faucet-copy" />}
    <Button title={t(opening ? 'mobile.portfolioCopy.openingFaucet' : 'mobile.portfolioCopy.getTestFunds')} icon="arrow-up-right" disabled={busy} onPress={onOpen} testID="native-faucet-open" />
  </Card>;
}

const s = StyleSheet.create({
  card: { padding: 18, gap: 10 },
  label: { color: colors.muted, fontSize: 11, lineHeight: 17, fontWeight: '600', letterSpacing: 1 },
  host: { color: colors.muted, fontSize: 12, lineHeight: 19 },
});
