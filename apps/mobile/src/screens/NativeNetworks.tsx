import { IdleTextInput, IdlePressable } from './IdleActivityBoundary';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { rankChainSuggestions } from '../../../../source/shared/chainCatalogue';
import type { NativeNetworkSuggestion } from '../custody/networkCatalogue';
import { createNativeNetwork, type NativeNetworkRegistration } from '../custody/networkContext';
import type { NativeNetworkSnapshot, NativeNetworkView } from '../custody/networkView';
import { Button, colors, Header, Notice, Screen, Text } from '../ui';

function failure(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'BUSY') return 'Wait for the current wallet operation to finish, then try again.';
  if (code === 'CANCELLED' || code === 'NOT_READY') return 'Your wallet context changed. Unlock it and try again.';
  return 'Pali could not switch networks. Your saved wallet has been preserved.';
}

function NetworkOption<Id extends string>({ network, selected, busy, onSelect, onEdit }: {
  network: NativeNetworkSnapshot<Id>['networks'][number];
  selected: boolean;
  busy: boolean;
  onSelect(id: Id): Promise<void>;
  onEdit?: (network: NativeNetworkSnapshot<Id>['networks'][number]) => void;
}) {
  return <View style={[s.network, s.networkRow, selected && s.active]}><IdlePressable accessibilityRole="radio"
    accessibilityLabel={`${network.name}, ${network.symbol}${network.registration ? `, Chain ID ${network.registration.chainId}` : ''}${network.testnet ? ', test network' : ''}${network.canSign ? '' : ', balance and receive only'}`}
    accessibilityState={{ checked: selected, disabled: busy }} aria-checked={selected} disabled={busy}
    onPress={() => { void onSelect(network.id); }}
    style={({ pressed }) => [s.networkSelect, pressed && s.pressed]}>
    <View style={s.details}><Text style={s.name} numberOfLines={2}>{network.name}</Text>
      <Text style={s.help} numberOfLines={2}>{network.symbol}{network.testnet ? ' · Test network' : ''}</Text>
      {network.registration && <Text style={s.help}>Chain ID {network.registration.chainId}</Text>}
      {!network.canSign && <Text style={s.unavailable}>Balance and receive only</Text>}
    </View>
    <View style={[s.check, selected && s.checked]}>
      {selected && <Text style={s.checkText}>✓</Text>}
    </View>
  </IdlePressable>{onEdit && <IdlePressable accessibilityRole="button" accessibilityLabel={`Edit ${network.name}${network.registration ? `, Chain ID ${network.registration.chainId}` : ''}`} disabled={busy} onPress={() => onEdit(network)} style={s.editNetwork}><Text style={s.more}>⋯</Text></IdlePressable>}</View>;
}

type CatalogueResult =
  | { status: 'loading' | 'unavailable' }
  | { status: 'ready'; chains: readonly NativeNetworkSuggestion[] };

function NetworkSuggestions({ query, onQuery, load, networks, busy, onChoose }: {
  query: string;
  onQuery(value: string): void;
  load: NonNullable<NativeNetworkView['loadCatalogue']>;
  networks: NativeNetworkSnapshot['networks'];
  busy: boolean;
  onChoose(chain: NativeNetworkSuggestion): void;
}) {
  const [result, setResult] = useState<CatalogueResult>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const searching = query.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    let current = true;
    void load().then(
      (chains) => { if (current) setResult({ status: 'ready', chains }); },
      () => { if (current) setResult({ status: 'unavailable' }); }
    );
    return () => { current = false; };
  }, [attempt, load, searching]);
  const candidates = useMemo(() => {
    if (result.status !== 'ready') return [];
    const saved = new Set(networks.map((network) => network.registration?.chainId));
    return result.chains.filter((chain) => !saved.has(String(chain.chainId)));
  }, [networks, result]);
  const matches = useMemo(() => rankChainSuggestions(candidates, query), [candidates, query]);
  return <View style={s.field}>
    <IdleTextInput accessibilityLabel="Find a network" placeholder="Search by name or chain ID"
      placeholderTextColor={colors.muted} value={query} onChangeText={onQuery}
      maxLength={80} editable={!busy} autoCapitalize="none" autoCorrect={false}
      spellCheck={false} autoComplete="off" returnKeyType="search"
      onSubmitEditing={Keyboard.dismiss} style={s.search} />
    {searching && !busy && (result.status !== 'ready' || !matches.length) && (
      <Text accessibilityLiveRegion="polite" style={s.help}>
        {result.status === 'loading' ? 'Searching networks…' : result.status === 'unavailable'
          ? 'Search unavailable. Enter network details below.'
          : 'No matching networks. Enter network details below.'}
      </Text>
    )}
    {searching && !busy && result.status === 'unavailable' && (
      <IdlePressable accessibilityRole="button" onPress={() => {
        setResult({ status: 'loading' });
        void load(true).catch(() => undefined);
        setAttempt((previous) => previous + 1);
      }} style={s.retry}>
        <Text style={s.retryLabel}>Retry search</Text>
      </IdlePressable>
    )}
    {!busy && matches.map((chain) => (
      <IdlePressable key={chain.chainId} accessibilityRole="button"
        accessibilityLabel={`Use ${chain.name}, ${chain.nativeCurrency.symbol}, Chain ID ${chain.chainId}`}
        onPress={() => onChoose(chain)}
        style={({ pressed }) => [s.suggestion, pressed && s.pressed]}>
        <Text style={s.name} numberOfLines={2}>{chain.name}</Text>
        <Text style={s.help} numberOfLines={2}>
          {chain.nativeCurrency.symbol} · Chain ID {chain.chainId}{chain.isTestnet ? ' · Test network' : ''}
        </Text>
      </IdlePressable>
    ))}
  </View>;
}

/** Switching requests a guarded context change; this screen never grants signing authority. */
export function NativeNetworks<Id extends string>({ controller, onBack }: {
  controller: NativeNetworkView<Id>;
  onBack(): void;
}) {
  const [query, setQuery] = useState('');
  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [form, setForm] = useState<{ id?: string; utxo?: true; catalogueRevision?: number; contextRevision?: number;
    name: string; chainId: string; rpcUrl: string; symbol: string; testnet: boolean } | null>(null);
  const [ui, setUi] = useState({ owner: controller, busy: false, error: '' });
  // Reset during a controller replacement before committing its rendered children.
  // Object equality alone is insufficient when a retired controller returns later.
  if (ui.owner !== controller) {
    setUi({ owner: controller, busy: false, error: '' });
    setForm(null);
    setCatalogueQuery('');
  }
  const busy = ui.owner === controller && ui.busy;
  const error = ui.owner === controller ? ui.error : '';
  const working = useRef<object | null>(null);
  const lifetime = useRef({ alive: true, epoch: 0 });
  const latestBack = useRef(onBack);
  useLayoutEffect(() => { latestBack.current = onBack; }, [onBack]);
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const snapshot = useSyncExternalStore(subscribe, controller.getSnapshot, controller.getSnapshot);
  const discardForm = useCallback(() => {
    lifetime.current.epoch++;
    const cancel = working.current !== null;
    working.current = null;
    setUi({ owner: controller, busy: false, error: '' });
    setCatalogueQuery('');
    setForm(null);
    if (cancel) controller.cancel();
    Keyboard.dismiss();
  }, [controller]);
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
  const inForm = form !== null;
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (inForm) discardForm(); else close();
      return true;
    });
    return () => back.remove();
  }, [close, discardForm, inForm]);

  const edit = (registration?: NativeNetworkRegistration) => {
    if (working.current) return;
    setUi({ owner: controller, busy: false, error: '' });
    setCatalogueQuery('');
    setForm(registration ? { ...registration } : { name: '', chainId: '', rpcUrl: 'https://', symbol: '', testnet: false });
  };

  const editUtxo = (network: NativeNetworkSnapshot<Id>['networks'][number]) => {
    if (working.current || !snapshot || !network.customUtxoEndpoint) return;
    setUi({ owner: controller, busy: false, error: '' });
    setCatalogueQuery('');
    setForm({ utxo: true, id: network.id, catalogueRevision: snapshot.revision, contextRevision: controller.getContextRevision(),
      name: network.name, rpcUrl: network.customUtxoEndpoint,
      chainId: '', symbol: network.symbol, testnet: network.testnet });
  };

  const editSaved = (network: NativeNetworkSnapshot<Id>['networks'][number]) => {
    if (network.registration) edit(network.registration);
    else editUtxo(network);
  };

  const chooseSuggestion = (chain: NativeNetworkSuggestion) => {
    if (!form || form.id || working.current) return;
    setUi({ owner: controller, busy: false, error: '' });
    setCatalogueQuery('');
    setForm({
      name: chain.name, chainId: String(chain.chainId), rpcUrl: chain.rpc[0].url,
      symbol: chain.nativeCurrency.symbol.toUpperCase(), testnet: chain.isTestnet,
    });
    Keyboard.dismiss();
  };

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

  const save = async (remove = false) => {
    if (!form || !snapshot || working.current) return;
    const remover = form.utxo ? controller.removeUtxo : controller.remove;
    const saver = form.utxo ? (form.id ? controller.editUtxo : controller.addUtxo) : controller.save;
    if (remove ? !form.id || !remover : !saver) return;
    if (form.utxo && form.id && !isCurrentUtxoEdit()) {
      setUi({ owner: controller, busy: false, error: 'This network changed. Reopen it to edit the current settings.' });
      return;
    }
    const contextRevision = controller.getContextRevision();
    const catalogueRevision = snapshot.revision;
    const epoch = lifetime.current.epoch, operation = {};
    working.current = operation;
    setUi({ owner: controller, busy: true, error: '' }); Keyboard.dismiss();
    try {
      if (remove) {
        await remover!(form.id as Id, contextRevision, catalogueRevision);
      } else if (form.utxo) {
        const draft = { endpoint: form.rpcUrl.trim(), name: form.name.trim() };
        if (form.id) await controller.editUtxo!(form.id as Id, draft, contextRevision, catalogueRevision);
        else await controller.addUtxo!({ ...draft, explorer: '' }, contextRevision, catalogueRevision);
      } else {
        const chainId = form.chainId.trim();
        const registration = createNativeNetwork({ id: form.id ?? `custom:${chainId}`, name: form.name, kind: 'evm',
          chainId, slip44: 60, rpcUrl: form.rpcUrl.trim(), symbol: form.symbol, decimals: 18, testnet: form.testnet });
        await controller.save!(registration, contextRevision, catalogueRevision);
      }
      if (working.current === operation && lifetime.current.alive && epoch === lifetime.current.epoch) {
        setForm(null);
      }
    } catch (cause) {
      if (working.current === operation && lifetime.current.alive && epoch === lifetime.current.epoch &&
          controller.getContextRevision() === contextRevision && controller.getSnapshot()?.revision === catalogueRevision) {
        const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
        let message = form.utxo ? form.id ? code === 'UTXO_ENDPOINT_HAS_SAVED_TRANSFER'
          ? 'Check your saved transfers before changing this endpoint.'
          : 'Check the network name and use a Blockbook URL for this network.'
          : 'Check the Blockbook URL and make sure this coin type is not already saved.'
          : 'Check the network details and RPC connection. The chain ID must match the RPC, and each saved network must have a distinct chain ID.';
        if (form.utxo && remove) {
          message = code === 'ACCOUNT_NOT_REMOVABLE'
            ? 'Keep this network while it has saved accounts.'
            : code === 'UTXO_NETWORK_HAS_SAVED_TRANSFER'
            ? 'Check your saved transfers before removing this network.'
            : 'Could not remove this network. Reopen its settings and try again.';
        }
        setUi({ owner: controller, busy: false, error: message });
      }
    } finally {
      if (working.current === operation) {
        working.current = null;
        if (lifetime.current.alive && epoch === lifetime.current.epoch) setUi((previous) => previous.owner === controller ? { ...previous, busy: false } : previous);
      }
    }
  };
  const changeField = (key: 'name' | 'chainId' | 'rpcUrl' | 'symbol', value: string) => {
    if (working.current) return;
    setUi({ owner: controller, busy: false, error: '' });
    setCatalogueQuery('');
    setForm((old) => old && { ...old, [key]: key === 'symbol' ? value.toUpperCase() : value });
  };
  const field = (key: 'name' | 'chainId' | 'rpcUrl' | 'symbol', label: string) => <View style={s.field}>
    <Text style={s.help}>{label}</Text><IdleTextInput accessibilityLabel={label} value={form?.[key] ?? ''}
      onChangeText={(value) => changeField(key, value)} editable={!busy && !(key === 'chainId' && !!form?.id)}
      autoCapitalize="none" autoCorrect={false} spellCheck={false} keyboardType={key === 'chainId' ? 'number-pad' : key === 'rpcUrl' ? 'url' : 'default'}
      maxLength={key === 'rpcUrl' ? 2048 : key === 'chainId' ? 16 : undefined} style={s.search} /></View>;

  const isCurrentUtxoEdit = () => form?.catalogueRevision !== undefined &&
    form.catalogueRevision === controller.getSnapshot()?.revision &&
    form.contextRevision === controller.getContextRevision();
  const search = query.trim().toLocaleLowerCase();
  const matches = snapshot?.networks.filter((network) =>
    !search || network.name.toLocaleLowerCase().includes(search) || network.symbol.toLocaleLowerCase().includes(search)) ?? [];
  return <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={s.safeArea} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen key={form ? 'network-form' : 'network-list'}>
        <Header title={form ? form.utxo ? (form.id ? 'Edit UTXO network' : 'Add UTXO network') : form.id ? 'Edit network' : 'Add network' : 'Networks'} subtitle={form?.utxo && form.id ? undefined : 'Choose a network for this account'} onBack={form ? discardForm : close} />
        {form ? <>
          {!form.utxo && !form.id && snapshot && controller.loadCatalogue && (
            <NetworkSuggestions query={catalogueQuery} onQuery={setCatalogueQuery}
              load={controller.loadCatalogue} networks={snapshot.networks} busy={busy}
              onChoose={chooseSuggestion} />
          )}
          {field('name', form.utxo && !form.id ? 'Network name (optional)' : 'Network name')}
          {field('rpcUrl', form.utxo ? 'Blockbook URL' : 'RPC URL')}
          {!form.utxo && <>{field('chainId', 'Chain ID')}{field('symbol', 'Currency symbol')}
          <IdlePressable accessibilityRole="checkbox" accessibilityLabel="This is a test network"
            accessibilityState={{ checked: form.testnet, disabled: busy }} aria-checked={form.testnet} disabled={busy}
            onPress={() => setForm((value) => value && { ...value, testnet: !value.testnet })} style={s.network}>
            <Text style={{ flex: 1 }}>{form.testnet ? '✓ ' : ''}This is a test network</Text>
          </IdlePressable></>}
          {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
          {!form.utxo && <Text style={s.help}>RPC changes apply to pending status checks and retries you approve.</Text>}
          <Button title={form.utxo && form.id ? busy ? 'Saving…' : 'Save changes' : busy ? 'Checking network…' : 'Save network'} disabled={busy} onPress={() => { void save(); }} />
          {form.id && (form.utxo ? controller.removeUtxo : controller.remove) && <Button title="Remove network" variant="quiet" disabled={busy || form.id === snapshot?.selectedId} onPress={() => { void save(true); }} />}
          {form.id && form.id === snapshot?.selectedId && <Text style={s.help}>
            {form.utxo ? 'Only unused custom UTXO networks can be removed.' : 'Switch to another network before removing this one.'}
          </Text>}
          <Button title="Cancel" variant="quiet" disabled={busy} onPress={discardForm} />
        </> : <>
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
              {networks.map((network) => {
                const canEdit = network.registration ? controller.save : controller.editUtxo && network.customUtxoEndpoint;
                return <NetworkOption key={network.id} network={network}
                  selected={network.id === snapshot?.selectedId} busy={busy} onSelect={handleSelect} onEdit={canEdit ? editSaved : undefined} />;
              })}
            </View>;
          })}
          {controller.save && <Button title="Add network" variant="quiet" disabled={busy} onPress={() => edit()} />}
          {controller.addUtxo && <Button title="Add UTXO network" variant="quiet" disabled={busy} onPress={() => {
            setUi({ owner: controller, busy: false, error: '' });
            setForm({ utxo: true, name: '', rpcUrl: 'https://', chainId: '', symbol: '', testnet: false });
          }} />}
        </>}
        {!form && !!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
        <Text style={s.buildLabel}>Development build · Use a test wallet</Text>
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  field: { gap: 6 },
  safeArea: { flex: 1, backgroundColor: colors.bg },
  search: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 16, padding: 16, minHeight: 54, color: colors.text, fontSize: 16 },
  section: { gap: 10 }, sectionTitle: { fontSize: 14, fontWeight: '600', color: colors.muted },
  network: { minHeight: 82, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 17, flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: colors.surface },
  networkRow: { padding: 0, gap: 0 }, networkSelect: { flex: 1, minHeight: 82, padding: 17, flexDirection: 'row', alignItems: 'center', gap: 12 },
  suggestion: { minHeight: 50, justifyContent: 'center', gap: 3, borderRadius: 12, padding: 12, backgroundColor: colors.surface },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 8 },
  retryLabel: { color: colors.blue, fontWeight: '600' },
  editNetwork: { minWidth: 44, minHeight: 60, alignItems: 'center', justifyContent: 'center' }, more: { color: colors.muted, fontSize: 24 },
  active: { borderColor: colors.blue }, pressed: { opacity: 0.7 }, details: { flex: 1, gap: 5 },
  name: { fontSize: 17, fontWeight: '600' }, help: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  unavailable: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.blue, borderColor: colors.blue }, checkText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 }, buildLabel: { color: colors.muted, fontSize: 11, textAlign: 'center' },
});
