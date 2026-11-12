import { useNativeTranslation } from '../platform/localization';
import type { NativeLedgerConnectionView } from '../custody/ledgerAccounts';
import { getAddress } from 'ethers/address';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getGuardianRecoveryDelayOptions,
  SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS,
} from '../../../../source/utils/smartAccount/guardianPolicy';
import type { GuardianRemovalInspection } from '../../../../source/wallet/guardianRemoval';
import type { NativeGuardianRecoveryStatus } from '../custody/evmTransferReadRpc';
import type {
  NativeGuardianPolicyDraft,
  NativeSmartAccountOperation,
} from '../smartAccount/operation';
import { Button, Card, colors, Header, Notice, Screen, Text } from '../ui';
import { IdlePressable } from './IdleActivityBoundary';
import { NativeSendInput } from './NativeSend';
import { NativeSmartAccountOperationScreen } from './NativeSmartAccountOperation';
import { guardianDelayLabel } from './guardianPolicyLabels';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../custody/privateAuthentication';
import { allowsPrivateAuthenticationInterruption } from './privateAuthenticationLifecycle';

export type NativeGuardianPolicyTool = {
  ledgerConnection?: NativeLedgerConnectionView;
  chainId: number;
  inspectRemoval(
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<GuardianRemovalInspection>;
  open(
    draft: NativeGuardianPolicyDraft,
    signal: AbortSignal,
    assertCurrent: () => void,
    authentication: NativePrivateAuthenticationScope
  ): Promise<NativeSmartAccountOperation>;
};

type Observation = Extract<
  NativeGuardianRecoveryStatus,
  { status: 'observed' }
>['observation'];

type PolicyOwner = {
  live: boolean;
  returning: boolean;
  busy: boolean;
  abort: AbortController;
  authentication: NativePrivateAuthenticationScope | null;
  operation: NativeSmartAccountOperation | null;
  opening?: Promise<void>;
  disposing?: Promise<void>;
};
function disposePolicy(owner: PolicyOwner): Promise<void> {
  owner.disposing ??= Promise.resolve(owner.opening)
    .catch(() => undefined)
    .then(() => owner.operation?.dispose());
  return owner.disposing;
}

export function NativeGuardianPolicy({
  action,
  address,
  networkLabel,
  observation,
  manage,
  lifetime,
  onBack,
  registerBack,
}: {
  action: 'set' | 'remove';
  address: string;
  networkLabel: string;
  observation: Observation;
  manage: NativeGuardianPolicyTool;
  lifetime: AbortSignal;
  onBack(): void;
  registerBack?(handler: () => void): () => void;
}) {
  const { t } = useNativeTranslation();
  const [port] = useState(manage);
  const [inspection, setInspection] =
    useState<GuardianRemovalInspection | null>(null);
  const [recoveryLossAcknowledged, setRecoveryLossAcknowledged] =
    useState(false);
  const choices = getGuardianRecoveryDelayOptions(port.chainId);
  const initialDelay =
    observation.exists && choices.includes(observation.delaySeconds)
      ? observation.delaySeconds
      : SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS;
  const [guardian, setGuardian] = useState(observation.guardians[0] ?? '');
  const [delay, setDelay] = useState(initialDelay);
  const [acknowledgedId, setAcknowledgedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] =
    useState<NativeSmartAccountOperation | null>(null);
  const [operationAuthentication, setOperationAuthentication] = useState<NativePrivateAuthenticationScope>();
  const [closing, setClosing] = useState(false);
  const callbacks = useRef({ onBack });
  useLayoutEffect(() => {
    callbacks.current = { onBack };
  }, [onBack]);
  const owner = useRef<PolicyOwner>({
    live: false,
    returning: false,
    busy: false,
    abort: new AbortController(),
    authentication: null,
    operation: null,
  });
  const back = useCallback(() => {
    const current = owner.current;
    if (!current.live) return;
    current.live = false;
    current.authentication?.retire();
    current.returning = true;
    current.abort.abort();
    const close = callbacks.current.onBack;
    setClosing(true);
    void disposePolicy(current)
      .catch(() => undefined)
      .then(() => {
        if (owner.current === current && current.returning) close();
      });
  }, []);
  useLayoutEffect(() => registerBack?.(back), [registerBack, back]);
  useLayoutEffect(() => {
    const current: PolicyOwner = {
      live: !lifetime.aborted,
      returning: false,
      busy: false,
      abort: new AbortController(),
      authentication: createNativePrivateAuthenticationScope(),
      operation: null,
    };
    owner.current = current;
    const retire = () => {
      current.live = false;
      current.authentication?.retire();
      current.returning = false;
      current.abort.abort();
      void disposePolicy(current).catch(() => undefined);
    };
    lifetime.addEventListener('abort', retire, { once: true });
    if (lifetime.aborted) retire();
    const change = AppState.addEventListener('change', state => { if (state !== 'active' && !(current.authentication && allowsPrivateAuthenticationInterruption(current.authentication, state))) back(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => { if (!(current.authentication && allowsPrivateAuthenticationInterruption(current.authentication, 'blur'))) back(); }) : undefined;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => {
      lifetime.removeEventListener('abort', retire);
      retire();
      change.remove(); blur?.remove();
      hardware.remove();
    };
  }, [back, lifetime]);
  const inspect = useCallback(async () => {
    const current = owner.current;
    if (!current.live || current.busy || AppState.currentState !== 'active') return;
    current.busy = true;
    setBusy(true);
    const check = () => {
      if (
        owner.current !== current ||
        !current.live ||
        current.abort.signal.aborted ||
        lifetime.aborted
      )
        throw new Error('CANCELLED');
    };
    try {
      current.opening = port
        .inspectRemoval(current.abort.signal, check)
        .then((next) => {
          check();
          setInspection(next);
        });
      await current.opening;
    } catch {
      if (current.live)
        setInspection({ status: 'unknown', transactions: [], totalPending: 0 });
    } finally {
      current.busy = false;
      if (current.live) setBusy(false);
    }
  }, [port, lifetime]);
  useEffect(() => {
    if (action === 'remove') void inspect();
  }, [action, inspect]);
  const pendingId = observation.pending?.operationId ?? null;
  const acknowledged = pendingId === null || acknowledgedId === pendingId;
  const review = async () => {
    const current = owner.current;
    if (!current.live || current.busy || !current.authentication || AppState.currentState !== 'active' || !acknowledged) return;
    let draft: NativeGuardianPolicyDraft;
    if (action === 'remove') {
      if (inspection?.status !== 'retry-ready' || !recoveryLossAcknowledged)
        return;
      draft = {
        action: 'remove',
        acknowledgedPendingOperationId: pendingId,
        recoveryLossAcknowledged: true,
      };
    } else {
      try {
        const normalized = getAddress(guardian.trim());
        if (/^0x0{40}$/i.test(normalized)) throw new Error('Zero address');
        draft = {
          action: 'set',
          guardian: normalized,
          delaySeconds: delay,
          acknowledgedPendingOperationId: pendingId,
        };
      } catch {
        setError(t('mobile.recoveryDevices.guardianPolicy.enterAValidGuardianAddress'));
        return;
      }
    }
    current.busy = true;
    setBusy(true);
    setError('');
    const check = () => {
      if (
        owner.current !== current ||
        !current.live ||
        current.abort.signal.aborted ||
        lifetime.aborted ||
        (AppState.currentState !== 'active' && !allowsPrivateAuthenticationInterruption(current.authentication!, AppState.currentState))
      )
        throw new Error('CANCELLED');
    };
    try {
      current.opening = port
        .open(draft, current.abort.signal, check, current.authentication)
        .then((next) => {
          current.operation = next;
          if (current.live) {
            check();
            setOperationAuthentication(current.authentication!);
            setOperation(next);
          }
        });
      await current.opening;
    } catch {
      if (current.live)
        setError(
          t('mobile.recoveryDevices.guardianPolicy.thePolicyCouldNotBePreparedReturn')
        );
    } finally {
      current.busy = false;
      if (current.live) setBusy(false);
    }
  };
  if (closing)
    return (
      <SafeAreaView style={s.safe}>
        <Screen>
          <Text>{t('mobile.recoveryDevices.guardianPolicy.closingGuardianReview')}</Text>
        </Screen>
      </SafeAreaView>
    );
  if (operation)
    return (
      <NativeSmartAccountOperationScreen authentication={operationAuthentication} ledgerConnection={port.ledgerConnection} controller={operation} onBack={back} />
    );
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={s.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen footer={<>
          {(action === 'set' || inspection?.status === 'retry-ready') && (
            <Button
              title={
                busy
                  ? t('mobile.recoveryDevices.guardianPolicy.preparingPolicy')
                  : action === 'remove'
                  ? t('mobile.recoveryDevices.guardianPolicy.reviewRemoval')
                  : t('mobile.recoveryDevices.guardianPolicy.reviewPolicy')
              }
              disabled={
                busy ||
                !acknowledged ||
                (action === 'remove' && !recoveryLossAcknowledged)
              }
              onPress={() => {
                void review();
              }}
            />
          )}
          <Button title={t('buttons.cancel')} variant="secondary" size="compact" onPress={back} />
        </>}>
          <Header
            title={
              action === 'remove'
                ? t('mobile.recoveryDevices.guardianPolicy.removeGuardian')
                : observation.exists
                ? t('mobile.recoveryDevices.guardianPolicy.updateGuardian')
                : t('mobile.recoveryDevices.guardianPolicy.setGuardian')
            }
            subtitle={networkLabel}
            onBack={back}
          />
          <Card style={s.card}>
            <Text style={s.label}>{t('mobile.recoveryDevices.guardianPolicy.chain', { chainId: port.chainId })}</Text>
            <Text selectable style={s.address}>
              {address}
            </Text>
            {action === 'remove' && (
              <>
                <Text style={s.label}>{t('mobile.recoveryDevices.guardianPolicy.currentRecoveryModule')}</Text>
                <Text selectable style={s.address}>
                  {observation.moduleAddress}
                </Text>
              </>
            )}
            {observation.exists && (
              <Text style={s.label}>
                {t('mobile.recoveryDevices.guardianPolicy.currentPolicy', { count: observation.guardians.length, threshold: observation.threshold })}
              </Text>
            )}
          </Card>
          {action === 'set' ? (
            <>
              <NativeSendInput
                label={t('mobile.recoveryDevices.guardianPolicy.guardianAddress')}
                value={guardian}
                onChange={(value) => {
                  setGuardian(value);
                  setError('');
                }}
                busy={busy}
                max={42}
                placeholder="0x…"
              />
              <Text style={s.label}>{t('mobile.recoveryDevices.guardianPolicy.recoveryDelay')}</Text>
              <View style={s.choices}>
                {choices.map((seconds) => (
                  <IdlePressable
                    key={seconds}
                    accessibilityRole="radio"
                    aria-checked={delay === seconds}
                    accessibilityLabel={guardianDelayLabel(seconds, t)}
                    accessibilityState={{
                      checked: delay === seconds,
                      disabled: busy,
                    }}
                    disabled={busy}
                    onPress={() => {
                      setDelay(seconds);
                      setError('');
                    }}
                    style={[s.choice, delay === seconds && s.selected]}
                  >
                    <Text>{guardianDelayLabel(seconds, t)}</Text>
                  </IdlePressable>
                ))}
              </View>
              <Text style={s.body}>
                {t('mobile.recoveryDevices.guardianPolicy.timing', { delay: guardianDelayLabel(delay, t), window: guardianDelayLabel(delay * 2, t) })}
              </Text>
            </>
          ) : (
            <>
              <Notice
                title={t('mobile.recoveryDevices.guardianPolicy.guardianRecoveryWillBeRemoved')}
                body={t('mobile.recoveryDevices.guardianPolicy.removingTheGuardianDisablesThisAccountS')}
                tone="amber"
              />
              {!inspection && (
                <Text style={s.body}>{t('mobile.recoveryDevices.guardianPolicy.checkingPreviousRemovalAttempts')}</Text>
              )}
              {inspection?.status === 'pending' && (
                <Notice
                  title={t('mobile.recoveryDevices.guardianPolicy.removalAwaitingANetworkResult')}
                  body={t('mobile.recoveryDevices.guardianPolicy.checkTheSavedAttemptBeforePreparingAnother')}
                />
              )}
              {inspection?.status === 'unknown' && (
                <Notice
                  title={t('mobile.recoveryDevices.guardianPolicy.removalStatusUnavailable')}
                  body={t('mobile.recoveryDevices.guardianPolicy.checkAgainBeforePreparingARemoval')}
                  tone="amber"
                />
              )}
              {inspection?.status === 'removed' && (
                <Notice
                  title={t('mobile.recoveryDevices.guardianPolicy.guardianRecoveryIsAlreadyRemoved')}
                  body={t('mobile.recoveryDevices.guardianPolicy.theCurrentOnChainPolicyHasNo')}
                />
              )}
              {!!inspection?.transactions.length && (
                <Card style={s.card}>
                  <Text style={s.label}>{t('mobile.recoveryDevices.guardianPolicy.savedRemovalTransactions')}</Text>
                  {inspection.transactions.map((transaction, index) => (
                    <Text
                      key={`${transaction.hash}:${index}`}
                      selectable
                      style={s.address}
                    >
                      {transaction.hash}
                    </Text>
                  ))}
                </Card>
              )}
              <Button
                title={busy ? t('mobile.recoveryDevices.guardianPolicy.checkingStatus') : t('settings.smartAccountGuardianRecoveryCheckRemoval')}
                variant="secondary" size="compact" icon="refresh"
                disabled={busy}
                onPress={() => {
                  void inspect();
                }}
              />
              {inspection?.status === 'retry-ready' && (
                <IdlePressable
                  accessibilityRole="checkbox"
                  aria-checked={recoveryLossAcknowledged}
                  accessibilityLabel={t('mobile.recoveryDevices.guardianPolicy.iUnderstandGuardianRecoveryWillBeRemoved')}
                  accessibilityState={{
                    checked: recoveryLossAcknowledged,
                    disabled: busy,
                  }}
                  disabled={busy}
                  onPress={() => setRecoveryLossAcknowledged((value) => !value)}
                  style={s.acknowledgement}
                >
                  <Text>{recoveryLossAcknowledged ? '✓' : '□'}</Text>
                  <Text style={s.acknowledgementText}>
                    {t('mobile.recoveryDevices.guardianPolicy.iUnderstandGuardianRecoveryWillBeRemoved1')}</Text>
                </IdlePressable>
              )}
            </>
          )}
          {pendingId && (
            <Card style={s.card}>
              <Notice
                title={t('mobile.recoveryDevices.guardianPolicy.recoveryAlreadyScheduled')}
                body={
                  action === 'remove'
                    ? t('mobile.recoveryDevices.guardianPolicy.removingGuardianRecoveryInvalidatesThisPendingRecovery')
                    : t('mobile.recoveryDevices.guardianPolicy.updatingTheGuardianPolicyReplacesThePolicy')
                }
                tone="amber"
              />
              <Text style={s.label}>{t('mobile.recoveryDevices.guardianPolicy.recoveryOperation')}</Text>
              <Text selectable style={s.address}>
                {pendingId}
              </Text>
              <IdlePressable
                accessibilityRole="checkbox"
                aria-checked={acknowledged}
                accessibilityLabel={t('mobile.recoveryDevices.guardianPolicy.iUnderstandThisChangesThePendingRecovery')}
                accessibilityState={{ checked: acknowledged, disabled: busy }}
                disabled={busy}
                onPress={() =>
                  setAcknowledgedId(acknowledged ? null : pendingId)
                }
                style={s.acknowledgement}
              >
                <Text>{acknowledged ? '✓' : '□'}</Text>
                <Text style={s.acknowledgementText}>
                  {t('mobile.recoveryDevices.guardianPolicy.iUnderstandThisChangesThePendingRecovery2')}</Text>
              </IdlePressable>
            </Card>
          )}
          {!!error && (
            <Notice title={t('mobile.recoveryDevices.guardianPolicy.checkGuardianPolicy')} body={error} tone="amber" />
          )}

        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  card: { padding: 16, gap: 10 },
  label: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  address: { color: colors.text, fontSize: 13, lineHeight: 20 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    minHeight: 48,
    justifyContent: 'center',
  },
  selected: { borderColor: colors.pink, backgroundColor: colors.raised },
  acknowledgement: {
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    alignItems: 'center',
  },
  acknowledgementText: { flex: 1, fontSize: 14, lineHeight: 21 },
});
