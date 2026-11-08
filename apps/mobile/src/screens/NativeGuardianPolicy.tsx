import { getAddress } from 'ethers/address';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
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

export type NativeGuardianPolicyTool = {
  chainId: number;
  inspectRemoval(
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<GuardianRemovalInspection>;
  open(
    draft: NativeGuardianPolicyDraft,
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<NativeSmartAccountOperation>;
};

type Observation = Extract<
  NativeGuardianRecoveryStatus,
  { status: 'observed' }
>['observation'];

export function NativeGuardianPolicy({
  action,
  address,
  networkLabel,
  observation,
  manage,
  lifetime,
  onBack,
}: {
  action: 'set' | 'remove';
  address: string;
  networkLabel: string;
  observation: Observation;
  manage: NativeGuardianPolicyTool;
  lifetime: AbortSignal;
  onBack(): void;
}) {
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
  const owner = useRef({
    live: true,
    busy: false,
    operation: null as NativeSmartAccountOperation | null,
  });
  useLayoutEffect(() => {
    const current = owner.current;
    current.live = !lifetime.aborted;
    const retire = () => {
      current.live = false;
      current.operation?.dispose();
    };
    lifetime.addEventListener('abort', retire, { once: true });
    if (lifetime.aborted) retire();
    return () => {
      lifetime.removeEventListener('abort', retire);
      retire();
    };
  }, [lifetime]);
  const inspect = useCallback(async () => {
    const current = owner.current;
    if (!current.live || current.busy) return;
    current.busy = true;
    setBusy(true);
    const check = () => {
      if (!current.live || lifetime.aborted) throw new Error('CANCELLED');
    };
    try {
      const next = await port.inspectRemoval(lifetime, check);
      check();
      setInspection(next);
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
    if (!current.live || current.busy || !acknowledged) return;
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
        setError('Enter a valid guardian address.');
        return;
      }
    }
    current.busy = true;
    setBusy(true);
    setError('');
    const check = () => {
      if (!current.live || lifetime.aborted) throw new Error('CANCELLED');
    };
    try {
      const next = await port.open(draft, lifetime, check);
      if (!current.live || lifetime.aborted) {
        next.dispose();
        return;
      }
      current.operation = next;
      setOperation(next);
    } catch {
      if (current.live)
        setError(
          'The policy could not be prepared. Return to check its current status and try again.'
        );
    } finally {
      current.busy = false;
      if (current.live) setBusy(false);
    }
  };
  if (operation)
    return (
      <NativeSmartAccountOperationScreen
        controller={operation}
        onBack={onBack}
      />
    );
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={s.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Screen>
          <Header
            title={
              action === 'remove'
                ? 'Remove guardian'
                : observation.exists
                ? 'Update guardian'
                : 'Set guardian'
            }
            subtitle={networkLabel}
            onBack={onBack}
          />
          <Card style={s.card}>
            <Text style={s.label}>Smart account · Chain ID {port.chainId}</Text>
            <Text selectable style={s.address}>
              {address}
            </Text>
            {action === 'remove' && (
              <>
                <Text style={s.label}>Current recovery module</Text>
                <Text selectable style={s.address}>
                  {observation.moduleAddress}
                </Text>
              </>
            )}
            {observation.exists && (
              <Text style={s.label}>
                Current policy · {observation.guardians.length}{' '}
                {observation.guardians.length === 1 ? 'guardian' : 'guardians'}{' '}
                · Threshold {observation.threshold}
              </Text>
            )}
          </Card>
          {action === 'set' ? (
            <>
              <NativeSendInput
                label="Guardian address"
                value={guardian}
                onChange={(value) => {
                  setGuardian(value);
                  setError('');
                }}
                busy={busy}
                max={42}
                placeholder="0x…"
              />
              <Text style={s.label}>Recovery delay</Text>
              <View style={s.choices}>
                {choices.map((seconds) => (
                  <IdlePressable
                    key={seconds}
                    accessibilityRole="radio"
                    aria-checked={delay === seconds}
                    accessibilityLabel={guardianDelayLabel(seconds)}
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
                    <Text>{guardianDelayLabel(seconds)}</Text>
                  </IdlePressable>
                ))}
              </View>
              <Text style={s.body}>
                This policy uses one guardian. A recovery request becomes ready
                after {guardianDelayLabel(delay)} and can be finalized for{' '}
                {guardianDelayLabel(delay * 2)} once ready.
              </Text>
            </>
          ) : (
            <>
              <Notice
                title="Guardian recovery will be removed"
                body="Removing the guardian disables this account’s guardian recovery."
                tone="amber"
              />
              {!inspection && (
                <Text style={s.body}>Checking previous removal attempts…</Text>
              )}
              {inspection?.status === 'pending' && (
                <Notice
                  title="Removal awaiting a network result"
                  body="Check the saved attempt before preparing another removal."
                />
              )}
              {inspection?.status === 'unknown' && (
                <Notice
                  title="Removal status unavailable"
                  body="Check again before preparing a removal."
                  tone="amber"
                />
              )}
              {inspection?.status === 'removed' && (
                <Notice
                  title="Guardian recovery is already removed"
                  body="The current on-chain policy has no guardian recovery module."
                />
              )}
              {!!inspection?.transactions.length && (
                <Card style={s.card}>
                  <Text style={s.label}>Saved removal transactions</Text>
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
                title={busy ? 'Checking status…' : 'Check removal status'}
                variant="quiet"
                disabled={busy}
                onPress={() => {
                  void inspect();
                }}
              />
              {inspection?.status === 'retry-ready' && (
                <IdlePressable
                  accessibilityRole="checkbox"
                  aria-checked={recoveryLossAcknowledged}
                  accessibilityLabel="I understand guardian recovery will be removed"
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
                    I understand guardian recovery will be removed.
                  </Text>
                </IdlePressable>
              )}
            </>
          )}
          {pendingId && (
            <Card style={s.card}>
              <Notice
                title="Recovery already scheduled"
                body={
                  action === 'remove'
                    ? 'Removing guardian recovery invalidates this pending recovery request.'
                    : 'Updating the guardian policy replaces the policy used by this pending recovery request.'
                }
                tone="amber"
              />
              <Text style={s.label}>Recovery operation</Text>
              <Text selectable style={s.address}>
                {pendingId}
              </Text>
              <IdlePressable
                accessibilityRole="checkbox"
                aria-checked={acknowledged}
                accessibilityLabel="I understand this changes the pending recovery policy"
                accessibilityState={{ checked: acknowledged, disabled: busy }}
                disabled={busy}
                onPress={() =>
                  setAcknowledgedId(acknowledged ? null : pendingId)
                }
                style={s.acknowledgement}
              >
                <Text>{acknowledged ? '✓' : '□'}</Text>
                <Text style={s.acknowledgementText}>
                  I understand this changes the pending recovery policy.
                </Text>
              </IdlePressable>
            </Card>
          )}
          {!!error && (
            <Notice title="Check guardian policy" body={error} tone="amber" />
          )}
          {(action === 'set' || inspection?.status === 'retry-ready') && (
            <Button
              title={
                busy
                  ? 'Preparing policy…'
                  : action === 'remove'
                  ? 'Review removal'
                  : 'Review policy'
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
          <Button title="Cancel" variant="quiet" onPress={onBack} />
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  card: { padding: 20, gap: 10 },
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
