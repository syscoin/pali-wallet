const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

// WorkManager's Room 2.6 generated database is constructed by reflection.
// Keep only that exact class name and its public zero-argument constructor.
const workDatabaseConstructor = `# Pali: WorkManager Room reflective constructor
-keep class androidx.work.impl.WorkDatabase_Impl {
    public <init>();
}`;

// Explicit in release manifests; debug tooling may provide its own local override.
module.exports = function withMobileSafety(config) {
  config = withAndroidManifest(config, (result) => {
    const app = result.modResults.manifest.application?.[0];
    if (!app) throw new Error('Expected one Android application');
    app.$['android:usesCleartextTraffic'] = 'false';
    return result;
  });
  return withDangerousMod(config, ['android', async (result) => {
    const filename = path.join(result.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
    const rules = await readFile(filename, 'utf8');
    if (!rules.includes(workDatabaseConstructor))
      await writeFile(filename, `${rules.trimEnd()}\n\n${workDatabaseConstructor}\n`);
    return result;
  }]);
};
