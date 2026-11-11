import assert from 'node:assert/strict';
import test from 'node:test';
import type { NativeConnectionsSnapshot } from '../src/connections/types.ts';
import { extractPairingUri } from '../src/connections/pairingLinks.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

function fixture() {
  let view: NonNullable<NativeConnectionsSnapshot['callsStatus']> = {
    id: 'status-1', origin: 'https://example.invalid',
    status: { version: '2.0.0', id: '0x1234', chainId: '0x1', atomic: true, status: 100 },
  };
  let refresh: () => Promise<void> = async () => {};
  const calls: string[] = [], hardware = new Set<() => boolean>();
  const controller = {
    async callsStatusShown(id: string) { calls.push(`shown:${id}`); },
    async refreshCallsStatus(id: string) { calls.push(`refresh:${id}`); await refresh(); },
    dismissCallsStatus(id: string) { calls.push(`close:${id}`); },
  };
  const host = screenFixture(new URL('../src/screens/NativeConnections.tsx', import.meta.url), 'NativeCallsStatus', {
    '../platform/localization': nativeTranslationFixture,
    '../connections/pairingLinks': { extractPairingUri },
    'react-native': { ActivityIndicator: 'ActivityIndicator', View: 'View', StyleSheet: { create: (value: unknown) => value },
      BackHandler: { addEventListener: (_event: string, action: () => boolean) => { hardware.add(action); return { remove: () => hardware.delete(action) }; } } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-clipboard': {},
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Icon', 'IconButton', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
    './IdleActivityBoundary': {}, './DappSiteStatus': {}, './ConnectionQrScanner': {},
  });
  const render = () => screenElements(host.render({ view, controller }));
  const button = (title: string) => {
    const result = render().find(element => element.type === 'Button' && element.props.title === title);
    assert(result, title); return result;
  };
  return { calls, render, button, close: host.close,
    setRefresh(value: () => Promise<void>) { refresh = value; },
    setStatus(status: number) { view = { ...view, status: { ...view.status, status } }; },
    setId(id: string) { view = { ...view, id }; },
    hardwareBack() { return [...hardware].reverse().some(action => action()); },
  };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('manual refresh shows loading, blocks repeated taps, updates status and acknowledges once', async () => {
  const f = fixture(), held = Promise.withResolvers<void>();
  try {
    f.setRefresh(async () => { await held.promise; f.setStatus(200); });
    const refresh = f.button('Refresh');
    refresh.props.onPress(); refresh.props.onPress();
    assert.equal(f.button('Refresh').props.disabled, true);
    assert(f.render().some(element => element.type === 'ActivityIndicator'));
    assert.equal(f.button('Close').props.disabled, undefined);
    assert.deepEqual(f.calls, ['shown:status-1', 'refresh:status-1']);
    held.resolve(); await settle();
    assert.equal(f.button('Refresh').props.disabled, false);
    assert(!f.render().some(element => element.type === 'ActivityIndicator'));
    assert(f.render().some(element => element.type === 'Text' && element.children.includes('Confirmed')));
    assert.deepEqual(f.calls, ['shown:status-1', 'refresh:status-1']);
  } finally { held.resolve(); f.close(); }
});

test('callbacks from a previous status do not block or refresh its replacement', async () => {
  const f = fixture();
  try {
    const oldRefresh = f.button('Refresh'), oldClose = f.button('Close');
    f.setId('status-2'); f.render();
    oldRefresh.props.onPress(); oldClose.props.onPress();
    f.button('Refresh').props.onPress(); await settle();
    assert.deepEqual(f.calls, ['shown:status-1', 'shown:status-2', 'close:status-1', 'refresh:status-2']);
  } finally { f.close(); }
});

test('a refresh error keeps the last status and can be retried', async () => {
  const f = fixture();
  try {
    f.setRefresh(async () => { throw Error('RPC unavailable'); });
    f.button('Refresh').props.onPress(); await settle();
    assert(f.render().some(element => element.type === 'Notice'));
    assert(f.render().some(element => element.type === 'Text' && element.children.includes('Pending')));
    assert.equal(f.button('Refresh').props.disabled, false);
    f.setRefresh(async () => {});
    f.button('Refresh').props.onPress(); await settle();
    assert(!f.render().some(element => element.type === 'Notice'));
    assert.deepEqual(f.calls, ['shown:status-1', 'refresh:status-1', 'refresh:status-1']);
  } finally { f.close(); }
});

for (const via of ['button', 'hardware'] as const) test(`Close remains available during refresh (${via})`, async () => {
  const f = fixture(), held = Promise.withResolvers<void>();
  try {
    f.setRefresh(() => held.promise);
    const refresh = f.button('Refresh'); refresh.props.onPress();
    if (via === 'button') f.button('Close').props.onPress(); else assert(f.hardwareBack());
    refresh.props.onPress();
    held.reject(Error('Late failure')); await settle();
    assert.deepEqual(f.calls, ['shown:status-1', 'refresh:status-1', 'close:status-1']);
    assert(!f.render().some(element => element.type === 'Notice'));
  } finally { held.resolve(); f.close(); }
});
