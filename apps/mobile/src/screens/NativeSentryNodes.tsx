import { nativeI18n, useNativeTranslation } from '../platform/localization';
import { SENTRY_NETWORKS } from '../../../../source/shared/sentryNetworks';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  NativeSentryNodeManagement,
  SentryNodeLinkReview,
} from '../custody/sentryNodeManagement';
import type { SentryCollateralReservation } from '../../../../source/wallet/sentryCollateral';
import { Button, Card, colors, Header, Screen, Text } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';
const t = nativeI18n.t.bind(nativeI18n);

type Snapshot = Awaited<ReturnType<NativeSentryNodeManagement['list']>>;
type Step =
  | { kind: 'list' }
  | { kind: 'draft' }
  | { kind: 'link'; review: SentryNodeLinkReview }
  | { kind: 'release'; reservation: SentryCollateralReservation };
type Owner = {
  lifetime: AbortController;
  busy: boolean;
  step: Step;
  manager?: NativeSentryNodeManagement;
  authentication: NativePrivateAuthenticationScope;
};
type Props = {
  networkLabel: string;
  open(
    signal: AbortSignal,
    assertCurrent: () => void,
    authentication: NativePrivateAuthenticationScope
  ): Promise<NativeSentryNodeManagement>;
  onBack(): void;
};
const outpoint = ({ txid, vout }: SentryCollateralReservation) =>
  `${txid}:${vout}`;

export function NativeSentryNodes({ networkLabel, open, onBack }: Props) {
  useNativeTranslation();
  const ownerRef = useRef<Owner | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [notice, setNotice] = useState<string>();
  const current = useCallback(
    (owner: Owner) =>
      ownerRef.current === owner &&
      !owner.lifetime.signal.aborted &&
      (AppState.currentState === 'active' || allowsPrivateAuthenticationInterruption(owner.authentication, AppState.currentState)),
    []
  );
  const clear = useCallback(() => {
    setAcknowledged(false);
    Keyboard.dismiss();
  }, []);
  const retire = useCallback((owner: Owner) => {
    if (ownerRef.current !== owner) return;
    ownerRef.current = null;
    owner.authentication.retire();
    owner.lifetime.abort();
    owner.manager?.dispose();
  }, []);
  const navigate = useCallback((owner: Owner, next: Step) => {
    owner.step = next;
    setNotice(undefined);
    setStep(next);
  }, []);
  const run = useCallback(
    async (
      action: (owner: Owner, check: () => void) => Promise<void>,
      expected: Step
    ) => {
      const owner = ownerRef.current;
      if (!owner || owner.busy || owner.step !== expected || !current(owner) || AppState.currentState !== 'active')
        return;
      owner.busy = true;
      setBusy(true);
      setNotice(undefined);
      const check = () => {
        if (!current(owner) || owner.step !== expected)
          throw new Error('CANCELLED');
      };
      try {
        await action(owner, check);
      } catch {
        if (ownerRef.current === owner && !owner.lifetime.signal.aborted && owner.step === expected) {
          if (expected.kind === 'link')
            owner.manager?.cancelLink(expected.review.id);
          clear();
          navigate(owner, { kind: 'list' });
          setNotice(
            t("mobile.sentryViews.couldNotCompleteTheActionRefreshYourNodesOrStartANewReviewCheckServiceSettingsIfTheProblemContinues")
          );
        }
      } finally {
        owner.busy = false;
        if (ownerRef.current === owner && !owner.lifetime.signal.aborted) setBusy(false);
      }
    },
    [clear, current, navigate]
  );
  const load = useCallback(
    (owner: Owner, check: () => void) => {
      return (async () => {
        if (!owner.manager) {
          const manager = await open(owner.lifetime.signal, () => {
            if (!current(owner)) throw new Error('CANCELLED');
          }, owner.authentication);
          if (!current(owner)) {
            manager.dispose();
            check();
          }
          owner.manager = manager;
        }
        const next = await owner.manager.list();
        check();
        if (AppState.currentState !== 'active') throw new Error('CANCELLED');
        setSnapshot(next);
      })();
    },
    [current, open]
  );
  useLayoutEffect(() => {
    const owner: Owner = {
      lifetime: new AbortController(),
      authentication: createNativePrivateAuthenticationScope(),
      busy: false,
      step: { kind: 'list' },
    };
    ownerRef.current = owner;
    queueMicrotask(() => {
      if (!current(owner)) return;
      setStep(owner.step);
      void run(load, owner.step);
    });
    const suspend = () => {
      const active = ownerRef.current;
      if (active) retire(active);
      clear();
      setRegistration('');
      setSnapshot(null);
      setBusy(false);
      onBack();
    };
    const state = AppState.addEventListener('change', (value) => {
      const active = ownerRef.current;
      if (value !== 'active' && (!active || !allowsPrivateAuthenticationInterruption(active.authentication, value))) suspend();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => {
          const active = ownerRef.current;
          if (!active || !allowsPrivateAuthenticationInterruption(active.authentication, 'blur')) suspend();
        })
        : undefined;
    return () => {
      state.remove();
      blur?.remove();
      const active = ownerRef.current;
      if (active) retire(active);
    };
  }, [clear, current, load, onBack, retire, run]);
  const back = useCallback(() => {
    clear();
    setRegistration('');
    const owner = ownerRef.current;
    if (step.kind !== 'list' && !owner?.busy) {
      if (owner) retire(owner);
      const next: Owner = {
        lifetime: new AbortController(),
        authentication: createNativePrivateAuthenticationScope(),
        busy: false,
        step: { kind: 'list' },
      };
      ownerRef.current = next;
      setStep(next.step);
      setNotice(undefined);
      void run(load, next.step);
      return;
    }
    if (owner) retire(owner);
    onBack();
  }, [clear, load, onBack, retire, run, step]);
  useLayoutEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => listener.remove();
  }, [back]);
  const refreshed = async (
    owner: Owner,
    check: () => void,
    message: string
  ) => {
    await load(owner, check);
    clear();
    setRegistration('');
    navigate(owner, { kind: 'list' });
    setNotice(message);
  };
  return (
    <SafeAreaView edges={['top']} style={s.root}>
      <KeyboardAvoidingView
        style={s.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen scrollResetKey={step.kind}>
          <Header
            title={
              step.kind === 'link'
                ? t("sentry.linkNode")
                : step.kind === 'release'
                ? t("mobile.sentryViews.releaseCollateral")
                : t("mobile.sentryViews.linkedNodes")
            }
            subtitle={networkLabel}
            onBack={back}
          />
          {!!notice && (
            <Text accessibilityRole="alert" style={s.notice}>
              {notice}
            </Text>
          )}
          {step.kind === 'list' && (
            <>
              {busy && !snapshot && (
                <Text accessibilityLiveRegion="polite" style={s.muted}>
                  {t("mobile.sentryViews.loadingNodes")}</Text>
              )}
              {snapshot &&
                !snapshot.linkedNodes.length &&
                !snapshot.collateral.length && (
                  <Card style={s.card}>
                    <Text style={s.heading}>{t("mobile.sentryViews.yourNodesTogether")}</Text>
                    <Text style={s.muted}>
                      {t("mobile.sentryViews.linkARegisteredSentryNodeToSaveItsPublicIdentityAndProtectItsCollateralFromOrdinaryWalletSends")}</Text>
                  </Card>
                )}
              {snapshot?.linkedNodes.map((node) => {
                const reservation = snapshot.collateral.find(
                  (item) => outpoint(item) === outpoint(node.collateralOutpoint)
                );
                return (
                  <Card key={node.proTxHash}>
                    <Text style={s.heading}>
                      {node.service || t("sentry.registeredNode")}
                    </Text>
                    <Text selectable style={s.identifier}>
                      {node.proTxHash}
                    </Text>
                    <Text style={s.muted}>
                      {reservation
                        ? t("mobile.sentryViews.collateralProtected")
                        : t("mobile.sentryViews.collateralProtectionReleased")}
                    </Text>
                    <Text selectable style={s.identifier}>
                      {outpoint(node.collateralOutpoint)}
                    </Text>
                    {reservation && (
                      <Button icon="shield"
                        title={t("mobile.sentryViews.releaseCollateral")}
                        variant="secondary" size="compact"
                        disabled={busy}
                        onPress={() => {
                          clear();
                          const owner = ownerRef.current;
                          if (owner && !owner.busy)
                            navigate(owner, { kind: 'release', reservation });
                        }}
                      />
                    )}
                  </Card>
                );
              })}
              {snapshot?.collateral
                .filter(
                  (item) =>
                    !snapshot.linkedNodes.some(
                      (node) =>
                        outpoint(node.collateralOutpoint) === outpoint(item)
                    )
                )
                .map((reservation) => (
                  <Card key={outpoint(reservation)}>
                    <Text style={s.heading}>{t("sentry.protectedCollateral")}</Text>
                    <Text selectable style={s.identifier}>
                      {outpoint(reservation)}
                    </Text>
                    <Button icon="shield"
                      title={t("mobile.sentryViews.releaseCollateral")}
                      variant="secondary" size="compact"
                      disabled={busy}
                      onPress={() => {
                        clear();
                        const owner = ownerRef.current;
                        if (owner && !owner.busy)
                          navigate(owner, { kind: 'release', reservation });
                      }}
                    />
                  </Card>
                ))}
              <Button icon="plus"
                title={t("mobile.sentryViews.linkANode")}
                disabled={busy || !snapshot}
                onPress={() => {
                  clear();
                  setNotice(undefined);
                  const owner = ownerRef.current;
                  if (owner && !owner.busy) navigate(owner, { kind: 'draft' });
                }}
              />
              <Button icon="refresh"
                title={t("mobile.infrastructure.refresh")}
                variant="secondary" size="compact"
                disabled={busy}
                onPress={() => void run(load, step)}
              />
            </>
          )}
          {step.kind === 'draft' && (
            <>
              <Card style={s.card}>
                <Text style={s.heading}>{t("mobile.sentryViews.nodeRegistration")}</Text>
                <Text style={s.muted}>
                  {t("mobile.sentryViews.enterTheRegistrationTransactionIdPaliChecksItWithYourConfiguredSentryService")}</Text>
              </Card>
              <IdleTextInput
                accessibilityLabel={t("mobile.sentryViews.registrationTransactionId")}
                value={registration}
                onChangeText={setRegistration}
                maxLength={64}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                editable={!busy}
                style={s.input}
              />
              <Button
                title={busy ? t("privacy.checking") : t("mobile.sentryViews.reviewNode")}
                disabled={busy || !registration.trim()}
                onPress={() => {
                  const value = registration.trim();
                  Keyboard.dismiss();
                  void run(async (owner, check) => {
                    if (!snapshot) throw new Error('CANCELLED');
                    const review = await owner.manager!.prepareLink({ version: 1, proTxHash: value, genesisHash: SENTRY_NETWORKS[snapshot.network].genesisHash }, 'Pali Wallet');
                    check();
                    navigate(owner, { kind: 'link', review });
                  }, step);
                }}
              />
            </>
          )}
          {step.kind === 'link' && (
            <>
              <Card style={s.card}>
                <Text style={s.heading}>{t("sentry.linkThisSentryNode")}</Text>
                <Text style={s.muted}>
                  {t("mobile.sentryViews.linkingSavesThisNodeSPublicIdentityAndProtectsItsCollateralFromOrdinaryWalletSends")}</Text>
                <Text style={s.label}>{t("mobile.sentryViews.trustedSource")}</Text>
                <Text selectable style={s.identifier}>
                  {step.review.serviceUrl}
                </Text>
                <Text style={s.label}>{t("sentry.registeredNode")}</Text>
                <Text selectable style={s.identifier}>
                  {step.review.node.proTxHash}
                </Text>
                <Text style={s.label}>{t("sentry.service")}</Text>
                <Text selectable style={s.identifier}>
                  {step.review.node.service || t("sentry.notRegistered")}
                </Text>
                <Text style={s.label}>{t("sentry.nEVMAddress")}</Text>
                <Text selectable style={s.identifier}>
                  {step.review.node.nevmAddress || t("sentry.notRegistered")}
                </Text>
                <Text style={s.label}>{t("sentry.collateralOutpoint")}</Text>
                <Text selectable style={s.identifier}>
                  {outpoint(step.review.node.collateralOutpoint)}
                </Text>
              </Card>
              <Button
                title={busy ? t("mobile.sentryViews.linking") : t("sentry.linkNode")}
                disabled={busy}
                onPress={() => {
                  const review = step.review;
                  void run(async (owner, check) => {
                    await owner.manager!.confirmLink(review);
                    check();
                    await refreshed(
                      owner,
                      check,
                      t("mobile.sentryViews.nodeLinkedCollateralIsProtected")
                    );
                  }, step);
                }}
              />
            </>
          )}
          {step.kind === 'release' && (
            <>
              <Card style={s.card}>
                <Text style={s.heading}>
                  {t("mobile.sentryViews.allowThisCollateralToBeSpent")}</Text>
                <Text style={s.muted}>
                  {t("mobile.sentryViews.spendingThisOutputStopsTheSentryNodeReleasingProtectionDoesNotSendATransactionOrRemoveSavedAuthorityKeys")}</Text>
                <Text selectable style={s.identifier}>
                  {outpoint(step.reservation)}
                </Text>
              </Card>
              <View style={s.consent}>
                <Text style={s.consentText}>
                  {t("mobile.sentryViews.iIntendToStopThisNodeAndAllowItsCollateralToBeSpent")}</Text>
                <Switch
                  accessibilityLabel={t("mobile.sentryViews.allowCollateralSpending")}
                  value={acknowledged}
                  onValueChange={setAcknowledged}
                  disabled={busy}
                />
              </View>
              <Button
                title={busy ? t("mobile.sentryViews.releasing") : t("mobile.sentryViews.releaseCollateral")}
                variant="danger"
                disabled={busy || !acknowledged}
                onPress={() => {
                  const reservation = step.reservation;
                  clear();
                  void run(async (owner, check) => {
                    await owner.manager!.releaseCollateral({
                      reservation,
                      acknowledgeNodeStops: true,
                    });
                    check();
                    await refreshed(
                      owner,
                      check,
                      t("mobile.sentryViews.collateralProtectionReleasedNotice")
                    );
                  }, step);
                }}
              />
            </>
          )}
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  card: { padding: 16, gap: 10 },
  heading: { fontSize: 18, fontWeight: '700' },
  muted: { color: colors.muted, lineHeight: 22 },
  notice: { color: colors.blue, lineHeight: 22 },
  label: { color: colors.muted, fontSize: 13, marginTop: 8 },
  identifier: { fontSize: 13, lineHeight: 20, flexShrink: 1 },
  input: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    minHeight: 56,
    fontSize: 16,
  },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  consentText: { flex: 1, lineHeight: 22 },
});
