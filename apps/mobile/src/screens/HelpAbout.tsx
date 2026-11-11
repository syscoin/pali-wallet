import React, { useLayoutEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { PALI_INFORMATION } from '../../../../source/shared/paliInformation';
import app from '../../app.json';
import { Button, Card, colors, Header, Screen, Text } from '../ui';
import { WalletUpdatePanel } from './WalletUpdatePanel';

/** Public information only: actions never receive an account, key or wallet authority. */
export function HelpAbout({ onBack, allowInstall = false, onLockForUpdate }: { onBack(): void; allowInstall?: boolean; onLockForUpdate?(): void }) {
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
      if (current()) setFeedback({ action, message: action === 'copy' ? 'Support link copied.' : 'Link opened.' });
    } catch { if (current()) setFeedback({ action, message: action === 'copy' ? 'Could not copy the support link.' : 'Could not open the link. Try again.' }); }
    finally { if (state.pending === pending) { state.pending = null; if (state.mounted) setBusy(false); } }
  };
  const feedbackFor = (action: Action) => feedback?.action === action
    ? <Text testID={`help-${action}-feedback`} accessibilityLiveRegion="polite">{feedback.message}</Text> : null;
  return <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}><Screen footer={<Button title="Done" variant="secondary" onPress={onBack} />}>
    <Header title="Help & about" onBack={onBack} />
    <Card style={{ padding: 18, gap: 8 }}><Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600' }}>Pali Wallet</Text>
      <Text>Version {app.expo.version}{typeof __DEV__ !== 'undefined' && __DEV__ ? ' · Development build' : ''}</Text>
      <Text style={{ color: colors.muted, lineHeight: 22 }}>Native features are under qualification. Use only test wallets and testnet funds.</Text></Card>
    <WalletUpdatePanel allowInstall={allowInstall} onLock={onLockForUpdate} />
    <View style={{ gap: 12 }}><Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '600' }}>Support</Text>
      <Text selectable>{PALI_INFORMATION.supportUrl}</Text>
      <Button icon="help" title="Get support" disabled={busy} onPress={() => void act('support')} />{feedbackFor('support')}
      <Button icon="copy" title="Copy support link" variant="secondary" disabled={busy} onPress={() => void act('copy')} />{feedbackFor('copy')}
      <Button icon="external" title="Pali documentation" variant="secondary" disabled={busy} onPress={() => void act('documentation')} />{feedbackFor('documentation')}</View>
    <View style={{ gap: 12 }}><Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '600' }}>Data provider</Text>
      <Button title={PALI_INFORMATION.dataProvider.name} variant="quiet" disabled={busy} onPress={() => void act('provider')} />{feedbackFor('provider')}</View>
  </Screen></SafeAreaView>;
}
