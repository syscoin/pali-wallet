import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const root = path.resolve(__dirname, '../..');

describe('QA artifact isolation from source checks', () => {
  it('excludes generated browser data without excluding journeys or runtime code', () => {
    const config = ts.readConfigFile(
      path.join(root, 'tsconfig.json'),
      ts.sys.readFile
    );
    expect(config.error).toBeUndefined();
    expect(config.config.exclude).toContain('e2e/artifacts');
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    expect(parsed.errors).toEqual([]);
    const files = parsed.fileNames.map((file) => path.relative(root, file));
    expect(files.some((file) => file.startsWith('e2e/artifacts/'))).toBe(false);
    expect(files).toContain('e2e/harness/pali.ts');
    expect(files).toContain(
      'e2e/journeys/offline-legacy-upgrade.journey.spec.ts'
    );
    expect(files).toContain(
      'e2e/journeys/offline-sustained-wallet-stress.journey.spec.ts'
    );
    expect(files).toContain(
      'source/scripts/Background/controllers/MainController.ts'
    );
    expect(files).toContain('tests/unit/qaArtifactExclusion.test.ts');
  });

  it('also excludes generated browser artifacts from lint-all', () => {
    const ignored = fs
      .readFileSync(path.join(root, '.eslintignore'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim());
    expect(ignored).toContain('e2e/artifacts/');
    expect(ignored).not.toContain('e2e/');
    expect(ignored).not.toContain('tests/');
    expect(ignored).not.toContain('source/');
  });
});
