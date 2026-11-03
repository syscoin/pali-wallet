const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const workflow = fs.readFileSync(require.resolve('../../../.github/workflows/mobile-native-qualification.yml'), 'utf8');
const section = workflow.split('      - name: Start isolated API 35 emulator\n')[1].split('\n      - name:')[0];
const script = section.slice(section.indexOf('        run: |\n') + '        run: |\n'.length).split('\n').map((line) => line.slice(10)).join('\n');

test('emulator workflow is valid shell and shares explicit AVD home before creation/discovery', () => {
  assert.equal(spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' }).status, 0);
  const exported = script.indexOf('export ANDROID_AVD_HOME="$RUNNER_TEMP/pali-android-avd"');
  const create = script.indexOf('avdmanager create avd');
  const assertion = script.indexOf('test -f "$ANDROID_AVD_HOME/PaliQualification.ini"');
  const launch = script.indexOf('"$ANDROID_HOME/emulator/emulator" -avd PaliQualification');
  assert(exported >= 0 && exported < create && create < assertion && assertion < launch);
  assert.match(script, /--path "\$ANDROID_AVD_HOME\/PaliQualification\.avd"/);
  assert.match(script, /grep -Fxq PaliQualification/);
});

for (const mode of ['created', 'missing']) {
  test(`AVD preflight ${mode === 'created' ? 'uses the same task directory' : 'rejects an undiscoverable AVD before launch'}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-avd-path-'));
    try {
      const bin = path.join(root, 'bin');
      const emulator = path.join(root, 'sdk/emulator');
      fs.mkdirSync(bin, { recursive: true });
      fs.mkdirSync(emulator, { recursive: true });
      fs.mkdirSync(path.join(root, 'pali-native-android'));
      const stub = `#!/usr/bin/env node\nconst fs=require('node:fs'),path=require('node:path');\nconst home=process.env.ANDROID_AVD_HOME;\nfs.appendFileSync(process.env.PALI_CALLS,JSON.stringify({tool:path.basename(process.argv[1]),home,args:process.argv.slice(2)})+'\\n');\nif(process.argv.includes('create')){const p=process.argv[process.argv.indexOf('--path')+1];if(p!==path.join(home,'PaliQualification.avd'))process.exit(2);if(process.env.PALI_MODE!=='missing'){fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(home,'PaliQualification.ini'),'path='+p);}}\nelse if(process.argv.includes('-list-avds')){if(fs.existsSync(path.join(home,'PaliQualification.ini')))process.stdout.write('PaliQualification\\n');}\nelse process.stdout.write('Public AVD inventory '+home+'\\n');\n`;
      fs.writeFileSync(path.join(bin, 'avdmanager'), stub, { mode: 0o755 });
      fs.writeFileSync(path.join(emulator, 'emulator'), stub, { mode: 0o755 });
      const start = script.indexOf('echo no | avdmanager create avd');
      const end = script.indexOf('"$ANDROID_HOME/emulator/emulator" -avd PaliQualification');
      const preflight = 'set -euo pipefail\nexport ANDROID_AVD_HOME="$RUNNER_TEMP/pali-android-avd"\nmkdir -p "$ANDROID_AVD_HOME"\n' + script.slice(start, end);
      const result = spawnSync('bash', ['-c', preflight], {
        encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, RUNNER_TEMP: root, ANDROID_HOME: path.join(root, 'sdk'), ANDROID_AVD_HOME: path.join(root, 'wrong-inherited'), PALI_CALLS: path.join(root, 'calls.jsonl'), PALI_MODE: mode },
      });
      if (mode === 'created') assert.equal(result.status, 0, result.stderr);
      else assert.notEqual(result.status, 0);
      const calls = fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      assert(calls.length >= 3);
      assert(calls.every((call) => call.home === path.join(root, 'pali-android-avd')));
      assert(fs.readFileSync(path.join(root, 'pali-native-android/avd-inventory.log'), 'utf8').includes(path.join(root, 'pali-android-avd')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
