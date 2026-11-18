import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keccak256 } from 'ethers';
import { PALI_INFRASTRUCTURE_METADATA_BY_ID } from '../../../source/utils/smartAccount/deploymentMetadata.ts';

/** Host fixture only: load compiler bytes without resolving the extension dependency graph. */
export function decodeGuardianRuntime(source: string): string {
  if (source.length > 200000) throw new Error('Unexpected guardian creation fixture');
  const declarations = [...source.matchAll(
    /^  guardianRecoveryModule:\s*decodeBytecode\(\s*'([A-Za-z0-9+/]{1,8192}={0,2})'\s*\)/gm
  )];
  if (declarations.length !== 1) throw new Error('Unexpected guardian creation fixture');
  const encoded = declarations[0]![1]!;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new Error('Unexpected guardian creation fixture');
  const creation = `0x${bytes.toString('hex')}`;
  const metadata = PALI_INFRASTRUCTURE_METADATA_BY_ID.guardianRecoveryModule;
  if (!creation || keccak256(creation) !== metadata.bytecodeHash)
    throw new Error('Unexpected guardian creation fixture');
  const runtime = `0x${creation.slice(-5662 * 2)}`;
  if (keccak256(runtime) !== metadata.runtimeCodeHash)
    throw new Error('Unexpected guardian runtime fixture');
  return runtime;
}

export const GUARDIAN_FIXTURE_RUNTIME = decodeGuardianRuntime(readFileSync(
  resolve('../../source/utils/smartAccount/deployment.ts'),
  'utf8'
));
