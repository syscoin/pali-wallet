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
import { NoteBackupPasswordField } from './NoteBackupPasswordField';

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
};
type Props = {
  networkLabel: string;
  open(
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<NativeSentryNodeManagement>;
  onBack(): void;
};
const outpoint = ({ txid, vout }: SentryCollateralReservation) =>
  `${txid}:${vout}`;

export function NativeSentryNodes({ networkLabel, open, onBack }: Props) {
  const ownerRef = useRef<Owner | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState('');
  const [password, setPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [notice, setNotice] = useState<string>();
  const current = useCallback(
    (owner: Owner) =>
      ownerRef.current === owner &&
      !owner.lifetime.signal.aborted &&
      AppState.currentState === 'active',
    []
  );
  const clear = useCallback(() => {
    setPassword('');
    setAcknowledged(false);
    Keyboard.dismiss();
  }, []);
  const retire = useCallback((owner: Owner) => {
    if (ownerRef.current !== owner) return;
    ownerRef.current = null;
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
      if (!owner || owner.busy || owner.step !== expected || !current(owner))
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
        if (current(owner) && owner.step === expected) {
          if (expected.kind === 'link')
            owner.manager?.cancelLink(expected.review.id);
          clear();
          navigate(owner, { kind: 'list' });
          setNotice(
            'Could not complete the action. Refresh your nodes or start a new review. Check service settings if the problem continues.'
          );
        }
      } finally {
        owner.busy = false;
        if (current(owner)) setBusy(false);
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
          });
          if (!current(owner)) {
            manager.dispose();
            check();
          }
          owner.manager = manager;
        }
        const next = await owner.manager.list();
        check();
        setSnapshot(next);
      })();
    },
    [current, open]
  );
  useLayoutEffect(() => {
    const owner: Owner = {
      lifetime: new AbortController(),
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
      if (value !== 'active') suspend();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', suspend)
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
                ? 'Link node'
                : step.kind === 'release'
                ? 'Release collateral'
                : 'Linked nodes'
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
                  Loading nodes…
                </Text>
              )}
              {snapshot &&
                !snapshot.linkedNodes.length &&
                !snapshot.collateral.length && (
                  <Card style={s.card}>
                    <Text style={s.heading}>Your nodes, together</Text>
                    <Text style={s.muted}>
                      Link a registered Sentry node to save its public identity
                      and protect its collateral from ordinary wallet sends.
                    </Text>
                  </Card>
                )}
              {snapshot?.linkedNodes.map((node) => {
                const reservation = snapshot.collateral.find(
                  (item) => outpoint(item) === outpoint(node.collateralOutpoint)
                );
                return (
                  <Card key={node.proTxHash}>
                    <Text style={s.heading}>
                      {node.service || 'Registered node'}
                    </Text>
                    <Text selectable style={s.identifier}>
                      {node.proTxHash}
                    </Text>
                    <Text style={s.muted}>
                      {reservation
                        ? 'Collateral protected'
                        : 'Collateral protection released'}
                    </Text>
                    <Text selectable style={s.identifier}>
                      {outpoint(node.collateralOutpoint)}
                    </Text>
                    {reservation && (
                      <Button
                        title="Release collateral"
                        variant="quiet" size="compact"
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
                    <Text style={s.heading}>Protected collateral</Text>
                    <Text selectable style={s.identifier}>
                      {outpoint(reservation)}
                    </Text>
                    <Button
                      title="Release collateral"
                      variant="quiet" size="compact"
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
              <Button
                title="Link a node"
                disabled={busy || !snapshot}
                onPress={() => {
                  clear();
                  setNotice(undefined);
                  const owner = ownerRef.current;
                  if (owner && !owner.busy) navigate(owner, { kind: 'draft' });
                }}
              />
              <Button
                title="Refresh"
                variant="secondary" size="compact"
                disabled={busy}
                onPress={() => void run(load, step)}
              />
            </>
          )}
          {step.kind === 'draft' && (
            <>
              <Card style={s.card}>
                <Text style={s.heading}>Node registration</Text>
                <Text style={s.muted}>
                  Enter the registration transaction ID. Pali checks it with
                  your configured Sentry service.
                </Text>
              </Card>
              <IdleTextInput
                accessibilityLabel="Registration transaction ID"
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
                title={busy ? 'Checking…' : 'Review node'}
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
                <Text style={s.heading}>Link this Sentry node?</Text>
                <Text style={s.muted}>
                  Linking saves this node’s public identity and protects its
                  collateral from ordinary wallet sends.
                </Text>
                <Text style={s.label}>Trusted source</Text>
                <Text selectable style={s.identifier}>
                  {step.review.serviceUrl}
                </Text>
                <Text style={s.label}>Registered node</Text>
                <Text selectable style={s.identifier}>
                  {step.review.node.proTxHash}
                </Text>
                <Text style={s.label}>Service</Text>
                <Text selectable style={s.identifier}>
                  {step.review.node.service || 'Not registered'}
                </Text>
                <Text style={s.label}>NEVM address</Text>
                <Text selectable style={s.identifier}>
                  {step.review.node.nevmAddress || 'Not registered'}
                </Text>
                <Text style={s.label}>Collateral outpoint</Text>
                <Text selectable style={s.identifier}>
                  {outpoint(step.review.node.collateralOutpoint)}
                </Text>
              </Card>
              <Button
                title={busy ? 'Linking…' : 'Link node'}
                disabled={busy}
                onPress={() => {
                  const review = step.review;
                  void run(async (owner, check) => {
                    await owner.manager!.confirmLink(review);
                    check();
                    await refreshed(
                      owner,
                      check,
                      'Node linked. Collateral is protected.'
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
                  Allow this collateral to be spent?
                </Text>
                <Text style={s.muted}>
                  Spending this output stops the Sentry node. Releasing
                  protection does not send a transaction or remove saved
                  authority keys.
                </Text>
                <Text selectable style={s.identifier}>
                  {outpoint(step.reservation)}
                </Text>
              </Card>
              <View style={s.consent}>
                <Text style={s.consentText}>
                  I intend to stop this node and allow its collateral to be
                  spent.
                </Text>
                <Switch
                  accessibilityLabel="Allow collateral spending"
                  value={acknowledged}
                  onValueChange={setAcknowledged}
                  disabled={busy}
                />
              </View>
              <NoteBackupPasswordField
                label="Wallet password"
                value={password}
                onChange={setPassword}
                busy={busy}
              />
              <Button
                title={busy ? 'Releasing…' : 'Release collateral'}
                variant="danger"
                disabled={busy || !acknowledged || !password}
                onPress={() => {
                  const entered = password;
                  const reservation = step.reservation;
                  clear();
                  void run(async (owner, check) => {
                    await owner.manager!.releaseCollateral({
                      reservation,
                      password: entered,
                      acknowledgeNodeStops: true,
                    });
                    check();
                    await refreshed(
                      owner,
                      check,
                      'Collateral protection released.'
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
