import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

test('Expo registers the iOS passkey module, not only its native pod', () => {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('expo-modules-autolinking/package.json')), 'bin/expo-modules-autolinking.js');
  const resolved = JSON.parse(execFileSync(process.execPath, [cli, 'resolve', '--platform', 'apple', '--json'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 15_000,
  })) as { modules: { packageName: string; pods: { podName: string }[]; modules: { class: string }[] }[] };
  const passkeys = resolved.modules.find((entry) => entry.packageName === 'pali-passkeys');
  assert(passkeys, 'Expo must include passkeys in its generated module provider');
  assert(passkeys.pods.some((pod) => pod.podName === 'PaliPasskeys'));
  assert(passkeys.modules.some((module) => module.class === 'PaliPasskeysModule'));
});

test('passkey associations are fixed, idempotent and preserve other native configuration', async () => {
  type Metadata = { $: Record<string, string> };
  type Manifest = { modResults: { manifest: { application: { $: Record<string, string>; 'meta-data'?: Metadata[] }[] } } };
  type Strings = { modResults: { resources: { string?: { $: { name: string; translatable?: string }; _: string }[] } } };
  const { format, parseXMLAsync, unescapeAndroidString } = createRequire(import.meta.url)('@expo/config-plugins/build/utils/XML.js') as {
    format(value: Strings['modResults']): string;
    parseXMLAsync(value: string): Promise<Strings['modResults']>;
    unescapeAndroidString(value: string): string;
  };
  let manifest!: (value: Manifest) => Manifest, strings!: (value: Strings) => Strings;
  const module = { exports: undefined as unknown as (config: { ios: { associatedDomains: string[] } }) => { ios: { associatedDomains: string[] } } };
  runInNewContext(readFileSync(new URL('../plugins/withNativePasskeys.cjs', import.meta.url), 'utf8'), { module,
    require(name: string) { assert.equal(name, 'expo/config-plugins'); return {
      withAndroidManifest(config: object, apply: typeof manifest) { manifest = apply; return config; },
      withStringsXml(config: object, apply: typeof strings) { strings = apply; return config; },
    }; } });
  const config = { ios: { associatedDomains: ['applinks:example.com'] } };
  const configured = module.exports(module.exports(config));
  assert.deepEqual([...configured.ios.associatedDomains], ['applinks:example.com', 'webcredentials:paliwallet.com']);
  const m: Manifest = { modResults: { manifest: { application: [{ $: { 'android:label': 'Pali' } }] } } };
  manifest(manifest(m));
  const metadata = m.modResults.manifest.application[0]!['meta-data']!;
  assert.equal(metadata.length, 1); assert.equal(metadata[0]!.$['android:resource'], '@string/pali_passkey_asset_statements');
  const s: Strings = { modResults: { resources: {} } };
  strings(strings(s)); assert.equal(s.modResults.resources.string!.length, 1);
  const expected = [{ include: 'https://paliwallet.com/.well-known/assetlinks.json' }];
  const row = s.modResults.resources.string![0]!;
  assert.equal(row.$.translatable, 'false');
  const xml = format(s.modResults);
  assert(xml.includes('\\"include\\"'), 'Android JSON quotes must remain escaped in emitted XML');
  const parsed = await parseXMLAsync(xml);
  assert.equal(parsed.resources.string![0]!._, row._);
  assert.deepEqual(JSON.parse(unescapeAndroidString(parsed.resources.string![0]!._)), expected);
  assert.equal(format(strings({ modResults: parsed }).modResults), xml);
  // Repair only this plugin's exact earlier unescaped value, preserving conflict refusal.
  row._ = JSON.stringify(expected); delete row.$.translatable; strings(s);
  assert.equal(row.$.translatable, 'false');
  assert.equal(format(s.modResults), xml);
  row._ = JSON.stringify([{ include: 'https://untrusted.example/.well-known/assetlinks.json' }]);
  assert.throws(() => strings(s), /Conflicting/);
  metadata[0]!.$['android:resource'] = '@string/untrusted';
  assert.throws(() => manifest(m), /Conflicting/);
});
