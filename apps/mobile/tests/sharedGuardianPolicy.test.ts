import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGuardianPolicyExecutions,
  projectGuardianPolicyModule,
} from '../../../source/utils/smartAccount/guardianPolicy.ts';

// Import through the native source-test resolver, with no extension aliases or browser globals.
test('shared guardian commands and metadata load on the native dependency graph', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const [install] = buildGuardianPolicyExecutions({
    kind: 'install',
    accountAddress: address,
    chainId: 57057,
    delaySeconds: 600,
    guardian: address,
  });
  assert.equal(install?.target, address);
  assert.equal(install?.value, '0x0');
  assert.equal(
    projectGuardianPolicyModule({
      moduleAddress: address,
      delaySeconds: 600,
      expirationSeconds: 1200,
      guardians: [address],
      threshold: 1,
    }).type,
    'executor'
  );
});
