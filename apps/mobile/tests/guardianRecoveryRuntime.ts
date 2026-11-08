import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keccak256 } from 'ethers';
import { PALI_INFRASTRUCTURE_METADATA_BY_ID } from '../../../source/utils/smartAccount/deploymentMetadata.ts';

/** Host fixture only. Load the pinned compiler artifact without importing deployment logic. */
function readGuardianRuntime(): string {
  const source = readFileSync(resolve('../../source/utils/smartAccount/operation.ts'), 'utf8');
  const creation = /^  guardianRecoveryModule:\s*'(0x[0-9a-f]+)'/m.exec(source)?.[1];
  const metadata = PALI_INFRASTRUCTURE_METADATA_BY_ID.guardianRecoveryModule;
  if (!creation || keccak256(creation) !== metadata.bytecodeHash)
    throw new Error('Unexpected guardian creation fixture');
  const runtime = `0x${creation.slice(-5662 * 2)}`;
  if (keccak256(runtime) !== metadata.runtimeCodeHash)
    throw new Error('Unexpected guardian runtime fixture');
  return runtime;
}

export const GUARDIAN_FIXTURE_RUNTIME = readGuardianRuntime();
