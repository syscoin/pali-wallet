import { IdleTextInput, IdlePressable } from './IdleActivityBoundary';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeNetworkSnapshot, NativeNetworkView } from '../custody/networkView';
import { colors, Header, Notice, Screen, styles, Text } from '../ui';

function failure(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'BUSY') return 'Wait for the current wallet operation to finish, then try again.';
  if (code === 'CANCELLED' || code === 'NOT_READY') return 'Your wallet context changed. Unlock it and try again.';
  return 'Pali could not switch networks. Your saved wallet has been preserved.';
}

function NetworkOption<Id extends string>({ network, selected, busy, onSelect }: {
  network: NativeNetworkSnapshot<Id>['networks'][number];
  selected: boolean;
  busy: boolean;
  onSelect(id: Id): Promise<void>;
}) {
  return <IdlePressable accessibilityRole="radio"
    accessibilityLabel={`${network.name}, ${network.symbol}${network.testnet ? ', test network' : ''}${network.canSign ? '' : ', balance and receive only'}`}
    accessibilityState={{ checked: selected, disabled: busy }} aria-checked={selected} disabled={busy}
    onPress={() => { void onSelect(network.id); }}
    style={({ pressed }) => [s.network, selected && s.active, pressed && s.pressed]}>
    <View style={s.details}><Text style={s.name}>{network.name}</Text>
      <Text style={s.help}>{network.symbol}{network.testnet ? ' · Test network' : ''}</Text>
      {!network.canSign && <Text style={s.unavailable}>Balance and receive only</Text>}
    </View>
    <View style={[s.check, selected && s.checked]}>
      {selected && <Text style={s.checkText}>✓</Text>}
    </View>
  </IdlePressable>;
}

/** Switching requests a guarded context change; this screen never grants signing authority. */
export function NativeNetworks<Id extends string>({ controller, onBack }: {
  controller: NativeNetworkView<Id>;
  onBack(): void;
}) {
  const [query, setQuery] = useState('');
  const [ui, setUi] = useState({ owner: controller, busy: false, error: '' });
  // Reset during a controller replacement before committing its rendered children.
  // Object equality alone is insufficient when a retired controller returns later.
  if (ui.owner !== controller) setUi({ owner: controller, busy: false, error: '' });
  const busy = ui.owner === controller && ui.busy;
  const error = ui.owner === controller ? ui.error : '';
  const working = useRef<object | null>(null);
  const lifetime = useRef({ alive: true, epoch: 0 });
  const latestBack = useRef(onBack);
  useLayoutEffect(() => { latestBack.current = onBack; }, [onBack]);
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const snapshot = useSyncExternalStore(subscribe, controller.getSnapshot, controller.getSnapshot);
  const close = useCallback(() => {
    lifetime.current.epoch++;
    working.current = null;
    setUi({ owner: controller, busy: false, error: '' });
    controller.cancel();
    Keyboard.dismiss();
    latestBack.current();
  }, [controller]);
  useLayoutEffect(() => {
    const local = lifetime.current;
    local.alive = true; local.epoch++;
    working.current = null;
    return () => { local.alive = false; local.epoch++; working.current = null; controller.cancel(); };
  }, [controller]);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => back.remove();
  }, [close]);

  const handleSelect = useCallback(async (id: Id) => {
    if (!snapshot || working.current || id === snapshot.selectedId) return;
    const contextRevision = controller.getContextRevision();
    const catalogueRevision = snapshot.revision;
    const epoch = lifetime.current.epoch;
    const operation = {};
    working.current = operation;
    setUi({ owner: controller, busy: true, error: '' }); Keyboard.dismiss();
    try { await controller.select(id, contextRevision, catalogueRevision); }
    catch (cause) {
      // Accepted operations may revoke this screen. Only an unchanged context owns inline feedback.
      if (working.current === operation && lifetime.current.alive && epoch === lifetime.current.epoch &&
          controller.getContextRevision() === contextRevision && controller.getSnapshot()?.revision === catalogueRevision)
        setUi({ owner: controller, busy: false, error: failure(cause) });
    } finally {
      if (working.current === operation) {
        working.current = null;
        if (lifetime.current.alive && epoch === lifetime.current.epoch)
          setUi((previous) => previous.owner === controller ? { ...previous, busy: false } : previous);
      }
    }
  }, [controller, snapshot]);

  const search = query.trim().toLocaleLowerCase();
  const matches = snapshot?.networks.filter((network) =>
    !search || network.name.toLocaleLowerCase().includes(search) || network.symbol.toLocaleLowerCase().includes(search)) ?? [];
  return <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={s.safeArea} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Header title="Networks" subtitle="Choose a network for this account" onBack={close} />
        <Text style={styles.muted}>Your address works across these networks. Your assets stay on the network where they were sent.</Text>
        <IdleTextInput accessibilityLabel="Search networks" placeholder="Search networks" placeholderTextColor={colors.muted}
          value={query} onChangeText={setQuery} maxLength={80} editable={!busy} autoCapitalize="none" autoCorrect={false}
          spellCheck={false} autoComplete="off" style={s.search} />
        {busy && <Notice title="Switching networks…" body="Pali is updating your wallet context." />}
        {!snapshot && !busy ? <Notice title="Wallet locked" body="Unlock your wallet to choose a network." /> :
          !matches.length && !busy ? <Notice title="No matching networks" body="Try another network name or currency." /> :
          [false, true].map((testnet) => {
            const networks = matches.filter((network) => network.testnet === testnet);
            if (!networks.length) return null;
            return <View key={String(testnet)} style={s.section}>
              <Text style={s.sectionTitle}>{testnet ? 'Test networks' : 'Main networks'}</Text>
              {testnet && <Text style={s.help}>Test networks use tokens intended for testing.</Text>}
              {networks.map((network) => <NetworkOption key={network.id} network={network}
                selected={network.id === snapshot?.selectedId} busy={busy} onSelect={handleSelect} />)}
            </View>;
          })}
        {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
        <Text style={s.help}>Changing networks connects to that network’s data provider. Confirm the network before receiving funds.</Text>
        <Text style={s.buildLabel}>Development build · Use a test wallet</Text>
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  search: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 16, padding: 16, minHeight: 54, color: colors.text, fontSize: 16 },
  section: { gap: 10 }, sectionTitle: { fontSize: 14, fontWeight: '600', color: colors.muted },
  network: { minHeight: 82, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 17, flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: colors.surface },
  active: { borderColor: colors.blue }, pressed: { opacity: 0.7 }, details: { flex: 1, gap: 5 },
  name: { fontSize: 17, fontWeight: '600' }, help: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  unavailable: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.blue, borderColor: colors.blue }, checkText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 }, buildLabel: { color: colors.muted, fontSize: 11, textAlign: 'center' },
});
