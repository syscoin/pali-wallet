import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PublicViewLock, PUBLIC_VIEW_LOCK_KEY } from '../src/core/publicViewLock.ts';
import { SECURITY_PREFERENCES_KEY } from '../src/core/securityPreferences.ts';
import { createSecurityRuntime } from '../src/core/securityRuntime.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

test('startup retries a stalled security read and preserves the saved lock when the old read finishes', async () => {
  let finishStaleRead!: (value: string) => void;
  const staleRead = new Promise<string>(resolve => { finishStaleRead = resolve; });
  const reads: string[] = [];
  const timers = new Set<() => void>();
  const ports: Record<string, unknown> = {
    'react-native': { Platform: { OS: 'ios' } },
    'expo-secure-store': {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-device-only',
      isAvailableAsync: async () => true,
      getItemAsync(key: string, options: Record<string, unknown>) {
        assert.equal(options.keychainAccessible, 'when-unlocked-device-only');
        reads.push(key);
        if (key === SECURITY_PREFERENCES_KEY) return Promise.resolve(null);
        assert.equal(key, PUBLIC_VIEW_LOCK_KEY);
        return reads.filter(read => read === key).length === 1 ? staleRead : Promise.resolve('locked');
      },
      setItemAsync: () => assert.fail('Startup reads must not write security settings'),
    },
    '../core/securityRuntime': { createSecurityRuntime },
    '../core/securityPreferences': { SECURITY_PREFERENCES_KEY },
    '../core/publicViewLock': { PublicViewLock, PUBLIC_VIEW_LOCK_KEY },
  };
  const adapter = { exports: {} as { publicViewLock: PublicViewLock } };
  const source = readFileSync(new URL('../src/platform/security.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    exports: adapter.exports,
    require: (name: string) => { assert(Object.hasOwn(ports, name), name); return ports[name]; },
    setTimeout(run: () => void, delay: number) { assert.equal(delay, 10_000); timers.add(run); return run; },
    clearTimeout(run: () => void) { timers.delete(run); },
  });

  const app = screenFixture(new URL('../App.tsx', import.meta.url), 'default', {
    ...Object.fromEntries([
      './src/connections/pairingLinks', './src/platform/credential', './src/platform/cameraPermission',
      './src/screens/Onboarding', './src/screens/NativeWallet', './src/screens/NetworkSourceSheet',
      './src/notifications/service', './src/notifications/choices', './src/notifications/permissionReturn',
      './src/screens/WalletAccounts', './src/screens/WatchSession', './src/core/watchAccounts',
      './src/core/accountDirectory', './src/design/Studio', './src/screens/Settings', './src/core/index',
      './src/platform', 'expo-status-bar', 'expo-clipboard', 'react-native-qrcode-svg',
    ].map(name => [name, {}])),
    'react-native': { StyleSheet: { create: (styles: unknown) => styles } },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' },
    './src/ui': { colors: {}, Button: 'Button', Header: 'Header', Notice: 'Notice', Screen: 'Screen' },
    './src/screens/IdleActivityBoundary': { IdleActivityBoundary: 'IdleActivityBoundary' },
    './src/platform/localization': nativeTranslationFixture,
    './src/platform/security': adapter.exports,
  });
  const gate = screenElements(app.render({})).find(element => typeof element.type === 'function')!;
  const render = () => screenElements(app.renderChild(gate));
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));
  const retry = (nodes: ReturnType<typeof render>) => nodes.find(node => node.type === 'Button' && node.props.title === 'Retry security settings');
  try {
    const opening = render();
    assert.equal(opening.find(node => node.type === 'Notice')?.props.title, 'Opening security settings');
    assert.equal(opening.find(node => node.type === 'Notice')?.props.body, undefined);
    assert.equal(retry(opening), undefined);
    await settle();
    assert.equal(timers.size, 1);
    for (const timeout of timers) timeout();
    await settle();
    const failed = render();
    assert.equal(failed.find(node => node.type === 'Notice')?.props.title, 'Security settings unavailable');
    const button = retry(failed);
    assert(button);
    button.props.onPress();
    button.props.onPress();
    assert.equal(retry(render()), undefined);
    await settle();
    assert(render().some(node => node.type === 'IdleActivityBoundary'));
    assert.equal(reads.filter(key => key === PUBLIC_VIEW_LOCK_KEY).length, 2);
    assert.equal(adapter.exports.publicViewLock.getSnapshot().phase, 'locked');
    finishStaleRead('unlocked');
    await settle();
    assert.equal(adapter.exports.publicViewLock.getSnapshot().phase, 'locked');
    assert.equal(timers.size, 0);
  } finally {
    finishStaleRead('unlocked');
    app.close();
  }
});
