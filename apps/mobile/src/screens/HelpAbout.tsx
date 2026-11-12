import { useNativeTranslation } from '../platform/localization';
import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Linking, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { PALI_INFORMATION } from '../../../../source/shared/paliInformation';
import app from '../../app.json';
import { Button, Card, colors, Header, Row, Screen, Text } from '../ui';
import { mobileUpdates } from '../updates/service';

/** Public information only: actions never receive an account, key or wallet authority. */
export function HelpAbout({ onBack, onUpdates, onResetActivity }: { onBack(): void; onUpdates?(): void; onResetActivity?(): void }) {
  const { t } = useNativeTranslation();
  const update = useSyncExternalStore(mobileUpdates.subscribe, mobileUpdates.getSnapshot, mobileUpdates.getSnapshot);
  const life = useRef({ mounted: false, focused: true, epoch: 0, pending: null as object | null });
  const [busy, setBusy] = useState(false);
  type Action = 'documentation' | 'support' | 'provider' | 'copy';
  const [feedback, setFeedback] = useState<{ action: Action; message: string } | null>(null);
  useLayoutEffect(() => {
    const state = life.current;
    state.mounted = true;
    state.focused = AppState.currentState === 'active';
    const revoke = () => { state.epoch++; state.focused = false; setFeedback(null); };
    const change = AppState.addEventListener('change', (next) => { if (next !== 'active') revoke(); else state.focused = true; });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', revoke) : null;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => { state.focused = true; }) : null;
    return () => { state.mounted = false; state.epoch++; change.remove(); blur?.remove(); focus?.remove(); };
  }, []);
  const act = async (action: Action) => {
    const state = life.current;
    if (!state.mounted || !state.focused || state.pending || AppState.currentState !== 'active') return;
    const pending = {}, epoch = state.epoch;
    const current = () => state.mounted && state.focused && state.epoch === epoch && state.pending === pending && AppState.currentState === 'active';
    state.pending = pending; setBusy(true); setFeedback(null);
    try {
      if (action === 'copy') {
        if (await Clipboard.setStringAsync(PALI_INFORMATION.supportUrl) === false) throw Error();
      } else {
        const url = action === 'documentation' ? PALI_INFORMATION.documentationUrl : action === 'support' ? PALI_INFORMATION.supportUrl : PALI_INFORMATION.dataProvider.url;
        await Linking.openURL(url);
      }
      if (current()) setFeedback({ action, message: action === 'copy' ? 'mobile.generalViews.supportCopied' : 'mobile.generalViews.linkOpened' });
    } catch { if (current()) setFeedback({ action, message: action === 'copy' ? 'mobile.generalViews.copySupportFailed' : 'mobile.generalViews.openLinkFailed' }); }
    finally { if (state.pending === pending) { state.pending = null; if (state.mounted) setBusy(false); } }
  };
  const feedbackFor = (action: Action) => feedback?.action === action
    ? <Text testID={`help-${action}-feedback`} accessibilityLiveRegion="polite">{t(feedback.message)}</Text> : null;
  return <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen footer={<Button title={t('privacy.deposit.done')} variant="secondary" onPress={onBack} />}>
    <Header title={t('mobile.settings.helpTitle')} onBack={onBack} />
    <Card style={{ padding: 18, gap: 8 }}><Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600' }}>Pali Wallet</Text>
      <Text>{t('mobile.generalViews.version', { version: app.expo.version })}{typeof __DEV__ !== 'undefined' && __DEV__ ? t('mobile.generalViews.developmentBuild') : ''}</Text>
      <Text style={{ color: colors.muted, lineHeight: 22 }}>{t('mobile.generalViews.qualificationNotice')}</Text></Card>
    {onUpdates && <Card><Row icon="refresh" title={update.release ? t('mobile.generalViews.updateAvailable', { version: update.release.version }) : t('mobile.generalViews.appUpdates')}
      subtitle={update.release ? t('mobile.generalViews.viewUpdate') : t('mobile.generalViews.checkUpdates')} onPress={onUpdates} dense last /></Card>}
    <View style={{ gap: 12 }}><Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '600' }}>{t('mobile.generalViews.support')}</Text>
      <Text selectable>{PALI_INFORMATION.supportUrl}</Text>
      <Button icon="help" title={t('mobile.generalViews.getSupport')} disabled={busy} onPress={() => void act('support')} />{feedbackFor('support')}
      <Button icon="copy" title={t('mobile.generalViews.copySupport')} variant="secondary" disabled={busy} onPress={() => void act('copy')} />{feedbackFor('copy')}
      <Button icon="external" title={t('mobile.generalViews.documentation')} variant="secondary" disabled={busy} onPress={() => void act('documentation')} />{feedbackFor('documentation')}</View>
    {onResetActivity && <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '600' }}>{t('mobile.settings.maintenanceTitle')}</Text>
      <Card><Row icon="activity" title={t('mobile.settings.activityTitle')} subtitle={t('mobile.settings.activitySubtitle')} onPress={onResetActivity} dense last /></Card>
    </View>}
    <View style={{ gap: 12 }}><Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '600' }}>{t('mobile.generalViews.dataProvider')}</Text>
      <Button title={PALI_INFORMATION.dataProvider.name} variant="quiet" disabled={busy} onPress={() => void act('provider')} />{feedbackFor('provider')}</View>
  </Screen></SafeAreaView>;
}
