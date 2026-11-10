import { IdleTextInput, IdlePressable } from './IdleActivityBoundary';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { colors, Icon, PaliMark, WelcomeBackdrop } from '../ui';
import { useNativeTranslation } from '../platform/localization';
import { createWatchAccount, type WatchAccountNetwork } from '../core/watchOnlyAuthority';
import { parseUtxoPublicIdentifier } from '../core/utxoIdentifier';
import { getUtxoNetwork, isCustomUtxoNetworkId, UTXO_NETWORKS, type UtxoNetwork } from '../core/utxoNetworks';
import type { WatchUtxoNetworksView } from '../core/publicAccountStorage';
import { WatchNetworks } from './WatchNetworks';

const watchChoices = (registrations: readonly UtxoNetwork[]) => [
  { id: 'evm' as const, title: 'EVM networks', shortName: 'Ethereum', inputLabel: 'Public EVM address', prefix: '0x', provider: 'the selected EVM network provider', scope: 'Ethereum and compatible networks. Paste only a public address.' },
  ...registrations.map((network) => ({
    id: network.id, title: isCustomUtxoNetworkId(network.id) ? `${network.name} · ${new URL(network.endpoint).hostname}` : network.name, shortName: network.name, inputLabel: 'Public address, account key or descriptor',
    prefix: `${network.addressNetwork.bech32}1, ${network.testnet ? 'vpub' : 'zpub'} or wpkh(…)`,
    scope: 'A public account key or descriptor includes its receive and change addresses.',
  })),
];

type WelcomeProps = {
  onPreview: () => void;
  onDesign?: () => void;
  onWatch: () => void;
  onCreateWallet?: () => void;
  onImportWallet?: () => void;
};

type AddWatchAccountProps = {
  onAdd: (account: { name: string; address: string; network?: WatchAccountNetwork }) => Promise<void>;
  onCancel: () => void;
  availableNetworks?: readonly WatchAccountNetwork[];
  utxoNetworks?: readonly UtxoNetwork[];
  networkSettings?: WatchUtxoNetworksView;
  onNetworksChanged?(): Promise<void>;
};

export function Welcome({
  onPreview,
  onWatch,
  onDesign,
  onCreateWallet,
  onImportWallet,
}: WelcomeProps) {
  const { t } = useNativeTranslation();
  const compact = useWindowDimensions().height < 740;
  return (
    <View style={styles.screen}>
      <WelcomeBackdrop />
      <ScrollView
        style={styles.welcomeScroll}
        contentContainerStyle={styles.welcomeContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.welcomeBrand}>
          <PaliMark size={compact ? 96 : 120} />
          <Text accessibilityRole="header" style={styles.welcomeName}>Pali Wallet</Text>
        </View>

        {!onCreateWallet && !onImportWallet && (
          <View style={styles.previewActions}>
            {onDesign && (
              <IdlePressable
                accessibilityRole="button"
                onPress={onDesign}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {t('mobile.welcome.designReview')}
                </Text>
                <Icon name="arrow-right" size={21} color={colors.bg} />
              </IdlePressable>
            )}
            <IdlePressable
              accessibilityRole="button"
              accessibilityHint={t('mobile.welcome.previewHint')}
              onPress={onPreview}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>{t('mobile.welcome.preview')}</Text>
            </IdlePressable>
            <Text style={styles.previewNote}>
              {t('mobile.welcome.previewNote')}
            </Text>
          </View>
        )}
      </ScrollView>
      <View style={styles.welcomeActions}>
        {onCreateWallet && (
          <IdlePressable
            accessibilityRole="button"
            onPress={onCreateWallet}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>Create wallet</Text>
          </IdlePressable>
        )}
        {onImportWallet && (
          <IdlePressable accessibilityRole="button" onPress={onImportWallet}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>Import existing wallet</Text>
          </IdlePressable>
        )}
        <IdlePressable
          accessibilityRole="button"
          accessibilityHint={t('mobile.welcome.watchHint')}
          onPress={onWatch}
          style={({ pressed }) => [
            onCreateWallet || onImportWallet ? styles.quietButton : styles.primaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={
              onCreateWallet || onImportWallet ? styles.quietButtonText : styles.primaryButtonText
            }
          >
            {t('mobile.welcome.watch')}
          </Text>
          {!onCreateWallet && !onImportWallet && <Icon name="arrow-right" size={21} color={colors.bg} />}
        </IdlePressable>
      </View>
    </View>
  );
}

export function AddWatchAccount({ onAdd, onCancel, availableNetworks, utxoNetworks = UTXO_NETWORKS, networkSettings, onNetworksChanged }: AddWatchAccountProps) {
  const choices = watchChoices(utxoNetworks);
  const available = availableNetworks ?? choices.map(({ id }) => id);
  const [managingNetworks, setManagingNetworks] = useState(false);
  const [name, setName] = useState('Account 1');
  const [address, setAddress] = useState('');
  const [network, setNetwork] = useState<WatchAccountNetwork>('evm');
  const [review, setReview] = useState<{ name: string; address: string; network: WatchAccountNetwork } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const addressInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const submissionInProgress = useRef(false);
  const alive = useRef(true);
  const hardwareBack = useRef<() => boolean>(() => true);
  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener('change', (state) => { if (state !== 'active') { setReview(null); setError(null); } });
    return () => { alive.current = false; listener.remove(); };
  }, []);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [review]);
  const info = choices.find((choice) => choice.id === network) ?? choices[0]!;
  const closeNetworks = () => {
    setManagingNetworks(false);
    if (info.id !== network) { setNetwork(info.id); setAddress(''); }
  };
  const back = () => { if (submissionInProgress.current) return; if (managingNetworks) return; if (review) { setReview(null); setError(null); } else onCancel(); };
  useLayoutEffect(() => { hardwareBack.current = () => { if (managingNetworks) return false; back(); return true; }; });
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => hardwareBack.current());
    return () => listener.remove();
  }, []);
  const prepare = () => {
    if (submissionInProgress.current || AppState.currentState !== 'active') return;
    try {
      if (info.id !== network || !available.includes(network)) throw new Error('This network is not available in this build.');
      const source = network === 'evm' ? null : parseUtxoPublicIdentifier(address.trim(), getUtxoNetwork(network, utxoNetworks));
      const account = createWatchAccount('review', name.trim(), source?.address ?? address.trim(), network, utxoNetworks);
      setReview({ name: account.name, address: source?.identifier ?? Object.values(account.addresses)[0]!, network });
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the public address.'); }
  };
  const confirm = async () => {
    if (!review || submissionInProgress.current || AppState.currentState !== 'active' || !available.includes(review.network)) return;
    submissionInProgress.current = true; setSubmitting(true); setError(null);
    try { await onAdd(review); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'This account could not be added. Please try again.'); }
    finally { submissionInProgress.current = false; if (alive.current) setSubmitting(false); }
  };
  if (managingNetworks && networkSettings && onNetworksChanged)
    return <WatchNetworks controller={networkSettings} onChanged={onNetworksChanged} onBack={closeNetworks} />;
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.formNavigation}>
        <IdlePressable accessibilityRole="button" accessibilityLabel="Back" disabled={submitting} onPress={back} hitSlop={8} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Icon name="arrow-left" size={22} color={colors.text} /></IdlePressable>
        <Text style={styles.navigationLabel}>{review ? 'REVIEW ACCOUNT' : 'ADD ACCOUNT'}</Text><View style={styles.navigationBalance} />
      </View>
      <View style={styles.formIntro}><View style={styles.largeEye}><Icon name="eye" size={30} color={colors.blue} /></View>
        <Text accessibilityRole="header" style={styles.formTitle}>{review ? 'Check your watch account' : 'Watch an account'}</Text>
        <Text style={styles.formDescription}>{review ? 'Check the network and public account before saving.' : 'Keep an eye on a wallet using only its public information.'}</Text>
      </View>
      {review ? <View style={styles.fields}>
        <View style={styles.fieldGroup}><Text style={styles.fieldLabel}>Account name</Text><Text style={styles.reviewText}>{review.name}</Text></View>
        <View style={styles.fieldGroup}><Text style={styles.fieldLabel}>Network</Text><Text style={styles.reviewText}>{info.title}</Text></View>
        <View style={styles.fieldGroup}><Text style={styles.fieldLabel}>Public account</Text><Text selectable accessibilityLabel={`Review ${info.title} address ${review.address}`} style={styles.reviewAddress}>{review.address}</Text></View>
        <Text style={styles.fieldHint}>{info.scope}</Text>
      </View> : <View style={styles.fields}>
        <View style={styles.fieldGroup}><Text style={styles.fieldLabel}>Address network</Text>
          <View style={styles.networkChoices}>{choices.map((choice) => <IdlePressable key={choice.id} accessibilityRole="button" accessibilityLabel={choice.title}
            accessibilityState={{ selected: network === choice.id, disabled: !available.includes(choice.id) }} disabled={!available.includes(choice.id) || submitting}
            onPress={() => { setNetwork(choice.id); setAddress(''); setReview(null); setError(null); }}
            style={[styles.networkChoice, network === choice.id && styles.networkChoiceSelected, !available.includes(choice.id) && styles.disabled]}>
            <Text style={styles.networkChoiceTitle}>{choice.title}</Text>{!available.includes(choice.id) && <Text style={styles.fieldHint}>Not available yet</Text>}
          </IdlePressable>)}</View>
          {networkSettings && onNetworksChanged && <IdlePressable accessibilityRole="button" accessibilityLabel="Manage watch networks"
            onPress={() => { setError(null); setManagingNetworks(true); }}>
            <Text style={styles.fieldHint}>Manage networks</Text>
          </IdlePressable>}
        </View>
        <View style={styles.fieldGroup}><Text style={styles.fieldLabel}>Account name</Text>
          <IdleTextInput accessibilityLabel="Account name" autoCapitalize="words" autoComplete="off" autoCorrect={false} editable={!submitting} importantForAutofill="no" maxLength={40}
            onChangeText={(value) => { setName(value); setError(null); }} onSubmitEditing={() => addressInput.current?.focus()} placeholder={`e.g. My ${info.shortName} address`}
            placeholderTextColor={colors.muted} returnKeyType="next" selectionColor={colors.pink} style={styles.input} textContentType="none" value={name} />
        </View>
        <View style={styles.fieldGroup}><Text style={styles.fieldLabel}>{info.inputLabel}</Text>
          <IdleTextInput ref={addressInput} accessibilityLabel={info.inputLabel} accessibilityHint={`Paste public information for ${info.title}. Never enter a recovery phrase or private key.`}
            autoCapitalize="none" autoComplete="off" autoCorrect={false} editable={!submitting} importantForAutofill="no" maxLength={network === 'evm' ? 256 : 4096}
            onChangeText={(value) => { setAddress(value); setError(null); }} onSubmitEditing={prepare} placeholder={`${info.prefix}…`} placeholderTextColor={colors.muted}
            returnKeyType="done" selectionColor={colors.pink} spellCheck={false} style={[styles.input, styles.addressInput]} textContentType="none" value={address} />
          <Text style={styles.fieldHint}>{info.scope}</Text>
        </View>
      </View>}
      {error && <View accessibilityLiveRegion="polite" style={styles.errorCard}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text></View>}
    </ScrollView>
      <View style={styles.formFooter}><IdlePressable accessibilityRole="button" accessibilityState={{ disabled: submitting, busy: submitting }} disabled={submitting}
        onPress={() => review ? void confirm() : prepare()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, submitting && styles.disabled]}>
        {submitting ? <ActivityIndicator color={colors.bg} /> : <Icon name={review ? 'plus' : 'eye'} size={21} color={colors.bg} />}
        <Text style={styles.primaryButtonText}>{submitting ? 'Adding account…' : review ? 'Confirm watch account' : 'Review account'}</Text>
      </IdlePressable><Text style={styles.footerNote}>Use public information only. Never enter a recovery phrase or private key.</Text></View>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  networkChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  networkChoice: { flexBasis: '47%', flexGrow: 1, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 4 },
  networkChoiceSelected: { borderColor: colors.blue, backgroundColor: colors.surface },
  networkChoiceTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  reviewText: { color: colors.text, fontSize: 17, lineHeight: 26 },
  reviewAddress: { color: colors.text, fontSize: 16, lineHeight: 26, flexShrink: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  welcomeScroll: { flex: 1 },
  welcomeContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 20,
  },
  welcomeBrand: { alignItems: 'center', gap: 18, paddingVertical: 28 },
  welcomeName: { color: colors.text, fontSize: 34, lineHeight: 42, fontWeight: '600', letterSpacing: -1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandName: {
    color: colors.text,
    fontSize: 31,
    fontWeight: '700',
    letterSpacing: -1.6,
  },
  mark: { width: 106, height: 120 },
  markStem: {
    position: 'absolute',
    top: 8,
    left: 10,
    width: 28,
    height: 103,
    backgroundColor: colors.pink,
    borderRadius: 7,
  },
  markBowl: {
    position: 'absolute',
    top: 8,
    left: 11,
    width: 92,
    height: 74,
    backgroundColor: colors.pink,
    borderTopRightRadius: 45,
    borderBottomRightRadius: 45,
    borderTopLeftRadius: 9,
  },
  markCutout: {
    position: 'absolute',
    top: 33,
    left: 38,
    width: 37,
    height: 25,
    backgroundColor: colors.raised,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  markSmall: { width: 25, height: 30 },
  markStemSmall: { top: 2, left: 0, width: 7, height: 26, borderRadius: 2 },
  markBowlSmall: {
    top: 2,
    left: 0,
    width: 24,
    height: 19,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderTopLeftRadius: 2,
  },
  markCutoutSmall: {
    top: 8,
    left: 7,
    width: 10,
    height: 7,
    backgroundColor: colors.bg,
    borderTopRightRadius: 5,
    borderBottomRightRadius: 5,
  },
  hero: {
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 7,
    marginBottom: 8,
  },
  heroCompact: { height: 160, transform: [{ scale: 0.75 }] },
  haloOuter: {
    position: 'absolute',
    width: 218,
    height: 218,
    borderRadius: 109,
    borderWidth: 1,
    borderColor: colors.border,
    transform: [{ rotateX: '26deg' }, { rotate: '-17deg' }],
  },
  haloInner: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: colors.surface,
    opacity: 0.7,
  },
  heroPlate: {
    width: 153,
    height: 153,
    backgroundColor: colors.raised,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
    borderWidth: 1,
    borderColor: colors.border,
  },
  orbitDot: { position: 'absolute', width: 11, height: 11, borderRadius: 6 },
  orbitDotBlue: { top: 44, right: 61, backgroundColor: colors.blue },
  orbitDotPink: {
    bottom: 50,
    left: 56,
    backgroundColor: colors.pink,
    width: 7,
    height: 7,
  },
  heroChip: {
    position: 'absolute',
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 24,
  },
  heroChipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  intro: { gap: 14 },
  welcomeTitle: {
    color: colors.text,
    fontSize: 42,
    fontWeight: '700',
    lineHeight: 47,
    letterSpacing: -1.7,
  },
  titleAccent: { color: colors.blue },
  welcomeDescription: { color: colors.muted, fontSize: 16, lineHeight: 25 },
  trustRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 24,
  },
  trustIcon: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
  },
  trustText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 18 },
  previewActions: { marginTop: 'auto', gap: 10, paddingTop: 8 },
  welcomeActions: {
    gap: 10,
    paddingHorizontal: 26,
    paddingTop: 12,
    paddingBottom: 20,
  },
  quietButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 12 },
  quietButtonText: { color: colors.blue, fontSize: 15, lineHeight: 22, fontWeight: '500', textAlign: 'center' },
  primaryButton: {
    minHeight: 56,
    paddingVertical: 15,
    paddingHorizontal: 18,
    backgroundColor: colors.pink,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryButtonText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },
  secondaryButton: {
    minHeight: 52,
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: colors.blue,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  previewNote: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 3,
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.65 },
  formContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 24,
  },
  formNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -10,
  },
  navigationLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
  },
  navigationBalance: { width: 38 },
  formIntro: { paddingTop: 12, paddingBottom: 18 },
  largeEye: {
    width: 61,
    height: 61,
    borderRadius: 21,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 23,
  },
  formTitle: {
    color: colors.text,
    fontSize: 32,
    lineHeight: 39,
    fontWeight: '700',
    letterSpacing: -1.1,
  },
  formDescription: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 25,
    marginTop: 10,
  },
  fields: { gap: 16 },
  fieldGroup: { gap: 10 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  input: {
    color: colors.text,
    backgroundColor: colors.surface,
    minHeight: 58,
    paddingHorizontal: 17,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    fontSize: 16,
    lineHeight: 23,
  },
  addressInput: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
  },
  fieldHint: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  safetyCard: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 28,
    padding: 17,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  safetyCopy: { flex: 1, gap: 6 },
  safetyTitle: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  safetyDescription: { color: colors.muted, fontSize: 12, lineHeight: 20 },
  errorCard: {
    borderLeftWidth: 2,
    borderLeftColor: colors.red,
    marginTop: 20,
    paddingLeft: 13,
    paddingVertical: 3,
  },
  errorText: { color: colors.red, fontSize: 13, lineHeight: 21 },
  formFooter: { paddingHorizontal: 24, paddingVertical: 14, gap: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  footerNote: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
});
