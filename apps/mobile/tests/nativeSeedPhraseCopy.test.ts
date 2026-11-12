import assert from 'node:assert/strict';
import test from 'node:test';
import type { SetStringOptions } from 'expo-clipboard';
import type { SeedBackupPresentation } from '../src/custody/seedBackup.ts';
import { SECRET_CLIPBOARD_LIFETIME_MS } from '../../../source/shared/secretClipboard.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { nativeSecretClipboardFixture } from './fixtures/secretClipboard.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const label = (key: string) => nativeTranslationFixture.nativeI18n.t(key);
function fixture(platform = 'ios') {
  const events = new Map<string, Set<(state: string) => void>>();
  const app = { currentState: 'active', addEventListener(event: string, callback: (value: string) => void) {
    const listeners = events.get(event) ?? new Set(); listeners.add(callback); events.set(event, listeners);
    return { remove() { listeners.delete(callback); } };
  } };
  const writes: { value: string; options: SetStringOptions; time: number }[] = [];
  let result: () => Promise<boolean> = async () => true;
  let presentation: SeedBackupPresentation = Object.freeze({ id: 'first-presentation', words: Object.freeze(phrase.split(' ')) });
  let live = true;
  const screen = screenFixture(new URL('../src/screens/NativeSeedPhraseCopy.tsx', import.meta.url), 'NativeSeedPhraseCopy', {
    'react-native': { AppState: app, Platform: { OS: platform } },
    '../platform/secretClipboard': nativeSecretClipboardFixture(async (value, options) => { writes.push({ value, options, time: Date.now() }); return result(); }),
    '../ui': { Button: 'Button', Text: 'Text', styles: {} },
  });
  const render = () => screenElements(screen.render({ presentation, isCurrent: (value: typeof presentation) => live && value === presentation }));
  const copy = () => { const control = render().find(node => node.type === 'Button'); assert(control); return control; };
  return { render, copy, writes, close: screen.close,
    result(next: () => Promise<boolean>) { result = next; },
    retire() { live = false; },
    replace() { presentation = Object.freeze({ id: 'second-presentation', words: Object.freeze([...Array(11).fill('legal'), 'winner']) }); render(); },
    emit(event: string, value = '') { if (event === 'change') app.currentState = value; for (const callback of events.get(event) ?? []) callback(value); render(); },
  };
}

for (const platform of ['ios', 'android']) test(`${platform} copies the current authenticated phrase with warning and bounded native options`, async () => {
  const f = fixture(platform);
  try {
    assert(f.render().some(node => node.children.includes(label('secretClipboard.warning'))));
    assert.equal(f.copy().props.title, label('secretClipboard.copyPhrase'));
    assert.equal(JSON.stringify(f.copy().props).includes(phrase), false);
    const start = Date.now(); await f.copy().props.onPress();
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0]!.value, phrase);
    const { options, time } = f.writes[0]!;
    assert.equal(options.inputFormat, 'plainText'); assert.equal(options.android?.isSensitive, true);
    assert.deepEqual(Object.keys(options.android!), ['isSensitive']);
    assert.equal(options.ios?.localOnly, true);
    assert(options.ios!.expiresAt!.getTime() >= start + SECRET_CLIPBOARD_LIFETIME_MS);
    assert(options.ios!.expiresAt!.getTime() <= time + SECRET_CLIPBOARD_LIFETIME_MS);
    assert.equal(f.copy().props.title, label('secretClipboard.copyPhrase'));
    assert(f.render().some(node => node.props.accessibilityLiveRegion === 'polite' && node.children.includes(label('components.copied'))));
  } finally { f.close(); }
});

for (const boundary of ['hidden', 'replacement', 'background', 'inactive', 'blur', 'unmount'] as const)
  test(`a retained phrase Copy callback refuses ${boundary}`, async () => {
    const f = fixture('android');
    try {
      const copy = f.copy().props.onPress;
      if (boundary === 'hidden') f.retire();
      if (boundary === 'replacement') f.replace();
      if (boundary === 'background' || boundary === 'inactive') f.emit('change', boundary);
      if (boundary === 'blur') f.emit('blur');
      if (boundary === 'unmount') f.close();
      await copy(); assert.equal(f.writes.length, 0);
    } finally { f.close(); }
  });

for (const outcome of ['false', 'reject'] as const) test(`phrase copy ${outcome} exposes only generic localized feedback`, async () => {
  const f = fixture();
  try {
    f.result(async () => { if (outcome === 'reject') throw Error(phrase); return false; });
    await f.copy().props.onPress();
    const errors = f.render().filter(node => node.props.accessibilityRole === 'alert');
    assert.equal(errors.length, 1); assert.deepEqual(errors[0]!.children, [label('transactions.copyFailed')]);
    assert.equal(f.copy().props.disabled, false); assert.equal(f.copy().props.title, label('secretClipboard.copyPhrase'));
  } finally { f.close(); }
});

test('phrase duplicate taps share one write and a retired completion cannot affect a newer presentation', async () => {
  const f = fixture(), held = Promise.withResolvers<boolean>();
  try {
    f.result(() => held.promise); const copy = f.copy().props.onPress;
    const pending = copy(), duplicate = copy(); assert.equal(f.writes.length, 1);
    f.replace(); f.result(async () => true); await f.copy().props.onPress();
    held.reject(Error(phrase)); await Promise.all([pending, duplicate]);
    assert.equal(f.writes.length, 2); assert.equal(f.copy().props.title, label('secretClipboard.copyPhrase'));
    assert.equal(f.render().some(node => node.props.accessibilityRole === 'alert'), false);
    f.emit('change', 'background');
    assert.equal(f.render().some(node => node.children.includes(label('components.copied'))), false);
  } finally { held.resolve(false); f.close(); }
});

test('native clipboard writer checks liveness before reading and after the native write', async () => {
  let reads = 0, writes = 0, live = false;
  const held = Promise.withResolvers<boolean>();
  const writer = nativeSecretClipboardFixture(async () => { writes++; return held.promise; });
  const read = () => { reads++; return phrase; };
  await assert.rejects(writer.copyNativeSecret(read, () => live), /COPY_CANCELLED/);
  assert.equal(reads, 0); assert.equal(writes, 0);
  live = true; const pending = writer.copyNativeSecret(read, () => live);
  assert.equal(reads, 1); assert.equal(writes, 1);
  live = false; held.resolve(true);
  await assert.rejects(pending, /COPY_CANCELLED/);
  assert.equal(writes, 1, 'retirement must not add a clipboard overwrite');
});
