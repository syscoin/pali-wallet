import React, { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeGuardianRecoveryStatus } from '../custody/evmTransferReadRpc';
import { useNativeTranslation } from '../platform/localization';
import { Button, Card, colors, Header, Screen, Text } from '../ui';
import { NativeGuardianPolicy, type NativeGuardianPolicyTool } from './NativeGuardianPolicy';
import { NativeGuardianRecovery, type NativeGuardianRecoveryTool } from './NativeGuardianRecovery';

export type WatchGuardianRecoveryTool = {
  scope: string;
  address: string;
  manage?: NativeGuardianPolicyTool;
  recovery?: NativeGuardianRecoveryTool;
  read(signal: AbortSignal, assertCurrent: () => void): Promise<NativeGuardianRecoveryStatus>;
};

type State = NativeGuardianRecoveryStatus | { status: 'idle' | 'loading' | 'unavailable' };

const OPERATION_LABELS = {
  pending: 'Recovery scheduled',
  ready: 'Recovery ready to finalize',
  expired: 'Recovery expired',
  executed: 'Recovery completed',
  canceled: 'Recovery canceled',
  inactive: 'Recovery inactive',
  unknown: 'Recovery status unavailable',
} as const;

export function WatchGuardianRecovery({ address, networkLabel, read, manage, recovery, initialRecovery, lifetime, onBack, registerBack }:
  Omit<WatchGuardianRecoveryTool, 'scope'> & { networkLabel: string; lifetime: AbortSignal; initialRecovery?: boolean; onBack(): void; registerBack?(handler: () => void): () => void }) {
  const { t } = useNativeTranslation();
  const [state, setState] = useState<State>({ status: 'idle' });
  const [alertError, setAlertError] = useState(false);
  const [editing, setEditing] = useState<'set' | 'remove' | 'recover' | null>(initialRecovery && recovery?.hasIntent ? 'recover' : null);
  const owner = useRef<AbortController | null>(null);
  const live = useRef(true);
  const cancel = () => { owner.current?.abort(); owner.current = null; };
  useLayoutEffect(() => {
    live.current = true;
    lifetime.addEventListener('abort', cancel, { once: true });
    return () => { live.current = false; lifetime.removeEventListener('abort', cancel); cancel(); };
  }, [lifetime]);
  const check = async () => {
    if (owner.current || lifetime.aborted) return;
    const request = new AbortController();
    owner.current = request;
    const assertCurrent = () => {
      if (owner.current !== request || request.signal.aborted) throw new Error('CANCELLED');
    };
    setState({ status: 'loading' });
    try {
      const result = await read(request.signal, assertCurrent);
      assertCurrent();
      setState(result);
    } catch {
      if (owner.current === request && !request.signal.aborted) setState({ status: 'unavailable' });
    } finally {
      if (owner.current === request) owner.current = null;
    }
  };
  const observation = state.status === 'observed' ? state.observation : undefined;
  const operation = observation?.active;
  const message = state.status === 'unsupported' ? 'Guardian module unsupported'
    : state.status === 'no-compatible-policy' ? 'No compatible guardian policy'
    : state.status === 'unavailable' ? 'Status unavailable'
    : state.status === 'loading' ? 'Checking recovery status…'
    : observation ? !observation.exists ? 'No guardian policy found'
      : operation ? OPERATION_LABELS[operation.status] : 'No recovery scheduled'
    : null;

  if (editing === 'recover' && recovery) {
    return <NativeGuardianRecovery address={address} networkLabel={networkLabel} observation={observation ?? null}
      recovery={recovery} lifetime={lifetime} onBack={onBack} />;
  }
  if (editing && editing !== 'recover' && manage && observation) {
    return <NativeGuardianPolicy key={editing} action={editing} address={address} networkLabel={networkLabel}
      observation={observation} manage={manage} lifetime={lifetime} onBack={onBack} registerBack={registerBack} />;
  }

  return <SafeAreaView edges={['top']} style={styles.container}><Screen>
    <Header title="Guardian recovery" subtitle={networkLabel} onBack={onBack} />
    <Text style={styles.body}>Check the on-chain recovery status for this account.</Text>
    <Card style={styles.card}><Text selectable style={styles.address}>{address}</Text></Card>
    {message && <Card style={styles.card}>
      <Text accessibilityLiveRegion="polite" style={styles.status}>{message}</Text>
      {state.status === 'unsupported' && <Text style={styles.body}>Pali’s guardian module could not be verified on this network.</Text>}
      {state.status === 'no-compatible-policy' && <Text style={styles.body}>This address has no smart account code on this network.</Text>}
      {state.status === 'unavailable' && <Text style={styles.body}>This network did not return a verified status. Try again.</Text>}
      {operation?.status === 'pending' && <Text style={styles.body}>
        Ready {new Date(operation.executableAt * 1000).toLocaleString()}
      </Text>}
      {(operation?.status === 'ready' || operation?.status === 'pending') && <Text style={styles.body}>
        Expires {new Date(operation.expiresAt * 1000).toLocaleString()}
      </Text>}
      {observation && <Text style={styles.body}>
        Checked at block {observation.observedBlock.number.toLocaleString()}
      </Text>}
    </Card>}
    {manage && observation && <Button title={observation.exists ? 'Update guardian' : 'Set guardian'} onPress={() => setEditing('set')} />}
    {manage && observation?.exists && <Button title="Remove guardian" variant="danger" size="compact" icon="trash" onPress={() => setEditing('remove')} />}
    {recovery && (recovery.hasIntent || observation?.exists) && <Button title={recovery.hasIntent ? 'Resume recovery' : 'Recover account'} onPress={() => setEditing('recover')} />}
    {recovery && observation?.exists && <>
      <Button title={t('settings.smartAccountRecoveryEmailAlerts')} variant="secondary" size="compact" icon="external" onPress={() => {
        if (!live.current || lifetime.aborted) return;
        setAlertError(false);
        void recovery.openRecoveryAlerts().catch(() => {
          if (live.current && !lifetime.aborted) setAlertError(true);
        });
      }} />
      <Text style={styles.body}>{t('settings.smartAccountRecoveryEmailAlertsDescription')}</Text>
      {alertError && <Text accessibilityRole="alert" style={styles.body}>Recovery alerts could not be opened. Try again.</Text>}
    </>}
    <Button title={state.status === 'idle' ? 'Check status' : 'Check again'} variant={state.status === 'idle' ? 'primary' : 'secondary'} size={state.status === 'idle' ? 'regular' : 'compact'} icon="refresh" onPress={() => { void check(); }} disabled={state.status === 'loading'} />
  </Screen></SafeAreaView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: { gap: 6, padding: 16 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  address: { color: colors.text, fontSize: 14, lineHeight: 21 },
  status: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
});
