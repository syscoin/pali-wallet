import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, Icon, PaliMark } from '../ui';
import { createWatchAccount, type WatchAccountNetwork } from '../core/watchOnlyAuthority';
import { NETWORKS } from '../core/networks';
import { parseUtxoPublicIdentifier } from '../core/utxoIdentifier';
const DEFAULT_WATCH_NETWORKS: readonly WatchAccountNetwork[] = ['evm', ...NETWORKS.filter((n) => n.canWatch && (n.id === 'syscoin' || n.id === 'bitcoin')).map((n) => n.id as 'syscoin' | 'bitcoin')];
const WATCH_CHOICES = [
  { id: 'evm' as const, title: 'EVM networks', shortName: 'Ethereum', inputLabel: 'Public EVM address', prefix: '0x', provider: 'the selected EVM network provider', scope: 'Ethereum and compatible networks. Paste only a public address.' },
  { id: 'syscoin' as const, title: 'Syscoin UTXO', shortName: 'Syscoin', inputLabel: 'Public address, account key or descriptor', prefix: 'sys1, zpub or wpkh(…)', scope: 'A public account key or descriptor includes its receive and change addresses.' },
  { id: 'bitcoin' as const, title: 'Bitcoin', shortName: 'Bitcoin', inputLabel: 'Public address, account key or descriptor', prefix: 'bc1, xpub or wpkh(…)', scope: 'A public account key or descriptor includes its receive and change addresses.' },
];

type WelcomeProps = {
  onPreview: () => void;
  onDesign?: () => void;
  onWatch: () => void;
  onWallet?: () => void;
};

type AddWatchAccountProps = {
  onAdd: (account: { name: string; address: string; network?: WatchAccountNetwork }) => Promise<void>;
  onCancel: () => void;
  availableNetworks?: readonly WatchAccountNetwork[];
};

function BrandMark({ small = false }: { small?: boolean }) {
  return <PaliMark size={small ? 32 : 112} />;
}

export function Welcome({ onPreview, onWatch, onDesign, onWallet }: WelcomeProps) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.welcomeContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.brandRow}>
        <BrandMark small />
        <Text style={styles.brandName}>pali</Text>
      </View>

      <View
        style={styles.hero}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.haloOuter} />
        <View style={styles.haloInner} />
        <View style={styles.heroPlate}>
          <BrandMark />
        </View>
        <View style={[styles.orbitDot, styles.orbitDotBlue]} />
        <View style={[styles.orbitDot, styles.orbitDotPink]} />
        <View style={styles.heroChip}>
          <Icon name="eye" size={16} color={colors.blue} />
          <Text style={styles.heroChipText}>A little more clarity</Text>
        </View>
      </View>

      <View style={styles.intro}>
        <Text accessibilityRole="header" style={styles.welcomeTitle}>
          Your crypto.{'\n'}
          <Text style={styles.titleAccent}>A clearer view.</Text>
        </Text>
        <Text style={styles.welcomeDescription}>
          {onWallet ? 'Create a wallet that stays with you, or follow a public address.' : 'Follow your balances with a public address. Your recovery phrase and private keys stay with you.'}
        </Text>
      </View>

      <View style={styles.trustRow}>
        <View style={styles.trustIcon}>
          <Icon name="shield" size={18} color={colors.green} />
        </View>
        <Text style={styles.trustText}>
          {onWallet ? 'Your wallet. Your recovery phrase. Your control.' : 'Watch-only. No access to spend your funds.'}
        </Text>
      </View>

      <View style={styles.welcomeActions}>
        {onWallet && <Pressable accessibilityRole="button" onPress={onWallet}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryButtonText}>Set up your wallet</Text>
          <Icon name="arrow-right" size={21} color={colors.bg} />
        </Pressable>}
        {onDesign && (
          <Pressable
            accessibilityRole="button"
            onPress={onDesign}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              Review full wallet design
            </Text>
            <Icon name="arrow-right" size={21} color={colors.bg} />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Add a public address or account key to view its balance"
          onPress={onWatch}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>Watch an account</Text>
          <Icon name="arrow-right" size={21} color={colors.bg} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Open a separate interactive preview using sample balances"
          onPress={onPreview}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.secondaryButtonText}>Explore the design</Text>
        </Pressable>
        <Text style={styles.previewNote}>
          The design preview uses sample balances.
        </Text>
      </View>
    </ScrollView>
  );
}

export function AddWatchAccount({ onAdd, onCancel, availableNetworks = DEFAULT_WATCH_NETWORKS }: AddWatchAccountProps) {
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
  const hardwareBack = useRef(() => undefined as void);
  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener('change', (state) => { if (state !== 'active') { setReview(null); setError(null); } });
    return () => { alive.current = false; listener.remove(); };
  }, []);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [review]);
  const info = WATCH_CHOICES.find((choice) => choice.id === network)!;
  const back = () => { if (submissionInProgress.current) return; if (review) { setReview(null); setError(null); } else onCancel(); };
  useLayoutEffect(() => { hardwareBack.current = back; });
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { hardwareBack.current(); return true; });
    return () => listener.remove();
  }, []);
  const prepare = () => {
    if (submissionInProgress.current || AppState.currentState !== 'active') return;
    try {
      if (!availableNetworks.includes(network)) throw new Error('This network is not available in this build.');
      const source = network === 'evm' ? null : parseUtxoPublicIdentifier(address.trim(), network);
      const account = createWatchAccount('review', name.trim(), source?.address ?? address.trim(), network);
      setReview({ name: account.name, address: source?.identifier ?? Object.values(account.addresses)[0]!, network });
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the public address.'); }
  };
  const confirm = async () => {
    if (!review || submissionInProgress.current || AppState.currentState !== 'active' || !availableNetworks.includes(review.network)) return;
    submissionInProgress.current = true; setSubmitting(true); setError(null);
    try { await onAdd(review); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'This account could not be added. Please try again.'); }
    finally { submissionInProgress.current = false; if (alive.current) setSubmitting(false); }
  };
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.formNavigation}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={submitting} onPress={back} hitSlop={8} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Icon name="arrow-left" size={22} color={colors.text} /></Pressable>
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
          <View style={styles.networkChoices}>{WATCH_CHOICES.map((choice) => <Pressable key={choice.id} accessibilityRole="button" accessibilityLabel={choice.title}
            accessibilityState={{ selected: network === choice.id, disabled: !availableNetworks.includes(choice.id) }} disabled={!availableNetworks.includes(choice.id) || submitting}
            onPress={() => { setNetwork(choice.id); setAddress(''); setReview(null); setError(null); }}
            style={[styles.networkChoice, network === choice.id && styles.networkChoiceSelected, !availableNetworks.includes(choice.id) && styles.disabled]}>
            <Text style={styles.networkChoiceTitle}>{choice.title}</Text>{!availableNetworks.includes(choice.id) && <Text style={styles.fieldHint}>Not available yet</Text>}
          </Pressable>)}</View>
        </View>
        <View style={styles.fieldGroup}><Text style={styles.fieldLabel}>Account name</Text>
          <TextInput accessibilityLabel="Account name" autoCapitalize="words" autoComplete="off" autoCorrect={false} editable={!submitting} importantForAutofill="no" maxLength={40}
            onChangeText={(value) => { setName(value); setError(null); }} onSubmitEditing={() => addressInput.current?.focus()} placeholder={`e.g. My ${info.shortName} address`}
            placeholderTextColor={colors.muted} returnKeyType="next" selectionColor={colors.pink} style={styles.input} textContentType="none" value={name} />
        </View>
        <View style={styles.fieldGroup}><Text style={styles.fieldLabel}>{info.inputLabel}</Text>
          <TextInput ref={addressInput} accessibilityLabel={info.inputLabel} accessibilityHint={`Paste public information for ${info.title}. Never enter a recovery phrase or private key.`}
            autoCapitalize="none" autoComplete="off" autoCorrect={false} editable={!submitting} importantForAutofill="no" maxLength={network === 'evm' ? 256 : 4096}
            onChangeText={(value) => { setAddress(value); setError(null); }} onSubmitEditing={prepare} placeholder={`${info.prefix}…`} placeholderTextColor={colors.muted}
            returnKeyType="done" selectionColor={colors.pink} spellCheck={false} style={[styles.input, styles.addressInput]} textContentType="none" value={address} />
          <Text style={styles.fieldHint}>{info.scope}</Text>
        </View>
      </View>}
      {error && <View accessibilityLiveRegion="polite" style={styles.errorCard}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text></View>}
      <View style={styles.formFooter}><Pressable accessibilityRole="button" accessibilityState={{ disabled: submitting, busy: submitting }} disabled={submitting}
        onPress={() => review ? void confirm() : prepare()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, submitting && styles.disabled]}>
        {submitting ? <ActivityIndicator color={colors.bg} /> : <Icon name={review ? 'plus' : 'eye'} size={21} color={colors.bg} />}
        <Text style={styles.primaryButtonText}>{submitting ? 'Adding account…' : review ? 'Confirm watch account' : 'Review account'}</Text>
      </Pressable><Text style={styles.footerNote}>Use public information only. Never enter a recovery phrase or private key.</Text></View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  networkChoices: { gap: 8 },
  networkChoice: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, gap: 4 },
  networkChoiceSelected: { borderColor: colors.blue, backgroundColor: colors.surface },
  networkChoiceTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  reviewText: { color: colors.text, fontSize: 17, lineHeight: 26 },
  reviewAddress: { color: colors.text, fontSize: 16, lineHeight: 26, flexShrink: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  welcomeContent: {
    flexGrow: 1,
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 20,
  },
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
  welcomeActions: { marginTop: 'auto', gap: 10, paddingTop: 8 },
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
    borderColor: colors.border,
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
  formIntro: { paddingTop: 25, paddingBottom: 31 },
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
  fields: { gap: 24 },
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
  formFooter: { marginTop: 'auto', paddingTop: 32, gap: 15 },
  footerNote: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
});
