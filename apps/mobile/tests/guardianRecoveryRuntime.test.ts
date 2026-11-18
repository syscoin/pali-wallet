import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { keccak256 } from 'ethers';
import { decodeGuardianRuntime, GUARDIAN_FIXTURE_RUNTIME } from './guardianRecoveryRuntime.ts';
import { PALI_INFRASTRUCTURE_METADATA_BY_ID } from '../../../source/utils/smartAccount/deploymentMetadata.ts';

const source = readFileSync(new URL('../../../source/utils/smartAccount/deployment.ts', import.meta.url), 'utf8');
const declaration = /^  guardianRecoveryModule:\s*decodeBytecode\(\s*'([A-Za-z0-9+/]+={0,2})'\s*\)/m;

test('guardian browser fixture preserves the pinned runtime using mobile dependencies only', () => {
  assert.equal(GUARDIAN_FIXTURE_RUNTIME.length, 2 + 5662 * 2);
  assert.equal(keccak256(decodeGuardianRuntime(source)), PALI_INFRASTRUCTURE_METADATA_BY_ID.guardianRecoveryModule.runtimeCodeHash);
});

test('guardian browser fixture rejects ambiguous or oversized source', () => {
  const match = source.match(declaration)!;
  assert.throws(() => decodeGuardianRuntime(`${source}\n${match[0]}`), /Unexpected guardian creation fixture/);
  assert.throws(() => decodeGuardianRuntime(' '.repeat(200001)), /Unexpected guardian creation fixture/);
});

test('guardian browser fixture rejects altered bytes and noncanonical base64', () => {
  const match = source.match(declaration)!;
  const bytes = Buffer.from(match[1]!, 'base64');
  bytes[0] = bytes[0]! ^ 1;
  const changed = source.replace(match[0], match[0].replace(match[1]!, bytes.toString('base64')));
  assert.throws(() => decodeGuardianRuntime(changed), /Unexpected guardian creation fixture/);
  const malformed = source.replace(match[0], match[0].replace(match[1]!, 'AQ='));
  assert.throws(() => decodeGuardianRuntime(malformed), /Unexpected guardian creation fixture/);
});
