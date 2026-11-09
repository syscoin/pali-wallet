import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstance } from 'i18next';
import { createLanguagePreferences } from '../src/core/languagePreferences.ts';
import { DEFAULT_PALI_LANGUAGE, PALI_LANGUAGE_OPTIONS } from '../../../source/shared/languagePolicy.ts';
import { languageMessages } from './localizationFixture.ts';

const guard = () => undefined;
async function fixture(initial: string | null = null) {
  const engine = createInstance();
  await engine.init({ initImmediate: false, lng: 'en', fallbackLng: 'en', resources: { en: { translation: languageMessages('en') } }, interpolation: { escapeValue: false } });
  let raw = initial, writes = 0, lost = false, failedLoad = false;
  let beforeWrite: (() => Promise<void>) | undefined, beforeResources: (() => Promise<void>) | undefined;
  const preferences = createLanguagePreferences({
    engine,
    storage: { async get() { return raw; }, async set(value) { await beforeWrite?.(); raw = value; writes++; if (lost) throw Error('lost reply'); } },
    async load(language) { await beforeResources?.(); if (failedLoad) throw Error(); return languageMessages(language); },
  });
  return { engine, preferences, raw: () => raw, writes: () => writes,
    replace(value: string | null) { raw = value; }, loseReply() { lost = true; }, failLoad() { failedLoad = true; },
    beforeWrite(value: typeof beforeWrite) { beforeWrite = value; }, beforeResources(value: typeof beforeResources) { beforeResources = value; } };
}

test('native defaults to extension English without writing a preference', async () => {
  const f = await fixture(); assert.equal(f.engine.language, DEFAULT_PALI_LANGUAGE);
  const value = await f.preferences.load(); assert.equal(value.language, 'en'); assert.equal(f.writes(), 0);
});

test('actual engine restores every supported packaged locale and its English fallback keys', async () => {
  const englishKeys = Object.keys(languageMessages('en').mobile);
  for (const option of PALI_LANGUAGE_OPTIONS) {
    const f = await fixture(option.value); const value = await f.preferences.load();
    assert.equal(value.language, option.value); assert.equal(f.engine.language, option.value);
    assert.deepEqual(Object.keys(languageMessages(option.value).mobile), englishKeys);
    assert.equal(f.engine.t('generalMenu.languages'), languageMessages(option.value).generalMenu.languages);
    assert.equal(f.engine.t('mobile.setup.nativeOnlyDescription'), languageMessages('en').mobile.setup.nativeOnlyDescription);
    assert.equal(f.writes(), 0);
  }
});

test('choice becomes visible only after durable set and readback', async () => {
  const f = await fixture(), value = await f.preferences.load();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.beforeWrite(async () => { entered.resolve(); await release.promise; });
  const save = f.preferences.save(value, 'es', guard); await entered.promise;
  assert.equal(f.engine.language, 'en'); assert.equal(f.preferences.getSnapshot().value, value);
  release.resolve(); const saved = await save;
  assert.equal(saved.language, 'es'); assert.equal(f.raw(), 'es'); assert.equal(f.engine.t('mobile.navigation.wallet'), 'Cartera');
});

test('concurrent Settings owners cannot overwrite a successor with the same old snapshot', async () => {
  const f = await fixture(), value = await f.preferences.load();
  const first = f.preferences.save(value, 'es', guard), second = f.preferences.save(value, 'fr', guard);
  const refused = assert.rejects(second); await first; await refused;
  assert.equal(f.raw(), 'es'); assert.equal(f.engine.language, 'es'); assert.equal(f.writes(), 1);
});

test('external preference replacement fails the exact observation and reloads its saved language', async () => {
  const f = await fixture(), value = await f.preferences.load(); f.replace('fr');
  await assert.rejects(f.preferences.save(value, 'es', guard)); assert.equal(f.writes(), 0); assert.equal(f.engine.language, 'en');
  const current = await f.preferences.load(); assert.equal(current.language, 'fr');
  await assert.rejects(f.preferences.save(value, 'de', guard)); assert.equal(f.raw(), 'fr');
});

test('lost storage reply preserves the runtime language until confirmed reload', async () => {
  const f = await fixture(), value = await f.preferences.load(); f.loseReply();
  await assert.rejects(f.preferences.save(value, 'es', guard)); assert.equal(f.raw(), 'es'); assert.equal(f.engine.language, 'en');
  assert.equal(f.preferences.getSnapshot().status, 'unavailable');
  assert.equal((await f.preferences.load()).language, 'es'); assert.equal(f.engine.language, 'es');
});

test('cancel during packaged-resource loading prevents any preference write or locale change', async () => {
  const f = await fixture(), value = await f.preferences.load(); let active = true;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.beforeResources(async () => { entered.resolve(); await release.promise; });
  const save = f.preferences.save(value, 'es', () => { if (!active) throw Error('CANCELLED'); });
  const refused = assert.rejects(save); await entered.promise; active = false; release.resolve(); await refused;
  assert.equal(f.writes(), 0); assert.equal(f.engine.language, 'en');
});

test('cancel during storage keeps confirmed runtime state and requires reload of any written choice', async () => {
  const f = await fixture(), value = await f.preferences.load(); let active = true;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.beforeWrite(async () => { entered.resolve(); await release.promise; });
  const save = f.preferences.save(value, 'es', () => { if (!active) throw Error('CANCELLED'); });
  const refused = assert.rejects(save); await entered.promise; active = false; release.resolve(); await refused;
  assert.equal(f.raw(), 'es'); assert.equal(f.engine.language, 'en');
  assert.equal((await f.preferences.load()).language, 'es');
});

test('unsupported records and failed dictionaries are preserved instead of saved as English', async () => {
  const invalid = await fixture('unsupported'); await assert.rejects(invalid.preferences.load());
  assert.equal(invalid.raw(), 'unsupported'); assert.equal(invalid.writes(), 0); assert.equal(invalid.engine.language, 'en');
  const f = await fixture(), value = await f.preferences.load(); f.failLoad();
  await assert.rejects(f.preferences.save(value, 'es', guard)); assert.equal(f.raw(), null); assert.equal(f.engine.language, 'en');
});

test('asynchronous guards and forged snapshots never reach persistence', async () => {
  const f = await fixture(), value = await f.preferences.load();
  await assert.rejects(f.preferences.save({ ...value }, 'es', guard));
  await assert.rejects(f.preferences.save(value, 'es', (() => Promise.resolve()) as unknown as () => void));
  assert.equal(f.writes(), 0); assert.equal(f.engine.language, 'en');
});

test('a view observer cannot prevent confirmed language publication', async () => {
  const f = await fixture(); f.preferences.subscribe(() => { throw Error('view'); });
  const value = await f.preferences.load(); await f.preferences.save(value, 'de', guard);
  assert.equal(f.preferences.getSnapshot().value?.language, 'de');
});
