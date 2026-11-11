import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';

type ManifestMod = { modResults: { manifest: { application?: { $: Record<string, string> }[] } } };
type ProguardMod = { modRequest: { platformProjectRoot: string } };

function loadPlugin() {
  let manifest: ((mod: ManifestMod) => ManifestMod) | undefined;
  let proguard: ((mod: ProguardMod) => Promise<ProguardMod>) | undefined;
  const module = { exports: undefined as unknown as (config: object) => object };
  runInNewContext(readFileSync(new URL('../plugins/withMobileSafety.cjs', import.meta.url), 'utf8'), {
    module,
    require(name: string) {
      if (name === 'node:fs/promises') return fs;
      if (name === 'node:path') return path;
      assert.equal(name, 'expo/config-plugins');
      return {
        withAndroidManifest(config: object, apply: typeof manifest) { manifest = apply; return config; },
        withDangerousMod(config: object, [platform, apply]: [string, typeof proguard]) {
          assert.equal(platform, 'android'); proguard = apply; return config;
        },
      };
    },
  });
  const config = { android: { minifyEnabled: true } };
  assert.equal(module.exports(config), config);
  assert.equal(config.android.minifyEnabled, true);
  assert(manifest); assert(proguard);
  return { manifest, proguard };
}

test('mobile safety preserves manifest policy and only retains the reflected WorkManager constructor', async () => {
  const { manifest, proguard } = loadPlugin();
  const app = { $: { 'android:label': 'Pali' } as Record<string, string> };
  manifest({ modResults: { manifest: { application: [app] } } });
  assert.equal(app.$['android:usesCleartextTraffic'], 'false');
  assert.equal(app.$['android:label'], 'Pali');
  assert.throws(() => manifest({ modResults: { manifest: {} } }), /Expected one Android application/);

  const root = await fs.mkdtemp(path.join(tmpdir(), 'pali-mobile-safety-'));
  try {
    await fs.mkdir(path.join(root, 'app'));
    const filename = path.join(root, 'app', 'proguard-rules.pro');
    const original = '# Existing project rule\n-keep class com.pali.Existing { *; }\n';
    await fs.writeFile(filename, original);
    const mod = { modRequest: { platformProjectRoot: root } };
    assert.equal(await proguard(mod), mod);
    const first = await fs.readFile(filename, 'utf8');
    assert(first.startsWith(original));
    assert(first.endsWith('-keep class androidx.work.impl.WorkDatabase_Impl {\n    public <init>();\n}\n'));
    assert(!/-dont(?:optimize|shrink|obfuscate)|androidx\.(?:work|room)\.\*\*/.test(first));
    await proguard(mod);
    assert.equal(await fs.readFile(filename, 'utf8'), first);
    assert.equal(first.split('androidx.work.impl.WorkDatabase_Impl').length, 2);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('mobile safety fails visibly when the generated Proguard template is missing', async () => {
  const { proguard } = loadPlugin();
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pali-mobile-safety-'));
  try {
    await assert.rejects(proguard({ modRequest: { platformProjectRoot: root } }), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
