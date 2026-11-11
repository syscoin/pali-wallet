import React from 'react';
import { Switch } from 'react-native';
import { reloadBalancePrivacy, saveBalancePrivacy, useBalancePrivacy } from '../platform/balancePrivacy';
import { Button, colors, Row, Text } from '../ui';

/** The same device-wide display preference for wallet and watch sessions. */
export function BalancePrivacySetting() {
  const privacy = useBalancePrivacy();
  return <>
    <Row title="Privacy mode" subtitle="Hide balances and Activity summaries" icon="eye" right={<Switch
      accessibilityLabel="Hide balances and Activity summaries" value={privacy.hidden}
      disabled={privacy.status !== 'ready'} trackColor={{ true: colors.pink }}
      onValueChange={hidden => { if (privacy.status === 'ready') void saveBalancePrivacy(hidden); }} />} />
    {privacy.status === 'unavailable' && <>
      <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 14, lineHeight: 21 }}>Privacy setting unavailable. Balances stay hidden until the saved setting can be read.</Text>
      <Button icon="refresh" title="Retry privacy setting" variant="secondary" onPress={() => void reloadBalancePrivacy()} />
    </>}
  </>;
}
