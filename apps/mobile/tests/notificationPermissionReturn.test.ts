import { walletUiFixture } from './walletUiFixture.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { NativeNotificationCoordinator, emptyNotificationDocument } from '../src/notifications/coordinator.ts';
import { NotificationPermissionReturn, type NotificationReturnContext } from '../src/notifications/permissionReturn.ts';
import type { NativeNotificationScope, NotificationDocument, NotificationEnableOptions, NotificationPermissionResult, NotificationStore } from '../src/notifications/types.ts';
import { notificationCapabilities } from '../src/notifications/capabilities.ts';
import { createPermissionPresentation } from '../src/platform/permissionPresentation.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const scope: NativeNotificationScope = { id: 'watch:one:ethereum', accountId: 'watch:one', accountType: 'watch',
  accountAddress: '0x' + '11'.repeat(20), network: getNativeNetwork('ethereum') };

function returnFixture() {
  let now = 1000, changes = 0;
  const context: NotificationReturnContext = { owner: {}, identity: 'watch:one:ethereum', scopes: [scope] };
  const controller = new NotificationPermissionReturn(() => { changes++; }, () => now);
  return { controller, context, advance(ms: number) { now += ms; }, changes: () => changes };
}

test('a permission result without a lifecycle pause cannot create a return route', async () => {
  const f = returnFixture(), result = Promise.withResolvers<NotificationPermissionResult>();
  f.controller.capture(f.context, scope, result.promise);
  result.resolve('granted'); await settle();
  f.controller.resume(f.context);
  assert.equal(f.controller.take(f.context), null);
  assert.equal(f.changes(), 0);
});

for (const permission of ['granted', 'denied', null] as const) {
  test(`a paused permission ${permission ?? 'failure'} returns exactly once after the same public context resumes`, async () => {
    const f = returnFixture(), result = Promise.withResolvers<NotificationPermissionResult>();
    f.controller.capture(f.context, scope, result.promise);
    f.controller.pause(f.context);
    result.resolve(permission); await settle();
    assert.equal(f.controller.take(f.context), null, 'a hidden screen cannot consume a return');
    f.controller.resume(f.context);
    assert.deepEqual(f.controller.take(f.context), { scopeKey: JSON.stringify(scope), permission });
    assert.equal(f.controller.take(f.context), null);
  });
}

for (const changed of ['owner', 'identity', 'network', 'catalogue', 'discard', 'expiry'] as const) {
  test(`${changed} retires a pending notification permission return`, async () => {
    const f = returnFixture(), result = Promise.withResolvers<NotificationPermissionResult>();
    f.controller.capture(f.context, scope, result.promise); f.controller.pause(f.context);
    let context = f.context;
    if (changed === 'owner') context = { ...context, owner: {} };
    if (changed === 'identity') context = { ...context, identity: 'watch:two:ethereum' };
    if (changed === 'network') context = { ...context, scopes: [{ ...scope, network: getNativeNetwork('base') }] };
    if (changed === 'catalogue') context = { ...context, scopes: [scope, { ...scope, id: 'watch:two:ethereum', accountId: 'watch:two' }] };
    if (changed === 'discard') f.controller.discard();
    if (changed === 'expiry') f.advance(120001);
    result.resolve('granted'); await settle(); f.controller.resume(context);
    assert.equal(f.controller.take(context), null);
  });
}

test('a replaced request cannot supply the earlier permission result', async () => {
  const f = returnFixture(), first = Promise.withResolvers<NotificationPermissionResult>(), second = Promise.withResolvers<NotificationPermissionResult>();
  f.controller.capture(f.context, scope, first.promise); f.controller.pause(f.context);
  f.controller.capture(f.context, scope, second.promise); f.controller.pause(f.context);
  first.resolve('granted'); await settle(); f.controller.resume(f.context);
  assert.equal(f.controller.take(f.context), null);
  second.resolve('denied'); await settle();
  assert.deepEqual(f.controller.take(f.context), { scopeKey: JSON.stringify(scope), permission: 'denied' });
});

test('a rejected old request cannot erase the replacement permission return', async () => {
  const f = returnFixture(), first = Promise.withResolvers<NotificationPermissionResult>(), second = Promise.withResolvers<NotificationPermissionResult>();
  f.controller.capture(f.context, scope, first.promise); f.controller.pause(f.context);
  f.controller.capture(f.context, scope, second.promise); f.controller.pause(f.context);
  first.reject(Error('Old request failed')); await settle();
  second.resolve('granted'); await settle(); f.controller.resume(f.context);
  assert.deepEqual(f.controller.take(f.context), { scopeKey: JSON.stringify(scope), permission: 'granted' });
});

test('duplicate matching foreground resumes retain a later permission result', async () => {
  const f = returnFixture(), result = Promise.withResolvers<NotificationPermissionResult>();
  f.controller.capture(f.context, scope, result.promise); f.controller.pause(f.context);
  f.controller.resume(f.context); f.controller.resume(f.context);
  assert.equal(f.controller.take(f.context), null);
  result.resolve('granted'); await settle();
  assert.deepEqual(f.controller.take(f.context), { scopeKey: JSON.stringify(scope), permission: 'granted' });
  assert.equal(f.controller.take(f.context), null);
});

type Permission = { granted: boolean; canAskAgain: boolean };
type PermissionPort = {
  requestNativeNotificationPermission(request?: boolean, onPresentation?: NotificationEnableOptions['onPermissionPresentation']): Promise<'granted' | 'denied'>;
  isNotificationPermissionPromptActive(): boolean;
};

async function screenHarness(initialPermission: Permission = { granted: false, canAskAgain: true }) {
  const returns = returnFixture();
  let state = 'active', permission = initialPermission, requests = 0, captures = 0;
  const pending = Promise.withResolvers<Permission>();
  const listeners = new Set<(state: string) => void>();
  const native = { AppState: { get currentState() { return state; },
    addEventListener(_event: string, listener: (state: string) => void) { listeners.add(listener); return { remove() { listeners.delete(listener); } }; } },
    View: 'View', StyleSheet: { hairlineWidth: 1, create: (value: unknown) => value } };
  const module = { exports: {} as PermissionPort };
  const code = ts.transpileModule(readFileSync(new NodeURL('../src/notifications/permission.native.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const imports: Record<string, unknown> = {
    'react-native': native,
    'expo-notifications': { IosAuthorizationStatus: { PROVISIONAL: 3 }, getPermissionsAsync: async () => permission,
      requestPermissionsAsync() { requests++; return pending.promise; } },
    '../platform/permissionPresentation.ts': { createPermissionPresentation },
  };
  runInNewContext(code, { module, exports: module.exports, setTimeout, clearTimeout,
    require(name: string) { const walletUi = walletUiFixture(name, imports); if (walletUi) return walletUi; assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  const permissionPort = module.exports;
  let document = emptyNotificationDocument(), serial: Promise<unknown> = Promise.resolve(), nextId = 0;
  const permissionReads: boolean[] = [], enrolledWith: string[] = [];
  const store: NotificationStore = {
    initialize: async () => undefined,
    transact<T>(action: (draft: NotificationDocument) => Promise<T> | T, guard: () => void): Promise<T> {
      const result = serial.then(async () => {
        guard(); const next = structuredClone(document), value = await action(next); guard(); document = next; return value;
      });
      serial = result.catch(() => undefined); return result;
    },
  };
  const coordinator = new NativeNotificationCoordinator({ store,
    delivery: { permission(request, onPresentation) { permissionReads.push(request); return permissionPort.requestNativeNotificationPermission(request, onPresentation); },
      backgroundStatus: async () => 'available', register: async () => undefined, unregister: async () => undefined,
      post: async () => undefined, remove: async () => undefined, prune: async () => undefined },
    normalize: value => structuredClone(value),
    factScope: value => ({ accountId: value.accountId, accountType: value.accountType, accountAddress: value.accountAddress,
      chainId: String(value.network.chainId), networkType: 'evm', networkKey: 'registration' }),
    read: async (value, _previous, _signal, guard) => { guard(); enrolledWith.push(value.id); return { transactions: [], historyReadSucceeded: true }; },
    randomId: () => 'pali-alert-' + (++nextId).toString(16).padStart(32, '0'),
  });
  await coordinator.load();
  let owner = {}, targetGeneration = 0;
  const screens: ReturnType<typeof screenFixture>[] = [];
  const mount = (permissionReturn?: ReturnType<NotificationPermissionReturn['take']>) => {
    const capturedOwner = owner, target = {
      scope: `watch-generation-${++targetGeneration}`,
      readChoices: () => [{ label: 'Account 1', networkName: 'Ethereum', symbol: 'ETH', scope }],
      assertCurrent() { if (owner !== capturedOwner) throw Error('CANCELLED'); },
      onPermissionPresentation(value: NativeNotificationScope, result: Promise<NotificationPermissionResult>) {
        captures++; returns.controller.capture(returns.context, value, result);
      },
      cancelPermissionReturn: returns.controller.discard,
    };
    const screen = screenFixture(new NodeURL('../src/screens/ActivityNotifications.tsx', import.meta.url), 'ActivityNotifications', {
      'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../platform/localization': nativeTranslationFixture,
      '../notifications/service': { nativeActivityNotifications: coordinator },
      '../notifications/capabilities': { notificationCapabilities },
      './IdleActivityBoundary': { IdleTextInput: 'Input', IdlePressable: 'Pressable' },
      '../ui': { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'Icon', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
    });
    screens.push(screen);
    return { render: () => screenElements(screen.render({ target, onBack() {}, permissionReturn })), close: screen.close };
  };
  return { ...returns, mount, coordinator, permissionReads, enrolledWith,
    requests: () => requests, captures: () => captures, scopes: () => document.scopes,
    async background(screen: ReturnType<typeof mount>) {
      returns.controller.pause(returns.context); state = 'background'; owner = {};
      for (const listener of [...listeners]) listener(state);
      screen.close(); await settle();
    },
    async complete(granted: boolean) {
      permission = { granted, canAskAgain: false }; pending.resolve(permission); await settle();
    },
    foreground() { state = 'active'; for (const listener of [...listeners]) listener(state); returns.controller.resume(returns.context); },
    promptActive: () => permissionPort.isNotificationPermissionPromptActive(),
    close() { screens.forEach(screen => screen.close()); },
  };
}

for (const granted of [false, true]) {
  test(`ordinary alert tap carries its actual ${granted ? 'grant' : 'denial'} through a retired screen to a fresh guard`, async () => {
    const f = await screenHarness();
    try {
      const first = f.mount(); first.render(); await settle();
      first.render().find(node => node.props.accessibilityRole === 'checkbox')!.props.onPress(); await settle();
      assert.equal(f.requests(), 1); assert.equal(f.captures(), 1); assert.equal(f.promptActive(), true);
      await f.background(first);
      assert.equal(f.promptActive(), false, 'real background still retires the permission exemption');
      await f.complete(granted);
      assert.equal(f.scopes().length, 0, 'the old screen never commits enrollment');
      f.foreground();
      const result = f.controller.take(f.context);
      assert.deepEqual(result, { scopeKey: JSON.stringify(scope), permission: granted ? 'granted' : 'denied' });
      const fresh = f.mount(result); fresh.render(); await settle(); fresh.render(); await settle();
      assert.equal(f.requests(), 1, 'fresh admission reads permission without another OS prompt');
      assert.equal(f.captures(), 1);
      if (granted) {
        assert.deepEqual(f.scopes().map(value => value.scope.id), [scope.id]);
        assert.deepEqual(f.enrolledWith, [scope.id]);
        assert.equal(fresh.render().find(node => node.props.accessibilityRole === 'checkbox')!.props.accessibilityState.checked, true);
        const permissionReads = f.permissionReads.length;
        fresh.render(); await settle(); assert.deepEqual(f.enrolledWith, [scope.id], 'the same return is not admitted twice');
        assert.equal(f.permissionReads.length, permissionReads, 'rerendering the same returned prop cannot call enable again');
      } else {
        assert.deepEqual(f.scopes(), []); assert.deepEqual(f.enrolledWith, []);
        assert(fresh.render().some(node => node.props.accessibilityRole === 'alert'));
      }
      assert.equal(f.controller.take(f.context), null);
      assert.equal(f.permissionReads[0], false);
      assert(f.permissionReads.filter(Boolean).length === 1);
    } finally { f.close(); }
  });
}

test('closing the old Alerts screen explicitly discards its pending public return', async () => {
  const f = await screenHarness();
  try {
    const first = f.mount(); first.render(); await settle();
    const nodes = first.render(); nodes.find(node => node.props.accessibilityRole === 'checkbox')!.props.onPress(); await settle();
    nodes.find(node => node.type === 'Header')!.props.onBack();
    await f.background(first); await f.complete(true); f.foreground();
    assert.equal(f.controller.take(f.context), null); assert.deepEqual(f.scopes(), []);
  } finally { f.close(); }
});

for (const granted of [false, true]) {
  test(`an existing ${granted ? 'grant' : 'final denial'} never creates a permission continuation`, async () => {
    const f = await screenHarness({ granted, canAskAgain: false });
    try {
      const first = f.mount(); first.render(); await settle();
      first.render().find(node => node.props.accessibilityRole === 'checkbox')!.props.onPress(); await settle();
      assert.equal(f.requests(), 0); assert.equal(f.captures(), 0);
      assert.equal(f.controller.take(f.context), null);
      assert.equal(f.scopes().length, granted ? 1 : 0);
    } finally { f.close(); }
  });
}
