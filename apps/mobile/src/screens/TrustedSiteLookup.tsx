import { useNativeTranslation } from '../platform/localization';
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import trustedSites from '../../../../source/constants/trustedApps.json';
import {
  boundDappSiteLookupText,
  getDappOrigin,
  getDappSiteLookupUrl,
  isTrustedDappOrigin,
  MAX_DAPP_SITE_LOOKUP_LENGTH,
} from '../../../../source/utils/dappOrigin';
import { Button, Card, colors, Header, Screen, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

export function TrustedSiteLookup({ onBack }: { onBack(): void }) {
  const { t } = useNativeTranslation();
  const [site, setSite] = useState('');
  const [origin, setOrigin] = useState<string | null>();
  const canCheck = site.trim().length > 0;
  const check = () => {
    if (!canCheck) return;
    const candidate = getDappSiteLookupUrl(site);
    setOrigin(candidate ? getDappOrigin(candidate) : null);
  };
  const listed = origin && isTrustedDappOrigin(origin, trustedSites);

  return <SafeAreaView edges={['top']} style={s.container}><Screen>
    <Header title={t('mobile.generalViews.checkSite')} onBack={onBack} />
    <Text style={s.body}>{t('mobile.generalViews.siteListHelp')}</Text>
    <IdleTextInput accessibilityLabel={t('mobile.generalViews.siteAddress')} value={site} onChangeText={(value) => {
      setSite(boundDappSiteLookupText(value));
      setOrigin(undefined);
    }} onSubmitEditing={check} returnKeyType="search"
      autoCapitalize="none" autoCorrect={false} spellCheck={false} keyboardType="url"
      placeholder="example.com" placeholderTextColor={colors.muted} style={s.input} />
    <Button title={t('mobile.generalViews.checkSiteButton')} onPress={check} disabled={!canCheck} />
    {origin !== undefined && <Card style={s.result}>
      <Text accessibilityLiveRegion="polite" style={s.status}>
        {site.length > MAX_DAPP_SITE_LOOKUP_LENGTH ? t('mobile.generalViews.siteTooLong')
          : origin === null ? t('mobile.generalViews.invalidSite') : listed ? t('mobile.generalViews.listedSite') : t('mobile.generalViews.unlistedSite')}
      </Text>
      {origin && <>
        <Text selectable style={s.origin}>{origin}</Text>
        <Text style={s.body}>{t('mobile.generalViews.listMatchHelp')}</Text>
      </>}
    </Card>}
  </Screen></SafeAreaView>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  input: { minHeight: 54, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 16, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  result: { gap: 8, padding: 16 },
  status: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  origin: { color: colors.blue, fontSize: 16, lineHeight: 23 },
});
