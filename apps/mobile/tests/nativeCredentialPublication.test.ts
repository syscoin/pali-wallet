import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

test('Android credential publication preserves no-overwrite and file-scope boundaries', { timeout: 30_000 }, () => {
  const script = fileURLToPath(new URL('../modules/pali-wallet-storage/tests/run-credential-publication.sh', import.meta.url));
  const result = spawnSync('sh', [script], { encoding: 'utf8', timeout: 25_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Credential publication: scope, source integrity, collision, symlink and platform controls passed/);
});
