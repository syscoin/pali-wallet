import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

import { WatchUtxoNetworkReloadRequiredError, type WatchUtxoNetworksView, type WatchUtxoNetworkSettings } from '../core/publicAccountStorage';
import { canonicalUtxoEndpoint, isCustomUtxoNetworkId, utxoRegistrationData, type UtxoNetwork } from '../core/utxoNetworks';
import { Button, Card, colors, Header, Notice, Row, Screen, Text, styles } from '../ui';
import { IdleTextInput } from './IdleActivityBoundary';

type Draft = { endpoint: string; name: string; explorer: string; original?: UtxoNetwork };
const emptyDraft = { endpoint: '', name: '', explorer: '' };

function reconcileDraft(draft: Draft | null, { networks }: WatchUtxoNetworkSettings): Draft | null {
  if (!draft) return null;
  if (draft.original) {
    const original = draft.original;
    const current = networks.find(({ id }) => id === original.id);
    if (!current || JSON.stringify(utxoRegistrationData(current)) !== JSON.stringify(utxoRegistrationData(original))) return null;
    return { ...draft, original: current };
  }
  try {
    const endpoint = canonicalUtxoEndpoint(draft.endpoint.trim());
    if (networks.some((network) => isCustomUtxoNetworkId(network.id) && network.endpoint === endpoint)) return null;
  } catch { /* Leave the unfinished draft available for correction. */ }
  return draft;
}

export function WatchNetworks({ controller, onChanged, onBack }: {
  controller: WatchUtxoNetworksView;
  onChanged(): Promise<void>;
  onBack(): void;
}) {
  const [saved, setSaved] = useState<WatchUtxoNetworkSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const alive = useRef(false);
  const back = useRef(() => {});
  const run = (operation: (signal: AbortSignal) => Promise<WatchUtxoNetworkSettings>, mode: 'load' | 'mutate' | 'reload' = 'load') => {
    if (pending.current || AppState.currentState !== 'active') return;
    const owner = new AbortController();
    pending.current = owner;
    let savedMutation = false;
    const requireReload = () => {
      setSaved(null);
      setError('Reload to check which networks are saved.');
    };
    const checkCurrent = () => {
      if (pending.current !== owner || !alive.current) return false;
      if (!owner.signal.aborted) return true;
      if (mode === 'mutate') requireReload();
      return false;
    };
    setBusy(true);
    setError('');
    void Promise.resolve().then(() => operation(owner.signal)).then(async (next) => {
      if (!checkCurrent()) return;
      if (mode !== 'load') {
        savedMutation = mode === 'mutate';
        await onChanged();
        if (!checkCurrent()) return;
      }
      setSaved(next);
      if (mode === 'mutate') setDraft(null);
      else if (mode === 'reload') setDraft((current) => reconcileDraft(current, next));
    }).catch((cause: unknown) => {
      if (!checkCurrent()) return;
      if (mode === 'mutate' && (savedMutation || cause instanceof WatchUtxoNetworkReloadRequiredError)) requireReload();
      else
        setError(cause instanceof Error && cause.message === 'Remove the watch account using this network first.'
          ? cause.message : mode === 'mutate' ? 'Check the Blockbook URL and try again.' : 'Saved networks are unavailable.');
    }).finally(() => {
      if (pending.current !== owner) return;
      pending.current = null;
      if (alive.current) setBusy(false);
    });
  };
  useLayoutEffect(() => { back.current = () => {
    pending.current?.abort();
    if (draft) {
      setDraft(null);
      setError('');
      return;
    }
    onBack();
  }; }, [draft, onBack]);
  useEffect(() => {
    alive.current = true;
    run(() => controller.load());
    const nav = BackHandler.addEventListener('hardwareBackPress', () => { back.current(); return true; });
    const retire = () => pending.current?.abort();
    const app = AppState.addEventListener('change', (state) => { if (state !== 'active') retire(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', retire) : null;
    return () => {
      alive.current = false;
      retire();
      pending.current = null;
      nav.remove(); app.remove(); blur?.remove();
    };
  // The controller owns this mounted screen's network settings.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);

  const edit = (original?: UtxoNetwork) => {
    setError('');
    setDraft(original ? { endpoint: original.endpoint, name: original.name,
      explorer: original.explorer === original.endpoint ? '' : original.explorer, original } : emptyDraft);
  };
  const save = () => {
    if (!saved || !draft) return;
    const { endpoint, name, explorer, original } = draft;
    run((signal) => controller.save(saved, { endpoint: endpoint.trim(), name: name.trim(), explorer }, signal, original?.id), 'mutate');
  };
  const remove = () => {
    if (!saved || !draft?.original) return;
    const id = draft.original.id;
    run((signal) => controller.remove(saved, id, signal), 'mutate');
  };
  const custom = saved?.networks.filter(({ id }) => isCustomUtxoNetworkId(id)) ?? [];
  return <KeyboardAvoidingView style={layout.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen>
      <Header title={draft ? draft.original ? 'Edit network' : 'Add network' : 'Watch networks'} onBack={() => back.current()} />
      {draft ? <>
        <Card style={layout.card}>
          <Text style={styles.muted}>Blockbook URL</Text>
          <IdleTextInput accessibilityLabel="Blockbook URL" style={layout.input}
            autoCapitalize="none" autoCorrect={false} autoComplete="off" keyboardType="url"
            editable={!busy && !!saved} maxLength={2048} placeholder="https://" placeholderTextColor={colors.muted}
            value={draft.endpoint} onChangeText={(endpoint) => { setDraft({ ...draft, endpoint }); setError(''); }} />
          <Text style={styles.muted}>Network name (optional)</Text>
          <IdleTextInput accessibilityLabel="Network name" style={layout.input} editable={!busy && !!saved}
            maxLength={64} value={draft.name} onChangeText={(name) => { setDraft({ ...draft, name }); setError(''); }} />
        </Card>
        <Button title={busy ? 'Checking network…' : 'Save network'} disabled={busy || !saved || !draft.endpoint.trim()} onPress={save} />
        {draft.original && <Button title="Remove network" icon="trash" variant="danger" disabled={busy || !saved} onPress={remove} />}
      </> : <>
        {saved && custom.length === 0 && <Notice title="No custom networks" body="Add a Blockbook endpoint to watch accounts on another UTXO network." />}
        {custom.length > 0 && <Card>{custom.map((network, index) => <Row key={network.id}
          title={network.name} subtitle={`${network.symbol} · ${new URL(network.endpoint).hostname}`} icon="globe"
          onPress={() => { if (!busy) edit(network); }} last={index === custom.length - 1} />)}</Card>}
        {saved && <Button title="Add UTXO network" variant="secondary" disabled={busy} onPress={() => edit()} />}
      </>}
      {busy && <ActivityIndicator color={colors.pink} accessibilityLabel="Checking network" />}
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text>}
      {!saved && !busy && <Button title="Reload saved networks" variant="secondary" onPress={() => run(() => controller.load(), 'reload')} />}
    </Screen>
  </KeyboardAvoidingView>;
}

const layout = StyleSheet.create({
  screen: { flex: 1 },
  card: { gap: 10, padding: 16 },
  input: { minHeight: 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.text },
});
