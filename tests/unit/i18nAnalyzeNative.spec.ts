import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const languages = ['en', 'es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru'];
function analyze(
  resource: object,
  native: string,
  extra: Record<string, string> = {}
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-i18n-native-'));
  const write = (file: string, contents: string) => {
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  };
  try {
    write(
      'scripts/i18n-analyze.js',
      fs.readFileSync(
        path.resolve(__dirname, '../../scripts/i18n-analyze.js'),
        'utf8'
      )
    );
    for (const language of languages)
      write(`source/assets/locales/${language}.json`, JSON.stringify(resource));
    write('source/Screen.tsx', "t('general.title');");
    write('apps/mobile/src/screens/Screen.tsx', native);
    for (const [file, contents] of Object.entries(extra)) write(file, contents);
    return spawnSync(
      process.execPath,
      [path.join(directory, 'scripts/i18n-analyze.js')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_PATH: path.dirname(
            path.dirname(require.resolve('typescript/package.json'))
          ),
        },
      }
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

it('counts actual native production translation calls alongside extension calls', () => {
  const result = analyze(
    { general: { title: 'Extension' }, mobile: { title: 'Native' } },
    "t('mobile.title');"
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Unused keys in en.json: 0 of 2');
});

it('rejects missing conditional native translations with their actual source location', () => {
  const result = analyze(
    { general: { title: 'Extension' }, mobile: { title: 'Native' } },
    "t(loading ? 'mobile.title' : 'mobile.missing');"
  );
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('MISSING mobile.missing');
  expect(result.stdout).toContain('apps/mobile/src/screens/Screen.tsx:1:');
});

it('native test fixtures and comments cannot keep a dead native resource key alive', () => {
  const result = analyze(
    {
      general: { title: 'Extension' },
      mobile: { title: 'Native', unused: 'Unused' },
    },
    "t('mobile.title'); // t('mobile.unused')",
    {
      'apps/mobile/tests/Screen.test.tsx': "t('mobile.unused');",
      'apps/mobile/src/screens/Screen.spec.tsx': "t('mobile.unused');",
      'apps/mobile/src/__tests__/Screen.tsx': "t('mobile.unused');",
    }
  );
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('Unused keys in en.json: 1 of 3');
  expect(result.stdout).toContain('  mobile.unused');
});
