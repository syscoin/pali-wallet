import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';

const { AndroidConfig } = createRequire(import.meta.url)('expo/config-plugins');
type Item = { $: Record<string, string | number>; _: string };
type Style = { $: { name: string; parent?: string }; item: Item[] };
type Mod = { modResults: { resources: { $: Record<string, string>; style: Style[] } } };

function loadPlugin() {
  let apply: ((mod: Mod) => Mod) | undefined;
  const module = { exports: undefined as unknown as (config: object) => object };
  runInNewContext(
    readFileSync(new URL('../plugins/withAndroidTextMetrics.cjs', import.meta.url), 'utf8'),
    { module, require(name: string) {
      assert.equal(name, 'expo/config-plugins');
      return { AndroidConfig, withAndroidStyles(config: object, callback: (mod: Mod) => Mod) {
        apply = callback;
        return config;
      } };
    } }
  );
  const config = {};
  assert.equal(module.exports(config), config);
  assert.ok(apply);
  return apply;
}

test('Android text metrics configure the actual AppTheme without replacing other styles', () => {
  const apply = loadPlugin();
  for (const existing of [false, true]) {
    const color: Item = { $: { name: 'colorPrimary' }, _: '#123456' };
    const appTheme: Style = {
      $: { name: 'AppTheme', parent: 'Theme.AppCompat.DayNight.NoActionBar' },
      item: [color, ...(existing ? [{ $: { name: 'android:useBoundsForWidth' }, _: 'true' }] : [])],
    };
    const other: Style = { $: { name: 'OtherTheme' }, item: [{ $: { name: 'android:useBoundsForWidth' }, _: 'true' }] };
    const mod: Mod = { modResults: { resources: {
      $: { 'xmlns:tools': 'http://schemas.android.com/tools' },
      style: [other, appTheme],
    } } };
    const untouchedTheme = JSON.stringify(other);

    assert.equal(apply(mod), mod);
    assert.equal(mod.modResults.resources.style.length, 2);
    assert.equal(appTheme.$.parent, 'Theme.AppCompat.DayNight.NoActionBar');
    assert.equal(appTheme.item[0], color);
    const policy = appTheme.item.filter(item => item.$.name === 'android:useBoundsForWidth');
    assert.equal(policy.length, 1);
    assert.ok(policy[0]);
    assert.equal(policy[0]._, 'false');
    assert.equal(policy[0].$['tools:targetApi'], 35);
    assert.equal(JSON.stringify(other), untouchedTheme);

    const once = JSON.stringify(mod.modResults);
    apply(mod);
    assert.equal(JSON.stringify(mod.modResults), once);
  }
});

test('the mobile config keeps text metrics and manifest safety plugins registered', () => {
  const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  assert.ok(config.expo.plugins.includes('./plugins/withAndroidTextMetrics.cjs'));
  assert.ok(config.expo.plugins.includes('./plugins/withMobileSafety.cjs'));
});
