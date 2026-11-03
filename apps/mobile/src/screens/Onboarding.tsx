import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
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

type WelcomeProps = {
  onPreview: () => void;
  onDesign?: () => void;
  onWatch: () => void;
  onWallet?: () => void;
};

type AddWatchAccountProps = {
  onAdd: (account: { name: string; address: string }) => Promise<void>;
  onCancel: () => void;
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
          accessibilityHint="Add a public EVM address to view its balance"
          onPress={onWatch}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>Watch an address</Text>
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

export function AddWatchAccount({ onAdd, onCancel }: AddWatchAccountProps) {
  const [name, setName] = useState('Account 1');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const addressInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const submissionInProgress = useRef(false);

  const submit = async () => {
    if (submissionInProgress.current) return;
    const trimmedName = name.trim();
    const trimmedAddress = address.trim();
    if (!trimmedName) {
      setError('Give this account a name so you can recognize it.');
      return;
    }
    if (!trimmedAddress) {
      setError('Enter the public address you want to watch.');
      addressInput.current?.focus();
      return;
    }
    submissionInProgress.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // The wallet service validates address syntax, checksum and duplicates.
      // This form never derives keys or treats client validation as authority.
      await onAdd({ name: trimmedName, address: trimmedAddress });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'This account could not be added. Please try again.'
      );
    } finally {
      submissionInProgress.current = false;
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.formNavigation}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            disabled={submitting}
            onPress={onCancel}
            hitSlop={8}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressed,
            ]}
          >
            <Icon name="arrow-left" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.navigationLabel}>ADD ACCOUNT</Text>
          <View style={styles.navigationBalance} />
        </View>

        <View style={styles.formIntro}>
          <View style={styles.largeEye}>
            <Icon name="eye" size={30} color={colors.blue} />
          </View>
          <Text accessibilityRole="header" style={styles.formTitle}>
            Watch an address
          </Text>
          <Text style={styles.formDescription}>
            Keep an eye on your balance, without connecting your wallet.
          </Text>
        </View>

        <View style={styles.fields}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Account name</Text>
            <TextInput
              accessibilityLabel="Account name"
              autoCapitalize="words"
              autoComplete="off"
              autoCorrect={false}
              editable={!submitting}
              importantForAutofill="no"
              maxLength={40}
              onChangeText={(value) => {
                setName(value);
                setError(null);
              }}
              onSubmitEditing={() => addressInput.current?.focus()}
              placeholder="e.g. My Ethereum account"
              placeholderTextColor={colors.muted}
              returnKeyType="next"
              selectionColor={colors.pink}
              style={styles.input}
              textContentType="none"
              value={name}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Public EVM address</Text>
            <TextInput
              ref={addressInput}
              accessibilityLabel="Public EVM address"
              accessibilityHint="Paste a public address beginning with 0x. Never enter a recovery phrase or private key."
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              editable={!submitting}
              importantForAutofill="no"
              maxLength={256}
              onChangeText={(value) => {
                setAddress(value);
                setError(null);
              }}
              onSubmitEditing={() => void submit()}
              placeholder="0x…"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              selectionColor={colors.pink}
              spellCheck={false}
              style={[styles.input, styles.addressInput]}
              textContentType="none"
              value={address}
            />
            <Text style={styles.fieldHint}>
              Ethereum and compatible networks. Paste only a public address.
            </Text>
          </View>
        </View>

        <View style={styles.safetyCard}>
          <Icon name="shield" size={21} color={colors.green} />
          <View style={styles.safetyCopy}>
            <Text style={styles.safetyTitle}>Your keys are not needed</Text>
            <Text style={styles.safetyDescription}>
              Balance lookups share this public address and your IP address with
              the selected network provider. This app cannot spend funds or
              recover a wallet. Never enter a recovery phrase or private key.
            </Text>
          </View>
        </View>

        {error ? (
          <View accessibilityLiveRegion="polite" style={styles.errorCard}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
          </View>
        ) : null}

        <View style={styles.formFooter}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting, busy: submitting }}
            disabled={submitting}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              submitting && styles.disabled,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Icon name="plus" size={21} color={colors.bg} />
            )}
            <Text style={styles.primaryButtonText}>
              {submitting ? 'Adding account…' : 'Add watch-only account'}
            </Text>
          </Pressable>
          <Text style={styles.footerNote}>
            Public addresses and their transactions are visible on the
            blockchain.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
