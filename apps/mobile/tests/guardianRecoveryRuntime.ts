import { keccak256 } from 'ethers';
import { PALI_INFRASTRUCTURE_BY_ID } from '../../../source/utils/smartAccount/deployment.ts';
import { PALI_INFRASTRUCTURE_METADATA_BY_ID } from '../../../source/utils/smartAccount/deploymentMetadata.ts';

/** Host fixture only. Decode the actual catalogue and retain both compiler hash checks. */
function readGuardianRuntime(): string {
  const deployed = PALI_INFRASTRUCTURE_BY_ID.guardianRecoveryModule.deployCalldata;
  const creation = deployed && `0x${deployed.slice(2 + 0x20 * 2)}`;
  const metadata = PALI_INFRASTRUCTURE_METADATA_BY_ID.guardianRecoveryModule;
  if (!creation || keccak256(creation) !== metadata.bytecodeHash)
    throw new Error('Unexpected guardian creation fixture');
  const runtime = `0x${creation.slice(-5662 * 2)}`;
  if (keccak256(runtime) !== metadata.runtimeCodeHash)
    throw new Error('Unexpected guardian runtime fixture');
  return runtime;
}

export const GUARDIAN_FIXTURE_RUNTIME = readGuardianRuntime();
