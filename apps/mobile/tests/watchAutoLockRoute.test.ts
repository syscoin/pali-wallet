import assert from 'node:assert/strict';
import test from 'node:test';
import { SecurityPreferences } from '../src/core/securityPreferences.ts';
import { createNativePrivateAuthenticationScope } from '../src/custody/privateAuthentication.ts';
import * as privateAuthentication from '../src/custody/privateAuthentication.ts';
import * as idlePolicy from '../../../source/shared/idleLockPolicy.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { quietActivityNotifications } from './notificationFixture.ts';
import { createTestPublicViewLock } from './publicViewLockFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';

async function fixture(status: 'ready' | 'missing' | 'unsupported' = 'ready', minutes = 0) {
  const privacy = createTestPublicViewLock(); await privacy.ready;
  let raw: string | null = JSON.stringify({ version: 1, custodyIdleMinutes: 0, watchIdleMinutes: minutes }), writes = 0, idleChecks = 0, exits = 0, expired = false;
  let authorizations = 0, authorization: Promise<void> | undefined, prompt: AbortSignal | undefined;
  const preferences = new SecurityPreferences({ get: async () => raw, set: async value => { raw = value; writes++; } });
  await preferences.load();
  let state = { status: 'ready', generation: 1, selectedAccountId: 'watch-1', selectedNetworkId: 'ethereum',
    accounts: [{ id: 'watch-1', name: 'Watch account', addresses: { ethereum: '0x1111111111111111111111111111111111111111' } }] };
  const alerts: string[] = [];
  const native = { Alert: { alert: (_title: string, message: string) => alerts.push(message) }, AppState: { currentState: 'active' }, BackHandler: { addEventListener: () => ({ remove() {} }) } };
  const authority = { getSnapshot: () => state, subscribe: () => () => {}, getNetwork: (id: string) => ({ kind: 'evm', id, name: 'Ethereum' }), lock() { state = { ...state, status: 'locked' }; } };
  const navigation = { registerBack: () => () => {}, beginNavigation() {}, setImmersive() {} };
  const screen = screenFixture(new URL('../src/screens/WatchSession.tsx', import.meta.url), 'WatchSession', {
    'react-native': native,
    '../platform/localization': nativeTranslationFixture,
    '../platform/security': { publicViewLock: privacy.viewLock, securityPreferences: preferences, watchIdle: { assertCurrent() { idleChecks++; if (expired) throw Error('CANCELLED'); } } },
    '../platform/credential': { getPublicViewAuthorizationStatus: async () => status,
      isNativeCredentialPromptActive: (signal: AbortSignal) => signal === prompt && !signal.aborted,
      async authorizePublicView(signal: AbortSignal, check: () => void) {
        if (status !== 'ready') throw Error('VIEW_AUTHENTICATION_UNAVAILABLE');
        authorizations++; prompt = signal;
        try { check(); await authorization; check(); } finally { prompt = undefined; }
      } },
    '../../../../source/shared/idleLockPolicy': idlePolicy,
    '../custody/privateAuthentication': privateAuthentication,
    './AutoLockSettings': { AutoLockSettings: 'AutoLockSettings' },
    './RealAppShell': { RealAppShell: 'RealAppShell' }, './RealTools': { RealTools: 'RealTools' }, './RealSettings': { RealSettings: 'RealSettings' },
    './WatchAccountPortfolio': { WatchAccountPortfolio: 'WatchAccountPortfolio' }, './UtxoActivityScreen': { UtxoActivityScreen: 'UtxoActivityScreen' },
    './NativeActivity': { NativeActivityScreen: 'NativeActivityScreen' }, '../activity/watchActivity': { createWatchEvmActivity: () => ({}) },
    '../platform/http': { walletFetch: async () => { throw Error('Unexpected network'); } },
    '../notifications/service': { nativeActivityNotifications: quietActivityNotifications },
    '../notifications/choices': { watchNotificationChoices: () => [] },
    './useRealShell': { useRealShell: () => ({ tab: 'settings', navigation, immersive: false, goBack() {}, select() {} }) },
  });
  const render = () => screen.render({ authority, onAccounts() {}, onExit() { exits++; } });
  const settings = () => screenElements(render()).find(node => node.type === 'RealSettings')!;
  return { render, settings, preferences, privacy, alerts, close: screen.close,
    changeScope() { state = { ...state, generation: state.generation + 1 }; },
    background() { native.AppState.currentState = 'background'; },
    foreground() { native.AppState.currentState = 'active'; },
    inactive() { native.AppState.currentState = 'inactive'; },
    holdAuthorization(pending: Promise<void>) { authorization = pending; },
    expire() { expired = true; },
    counts: () => ({ writes, idleChecks, exits, authorizations }) };
}

test('watch Settings opens Auto-lock, saves only watch timeout and returns to Settings on Back', async () => {
  const f = await fixture();
  try {
    const settings = f.settings(); assert.equal(settings.props.watchOnly, true);
    settings.props.onAutoLock(); const route = f.render();
    assert.equal(route.type, 'AutoLockSettings'); assert.equal(route.props.mode, 'watch');
    await route.props.save(f.preferences.getSnapshot().value, 30, new AbortController().signal, createNativePrivateAuthenticationScope(), () => undefined);
    assert.deepEqual(f.preferences.getSnapshot().value, { version: 1, custodyIdleMinutes: 0, watchIdleMinutes: 30 });
    assert(f.counts().idleChecks > 0); assert.equal(f.counts().writes, 1);
    route.props.onBack(); assert(f.settings()); assert.equal(f.counts().exits, 0);
  } finally { f.close(); }
});

test('watch lock and enabling auto-lock refuse a device without OS authentication', async () => {
  const f = await fixture('missing');
  try {
    await f.settings().props.onLock();
    assert.equal(f.privacy.marker(), 'unlocked');
    assert.equal(f.alerts.length, 1);
    assert.match(f.alerts[0]!, /device passcode/);
    f.settings().props.onAutoLock(); const route = f.render();
    await assert.rejects(route.props.save(f.preferences.getSnapshot().value, 15, new AbortController().signal, createNativePrivateAuthenticationScope(), () => undefined), /VIEW_AUTHENTICATION_UNAVAILABLE/);
    assert.equal(f.counts().writes, 0);
  } finally { f.close(); }
});

test('watch manual lock persists before closing the visible account', async () => {
  const f = await fixture();
  try {
    await f.settings().props.onLock();
    assert.equal(f.privacy.viewLock.getSnapshot().phase, 'locked');
    assert.equal(f.counts().exits, 1);
    assert.equal(f.render(), null);
  } finally { f.close(); }
});

test('stale watch Settings and Auto-lock callbacks cannot act on a replacement scope', async () => {
  const f = await fixture();
  try {
    const oldSettings = f.settings(); f.changeScope(); oldSettings.props.onAutoLock();
    assert(f.settings());
    f.settings().props.onAutoLock(); const oldRoute = f.render(); assert.equal(oldRoute.type, 'AutoLockSettings');
    const expected = f.preferences.getSnapshot().value;
    f.changeScope(); f.settings().props.onAutoLock();
    assert.equal(f.render().type, 'AutoLockSettings');
    oldRoute.props.onBack(); assert.equal(f.render().type, 'AutoLockSettings');
    await assert.rejects(oldRoute.props.save(expected, 30, new AbortController().signal, createNativePrivateAuthenticationScope(), () => undefined), /CANCELLED/);
    assert.equal(f.counts().writes, 0);
  } finally { f.close(); }
});

test('watch Auto-lock cannot open from a captured Settings callback after background', async () => {
  const f = await fixture();
  try {
    const settings = f.settings(); f.background(); settings.props.onAutoLock();
    assert(f.settings()); assert.equal(f.counts().writes, 0);
  } finally { f.close(); }
});

test('watch auto-lock weakening requires fresh OS authorization, while shortening does not', async () => {
  const f = await fixture('ready', 5);
  try {
    f.settings().props.onAutoLock(); const route = f.render();
    let expected = f.preferences.getSnapshot().value;
    expected = await route.props.save(expected, 30, new AbortController().signal, createNativePrivateAuthenticationScope(), () => undefined);
    assert.equal(f.counts().authorizations, 1);
    expected = await route.props.save(expected, 5, new AbortController().signal, createNativePrivateAuthenticationScope(), () => undefined);
    assert.equal(f.counts().authorizations, 1);
    await route.props.save(expected, 0, new AbortController().signal, createNativePrivateAuthenticationScope(), () => undefined);
    assert.equal(f.counts().authorizations, 2); assert.equal(f.preferences.getSnapshot().value!.watchIdleMinutes, 0);
  } finally { f.close(); }
});

for (const boundary of ['abort', 'unmount', 'scope', 'lock', 'background', 'expiry'] as const) test(`watch auto-lock does not weaken after ${boundary} during authorization`, async () => {
  const f = await fixture('ready', 5), held = Promise.withResolvers<void>(), owner = new AbortController();
  try {
    f.settings().props.onAutoLock(); const route = f.render(); f.holdAuthorization(held.promise);
    let interrupted = false;
    const pending = route.props.save(f.preferences.getSnapshot().value, 0, owner.signal, createNativePrivateAuthenticationScope(), () => {
      if (owner.signal.aborted || boundary === 'background' && interrupted) throw Error('CANCELLED');
    });
    const rejected = assert.rejects(pending, /CANCELLED/);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(f.counts().authorizations, 1); assert.equal(f.counts().writes, 0);
    if (boundary === 'abort') owner.abort();
    if (boundary === 'unmount') f.close();
    if (boundary === 'scope') f.changeScope();
    if (boundary === 'lock') await f.privacy.viewLock.lock();
    if (boundary === 'background') { interrupted = true; f.background(); }
    if (boundary === 'expiry') f.expire();
    held.resolve(); await rejected;
    assert.equal(f.preferences.getSnapshot().value!.watchIdleMinutes, 5); assert.equal(f.counts().writes, 0);
  } finally { held.resolve(); f.close(); }
});

test('watch scope changes remount Settings so a privacy request cannot survive its old context', async () => {
  const f = await fixture();
  try {
    const before = f.settings().props.key;
    f.changeScope(); assert.notEqual(f.settings().props.key, before);
  } finally { f.close(); }
});

test('watch weakening keeps only its exact OS prompt active during inactive and refuses stale preference tokens before prompting', async () => {
  const f = await fixture('ready', 5), held = Promise.withResolvers<void>();
  try {
    f.settings().props.onAutoLock(); const route = f.render(); f.holdAuthorization(held.promise);
    const authentication = createNativePrivateAuthenticationScope();
    const initial = f.preferences.getSnapshot().value;
    let inactive = false;
    const pending = route.props.save(initial, 30, new AbortController().signal, authentication, () => {
      if (inactive && !authentication.isAuthenticating()) throw Error('CANCELLED');
    });
    await new Promise(resolve => setImmediate(resolve)); inactive = true; f.inactive();
    assert.equal(authentication.isAuthenticating(), true);
    f.foreground(); inactive = false; held.resolve(); await pending;
    assert.equal(authentication.isAuthenticating(), false);
    await assert.rejects(route.props.save(initial, 0, new AbortController().signal, createNativePrivateAuthenticationScope(), () => undefined));
    assert.equal(f.counts().authorizations, 1); assert.equal(f.counts().writes, 1);
  } finally { held.resolve(); f.close(); }
});
