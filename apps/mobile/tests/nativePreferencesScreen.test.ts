import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { URL as NodeURL } from 'node:url';
import ts from 'typescript';
import { createInstance } from 'i18next';
import { PALI_LANGUAGE_OPTIONS } from '../../../source/shared/languagePolicy.ts';
import { assertSynchronousEvmFeeGuard } from '../../../source/shared/evmFeeGuard.ts';
import { createLanguagePreferences } from '../src/core/languagePreferences.ts';
import { languageMessages } from './localizationFixture.ts';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void };
const all = (value: any): Element[] => Array.isArray(value) ? value.flatMap(all)
  : value && typeof value === 'object' && 'children' in value ? [value, ...value.children.flatMap(all), ...all(value.props.footer)] : [];
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function fixture() {
  const engine = createInstance(); await engine.init({ initImmediate: false, lng: 'en', fallbackLng: 'en', resources: { en: { translation: languageMessages('en') } } });
  let raw: string | null = null, writes = 0, backs = 0, active = 'active', owner = true;
  let waitWrite: (() => Promise<void>) | undefined;
  const preferences = createLanguagePreferences({ engine, load: async (language) => languageMessages(language),
    storage: { get: async () => raw, async set(value) { await waitWrite?.(); raw = value; writes++; } } });
  await preferences.load();
  const cells: Cell[] = [], effects: (() => void)[] = []; let cursor = 0;
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const react = {
    createElement: (type: unknown, props: object | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) { const value = cell(); if (!Object.hasOwn(value, 'value')) value.value = initial; return [value.value, (next: unknown) => { value.value = next; }]; },
    useRef(initial: unknown) { const value = cell(); value.value ??= { current: initial }; return value.value; },
    useEffect(run: () => void | (() => void), deps?: readonly unknown[]) {
      const value = cell(); if (deps && value.deps && deps.every((item, index) => Object.is(item, value.deps![index]))) return;
      value.deps = deps; effects.push(() => { value.cleanup?.(); value.cleanup = run() || undefined; });
    },
    useSyncExternalStore(_subscribe: unknown, get: () => unknown) { cell(); return get(); },
  };
  const listeners = new Map<string, Set<(state: string) => void>>();
  const native = { Platform: { OS: 'android' }, AppState: { get currentState() { return active; },
    addEventListener(event: string, callback: (state: string) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback);
      return { remove() { listeners.get(event)?.delete(callback); } };
    } } };
  const imports: Record<string, unknown> = { react, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../../../source/shared/languagePolicy': { PALI_LANGUAGE_OPTIONS }, '../../../../source/shared/evmFeeGuard': { assertSynchronousEvmFeeGuard },
    '../platform/localization': { nativeLanguagePreferences: preferences, initializeNativeLanguage: async () => undefined,
      useNativeTranslation: () => ({ t: engine.t.bind(engine), i18n: engine }) },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Row', 'Screen', 'Text'].map((name) => [name, name])), styles: {}, colors: {} } };
  const module = { exports: {} as any };
  const source = readFileSync(new NodeURL('../src/screens/NativePreferences.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(code, { module, exports: module.exports, Error, require(name: string) { assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  const render = () => { cursor = 0; const tree = module.exports.NativePreferences({ onBack() { backs++; }, assertCurrent() { if (!owner) throw Error('CANCELLED'); } }) as Element;
    effects.splice(0).forEach((run) => run()); return tree; };
  return { render, engine, preferences, counts: () => ({ writes, backs, raw }),
    choose(name: string) { const row = all(render()).find((node) => node.props.title === name)!; assert(row?.props.onPress); row.props.onPress(); },
    save() { const screen = all(render()).find((node) => node.type === 'Screen')!; screen.props.footer.props.onPress(); },
    revoke() { owner = false; }, waitWrite(value: typeof waitWrite) { waitWrite = value; },
    state(value: string) { active = value; for (const listener of listeners.get('change') ?? []) listener(value); },
    close() { cells.forEach((value) => value.cleanup?.()); } };
}

test('language page previews a choice locally and applies the confirmed engine preference', async () => {
  const f = await fixture(); f.render(); f.choose('Español'); assert.deepEqual(f.counts(), { writes: 0, backs: 0, raw: null });
  f.save(); await tick(); assert.deepEqual(f.counts(), { writes: 1, backs: 1, raw: 'es' });
  assert.equal(f.engine.t('mobile.settings.title'), 'Ajustes'); f.close();
});

test('the original Settings owner can retire a held Save before any mutation', async () => {
  const f = await fixture(); f.render(); f.choose('Español'); f.revoke(); f.save(); await tick();
  assert.equal(f.counts().writes, 0); assert.equal(f.engine.language, 'en'); f.close();
});

test('background cancellation suppresses late application and leaves confirmed reload reachable', async () => {
  const f = await fixture(); f.render(); f.choose('Español');
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.waitWrite(async () => { entered.resolve(); await release.promise; }); f.save(); await entered.promise;
  f.state('background'); release.resolve(); await tick();
  assert.equal(f.counts().backs, 0); assert.equal(f.engine.language, 'en'); assert.equal(f.preferences.getSnapshot().status, 'unavailable');
  f.state('active'); const reload = all(f.render()).find((node) => node.props.title === 'Reload')!;
  assert.equal(reload.props.disabled, false); reload.props.onPress(); await tick(); assert.equal(f.engine.language, 'es'); f.close();
});

test('unmount revokes an outstanding Save without late navigation', async () => {
  const f = await fixture(); f.render(); f.choose('Français');
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.waitWrite(async () => { entered.resolve(); await release.promise; }); f.save(); await entered.promise;
  f.close(); release.resolve(); await tick(); assert.equal(f.counts().backs, 0); assert.equal(f.engine.language, 'en');
});
