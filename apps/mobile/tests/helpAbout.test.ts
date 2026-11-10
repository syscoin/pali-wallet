import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL as NodeURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { PALI_INFORMATION } from '../../../source/shared/paliInformation.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void };
const source = (path: string) => readFileSync(new NodeURL(path, import.meta.url), 'utf8');
function setup(component = 'HelpAbout', watchOnly = true, options: { backupRequired?: boolean; navigation?: boolean; autoLock?: boolean } = {}) {
  const cells: Cell[] = [], effects: (() => void)[] = [];
  let cursor = 0, active = 'active', backs = 0, closes = 0, security = 0, autoLock = 0, connections = 0, backups = 0, blocked = false;
  let pending: Promise<unknown> = Promise.resolve(true);
  const actions: { kind: string; value: string }[] = [];
  const listeners = new Map<string, Set<(value: string) => void>>();
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const react = {
    createElement: (type: unknown, props: object | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useRef(value: unknown) { const c = cell(); c.value ??= { current: value }; return c.value; },
    useState(initial: unknown) { const c = cell(); if (!Object.hasOwn(c, 'value')) c.value = initial;
      return [c.value, (value: unknown) => { c.value = typeof value === 'function' ? value(c.value) : value; }]; },
    useLayoutEffect(run: () => void | (() => void), deps?: readonly unknown[]) { const c = cell();
      if (c.deps && deps && deps.length === c.deps.length && deps.every((d, i) => Object.is(d, c.deps![i]))) return;
      c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = run() || undefined; }); },
  };
  const native = { AppState: { get currentState() { return active; }, addEventListener(event: string, listener: (value: string) => void) {
    if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener);
    return { remove() { listeners.get(event)!.delete(listener); } };
  } }, Platform: { OS: 'android' }, View: 'View', Linking: { async openURL(value: string) {
    actions.push({ kind: 'open', value }); if (blocked) throw Error('Private diagnostic must not appear'); return await pending;
  } } };
  let registeredBack: (() => boolean) | undefined, immersive = false;
  const navigation = { registerBack(back: () => boolean) { registeredBack = back; return () => { registeredBack = undefined; }; }, setImmersive(value: boolean) { immersive = value; } };
  const ui = { ...Object.fromEntries(['Button', 'Card', 'Header', 'Screen', 'Text', 'Notice', 'Row'].map((v) => [v, v])), colors: {} };
  const deps: Record<string, unknown> = { react, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-clipboard': { async setStringAsync(value: string) { actions.push({ kind: 'copy', value }); if (blocked) return false; return await pending; } },
    '../../../../source/shared/paliInformation': { PALI_INFORMATION }, '../../app.json': JSON.parse(source('../app.json')), '../ui': ui, './HelpAbout': { HelpAbout: 'HelpAbout' }, './DisplayCurrency': { DisplayCurrency: 'DisplayCurrency' },
    './NativePreferences': { NativePreferences: 'NativePreferences' }, './WalletBackupBadge': { WalletBackupBadge: 'WalletBackupBadge' }, '../platform/localization': nativeTranslationFixture };
  const module = { exports: {} as Record<string, (props: object) => Element> };
  const code = ts.transpileModule(source(`../src/screens/${component}.tsx`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  runInNewContext(code, { module, exports: module.exports, require(name: string) { assert.ok(Object.hasOwn(deps, name), `Unexpected public-screen dependency ${name}`); return deps[name]; } });
  const props = { onBack() { backs++; }, accountLabel: 'Public account', watchOnly, navigation: options.navigation === false ? undefined : navigation,
    backupRequired: options.backupRequired, onBackup() { backups++; }, onSecurity() { security++; }, onAutoLock: options.autoLock === false ? undefined : () => { autoLock++; }, onConnections() { connections++; }, onLock() { closes++; } };
  return { render() { cursor = 0; const tree = module.exports[component]!(props); effects.splice(0).forEach((run) => run()); return tree; }, actions,
    pending(value: Promise<unknown>) { pending = value; }, block() { blocked = true; },
    emit(event: string, value = '') { if (event === 'change') active = value; for (const fn of listeners.get(event) ?? []) fn(value); },
    back() { return registeredBack?.(); }, immersive: () => immersive, backs: () => backs, closes: () => closes, security: () => security, autoLock: () => autoLock, connections: () => connections, backups: () => backups,
    dispose() { cells.forEach((c) => c.cleanup?.()); }, listeners: () => [...listeners.values()].reduce((n, set) => n + set.size, 0) };
}
function all(value: unknown): Element[] {
  if (!value || typeof value !== 'object' || !('children' in value)) return [];
  const el = value as Element; return [el, ...el.children.flat(Infinity).flatMap(all), ...all(el.props.footer)];
}
const text = (value: unknown) => all(value).flatMap((e) => e.children.flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number')).join(' ');
function press(tree: Element, title: string) { const node = all(tree).find((e) => e.props.title === title); assert.ok(node, title); return node.props.onPress(); }
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('actual Help uses mobile metadata and starts no I/O', () => {
  const f = setup(), tree = f.render(); assert.match(text(tree), /Version\s+5\.0\.0/); assert.doesNotMatch(text(tree), /Development build/);
  assert.match(text(tree), /https:\/\/discord.com\/invite\/syscoin/); assert.equal(f.actions.length, 0);
  assert.ok(all(tree).find((e) => e.type === 'Screen')?.props.footer); press(tree, 'Done'); assert.equal(f.backs(), 1); f.dispose();
});
test('mobile package and lock metadata match the app version shown in Help', () => {
  const app = JSON.parse(source('../app.json')), manifest = JSON.parse(source('../package.json')), lock = JSON.parse(source('../package-lock.json'));
  assert.equal(app.expo.version, '5.0.0');
  assert.equal(manifest.version, app.expo.version);
  assert.equal(lock.version, app.expo.version);
  assert.equal(lock.packages[''].version, app.expo.version);
});
for (const [title, kind, value] of [['Get support', 'open', PALI_INFORMATION.supportUrl], ['Pali documentation', 'open', PALI_INFORMATION.documentationUrl], ['Routescan', 'open', PALI_INFORMATION.dataProvider.url], ['Copy support link', 'copy', PALI_INFORMATION.supportUrl]]) {
  test(`actual ${title} uses only its exact public value`, async () => { const f = setup(); press(f.render(), title!); await tick(); assert.deepEqual(f.actions, [{ kind, value }]); assert.match(text(f.render()), kind === 'copy' ? /Support link copied\./ : /Link opened\./); f.dispose(); });
}
for (const title of ['Get support', 'Copy support link']) test(`${title} failure permits a deliberate retry`, async () => {
  const f = setup(); f.block(); press(f.render(), title); await tick(); const tree = f.render(); assert.match(text(tree), /Could not/); assert.doesNotMatch(text(tree), /Private diagnostic/);
  assert.equal(all(tree).find((e) => e.props.title === title)?.props.disabled, false); press(tree, title); await tick(); assert.equal(f.actions.length, 2); f.dispose();
});
test('a pending action refuses repeat dispatch until acknowledgement', async () => {
  const f = setup(); let release!: (v: unknown) => void; f.pending(new Promise((done) => { release = done; })); const tree = f.render();
  press(tree, 'Get support'); press(tree, 'Copy support link'); assert.equal(f.actions.length, 1);
  assert.equal(all(f.render()).find((e) => e.props.title === 'Copy support link')?.props.disabled, true); release(true); await tick(); assert.equal(f.actions.length, 1); f.dispose();
});
for (const interruption of ['background', 'inactive', 'blur', 'unmount']) test(`${interruption} prevents stale feedback and hidden dispatch`, async () => {
  const f = setup(); let release!: (v: unknown) => void; f.pending(new Promise((done) => { release = done; })); const tree = f.render(); press(tree, 'Get support');
  if (interruption === 'unmount') f.dispose(); else if (interruption === 'blur') f.emit('blur'); else f.emit('change', interruption);
  press(tree, 'Copy support link'); assert.equal(f.actions.length, 1); release(true); await tick(); assert.doesNotMatch(text(f.render()), /Link opened|Support link copied/);
  if (interruption !== 'unmount') { f.emit('change', 'active'); f.emit('focus'); assert.equal(f.actions.length, 1); }
  f.dispose(); assert.equal(f.listeners(), 0);
});
test('actual Settings hardware Back returns from Help before leaving Settings; privacy exit retained', () => {
  const f = setup('RealSettings'); let tree = f.render(); press(tree, 'Help & about'); tree = f.render(); assert.equal(tree.type, 'HelpAbout'); assert.equal(f.immersive(), true);
  assert.equal(f.back(), true); tree = f.render(); assert.equal(f.immersive(), false); assert.equal(f.backs(), 0); press(tree, 'Hide accounts'); assert.equal(f.closes(), 1);
  assert.equal(f.back(), true); assert.equal(f.backs(), 1); f.dispose();
});

test('root Settings omits the Back arrow and forwards the required-backup action', () => {
  const f = setup('RealSettings', false, { backupRequired: true });
  const tree = f.render(), header = all(tree).find(node => node.type === 'Header'); assert(header);
  assert.equal(header.props.onBack, undefined);
  const badge = all(tree).find(node => node.type === 'WalletBackupBadge'); assert(badge);
  badge.props.onPress(); assert.equal(f.backups(), 1);
  press(tree, 'Help & about'); assert.equal(typeof f.render().props.onBack, 'function'); f.dispose();
  const backedUp = setup('RealSettings', false);
  assert.equal(all(backedUp.render()).some(node => node.type === 'WalletBackupBadge'), false); backedUp.dispose();
  const standalone = setup('RealSettings', false, { navigation: false });
  assert.equal(typeof all(standalone.render()).find(node => node.type === 'Header')!.props.onBack, 'function'); standalone.dispose();
});
test('actual Settings hardware Back closes Display currency before leaving Settings', () => {
  const f = setup('RealSettings');
  press(f.render(), 'Display currency');
  assert.equal(f.render().type, 'DisplayCurrency');
  assert.equal(f.immersive(), true);
  assert.equal(f.back(), true);
  assert.notEqual(f.render().type, 'DisplayCurrency');
  assert.equal(f.immersive(), false);
  assert.equal(f.backs(), 0);
  assert.equal(f.actions.length, 0);
  f.dispose();
});

test('Settings language leaf revokes its exact owner synchronously on hardware Back', () => {
  const f=setup('RealSettings');press(f.render(),'Languages');const page=f.render();assert.equal(page.type,'NativePreferences');
  page.props.assertCurrent();assert.equal(f.back(),true);assert.throws(page.props.assertCurrent);assert.equal(f.backs(),0);f.dispose();
});
test('both real session owners pass existing navigation to the shared settings component', () => {
  for (const owner of ['NativeWallet.native', 'WatchSession']) assert.match(source(`../src/screens/${owner}.tsx`), /<RealSettings navigation=\{shell\.navigation\}/);
});

test('custody Settings keeps security and connected apps without a duplicate Auto-lock entry', () => {
  const f = setup('RealSettings', false); let tree = f.render();
  press(tree, 'Security & backups'); press(tree, 'Connected apps'); assert.equal(f.security(), 1); assert.equal(f.connections(), 1);
  assert(!all(tree).some(node => node.props.title === 'Auto-lock')); assert.equal(f.autoLock(), 0);
  press(tree, 'Help & about'); tree = f.render(); (tree.props.onBack as () => void)(); tree = f.render();
  press(tree, 'Lock wallet'); assert.equal(f.closes(), 1); assert.equal(f.security(), 1); assert.equal(f.autoLock(), 0); f.dispose();
});
test('watch-only Settings exposes its existing Auto-lock route with a clock icon', () => {
  const f = setup('RealSettings', true);
  const rows = all(f.render()).filter(node => node.type === 'Row' && node.props.title === 'Auto-lock');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.props.icon, 'clock');
  rows[0]!.props.onPress();
  assert.equal(f.autoLock(), 1);
  assert.equal(f.immersive(), false);
  f.dispose();
  const unavailable = setup('RealSettings', true, { autoLock: false });
  assert.equal(all(unavailable.render()).some(node => node.props.title === 'Auto-lock'), false);
  unavailable.dispose();
});
test('copy feedback is adjacent to its initiating control and uses the existing live region', async () => {
  const f = setup(); press(f.render(), 'Copy support link'); await tick(); const tree = f.render();
  const status = all(tree).find((node) => node.props.testID === 'help-copy-feedback')!;
  assert.ok(status); assert.equal(status.props.accessibilityLiveRegion, 'polite');
  const parent = all(tree).find((node) => node.children.includes(status))!;
  assert.equal((parent.children[parent.children.indexOf(status) - 1] as Element).props.title, 'Copy support link');
  assert.equal(all(tree).filter((node) => node.props.accessibilityLiveRegion === 'polite').length, 1); f.dispose();
});
