import React, { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeGuardianRecoveryStatus } from '../custody/evmTransferReadRpc';
import { Button, Card, colors, Header, Screen, Text } from '../ui';
import { NativeGuardianPolicy, type NativeGuardianPolicyTool } from './NativeGuardianPolicy';

export type WatchGuardianRecoveryTool = {
  scope: string;
  address: string;
  manage?: NativeGuardianPolicyTool;
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

export function WatchGuardianRecovery({ address, networkLabel, read, manage, lifetime, onBack }:
  Omit<WatchGuardianRecoveryTool, 'scope'> & { networkLabel: string; lifetime: AbortSignal; onBack(): void }) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const [editing, setEditing] = useState(false);
  const owner = useRef<AbortController | null>(null);
  const cancel = () => { owner.current?.abort(); owner.current = null; };
  useLayoutEffect(() => {
    lifetime.addEventListener('abort', cancel, { once: true });
    return () => { lifetime.removeEventListener('abort', cancel); cancel(); };
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

  if (editing && manage && observation) {
    return <NativeGuardianPolicy address={address} networkLabel={networkLabel}
      observation={observation} manage={manage} lifetime={lifetime} onBack={onBack} />;
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
    {manage && observation && <Button title={observation.exists ? 'Update guardian' : 'Set guardian'} onPress={() => setEditing(true)} />}
    <Button title={state.status === 'idle' ? 'Check status' : 'Check again'} onPress={() => { void check(); }} disabled={state.status === 'loading'} />
  </Screen></SafeAreaView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: { gap: 6, padding: 16 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  address: { color: colors.text, fontSize: 14, lineHeight: 21 },
  status: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
});
