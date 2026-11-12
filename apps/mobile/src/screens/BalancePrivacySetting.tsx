import { useNativeTranslation } from '../platform/localization';
import React from 'react';
import { Switch } from 'react-native';
import { reloadBalancePrivacy, saveBalancePrivacy, useBalancePrivacy } from '../platform/balancePrivacy';
import { Button, colors, Row, Text } from '../ui';

/** The same device-wide display preference for wallet and watch sessions. */
export function BalancePrivacySetting() {
  const { t } = useNativeTranslation();
  const privacy = useBalancePrivacy();
  return <>
    <Row title={t('mobile.generalViews.privacyMode')} subtitle={t('mobile.generalViews.hideBalances')} icon="eye" right={<Switch
      accessibilityLabel={t('mobile.generalViews.hideBalances')} value={privacy.hidden}
      disabled={privacy.status !== 'ready'} trackColor={{ true: colors.pink }}
      onValueChange={hidden => { if (privacy.status === 'ready') void saveBalancePrivacy(hidden); }} />} />
    {privacy.status === 'unavailable' && <>
      <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 14, lineHeight: 21 }}>{t('mobile.generalViews.privacyUnavailable')}</Text>
      <Button icon="refresh" title={t('mobile.generalViews.retryPrivacy')} variant="secondary" onPress={() => void reloadBalancePrivacy()} />
    </>}
  </>;
}
