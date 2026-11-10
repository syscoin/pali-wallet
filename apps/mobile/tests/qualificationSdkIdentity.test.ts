import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesQualificationSdkIdentity } from '../qualification/sdk-identity.ts';

test('native qualification recognizes official and locked archive identities', () => {
  assert.equal(
    matchesQualificationSdkIdentity(
      '2.1.10',
      '2.1.10.crypto-vector',
      'crypto-vector'
    ),
    true
  );
  assert.equal(
    matchesQualificationSdkIdentity(
      '2.1.10',
      `2.1.10.keyring.${'a'.repeat(64)}.crypto-vector`,
      'crypto-vector'
    ),
    true
  );
});

test('native qualification rejects mismatched or malformed identity components', () => {
  const candidate = `2.1.10.keyring.${'a'.repeat(64)}.crypto-vector`;
  for (const [version, identity, crypto] of [
    ['2.1.9', candidate, 'crypto-vector'],
    ['2.1.10', candidate, 'other-vector'],
    ['2.1.10', candidate, ''],
    [
      '2.1.10',
      candidate.replace('a'.repeat(64), 'a'.repeat(63)),
      'crypto-vector',
    ],
    [
      '2.1.10',
      candidate.replace('a'.repeat(64), 'G'.repeat(64)),
      'crypto-vector',
    ],
    ['2.1.10', `extra.${candidate}`, 'crypto-vector'],
    ['2.1.10', `${candidate}.extra`, 'crypto-vector'],
    ['2.1.10', undefined, 'crypto-vector'],
    [undefined, candidate, 'crypto-vector'],
  ])
    assert.equal(
      matchesQualificationSdkIdentity(version, identity, crypto),
      false
    );
});
