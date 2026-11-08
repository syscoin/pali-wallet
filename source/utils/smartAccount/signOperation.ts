import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeApproval.ts';
import { defaultAbiCoder, getAddress } from '../ethersV6Compat.ts';

import type {
  ISmartAccountMetadata,
  KeyringAccountType,
} from '../../types/network.ts';

export type SmartAccountLocalOwner = { id: number; type: KeyringAccountType };

/** Sign the locally computed UserOperation hash through the shared SDK owner signer. */
export async function signSmartAccountEcdsaOperation({
  metadata,
  actionHash,
  findOwner,
  signOwner,
  assertCurrent,
}: {
  actionHash: string;
  assertCurrent(): void;
  findOwner(address: string): SmartAccountLocalOwner | null;
  metadata: ISmartAccountMetadata;
  signOwner(
    address: string,
    digest: string,
    owner: SmartAccountLocalOwner
  ): Promise<string>;
}): Promise<string> {
  assertSynchronousEvmFeeGuard(assertCurrent);
  const moduleId = metadata.auth?.module || metadata.auth?.scheme;
  if (moduleId !== 'ecdsa' || !metadata.auth?.data)
    throw new Error(
      'This smart account requires an interactive signature for its configured validator.'
    );
  const [decodedOwners, decodedThreshold] = defaultAbiCoder.decode(
    ['address[]', 'uint64'],
    metadata.auth.data
  ) as [string[], { toString(): string }];
  const owners = decodedOwners.map((owner) => getAddress(owner));
  const threshold = Math.max(1, Number(decodedThreshold.toString()) || 1);
  const localOwners = owners
    .map((address) => ({ address, owner: findOwner(address) }))
    .filter((entry) => entry.owner !== null);
  if (localOwners.length < threshold)
    throw new Error(
      'This smart account requires the configured ECDSA owner keys in this wallet.'
    );
  const signatures = await Promise.all(
    localOwners
      .slice(0, threshold)
      .map(({ address, owner }) => signOwner(address, actionHash, owner!))
  );
  assertSynchronousEvmFeeGuard(assertCurrent);
  return threshold === 1
    ? signatures[0]!
    : defaultAbiCoder.encode(['bytes[]'], [signatures]);
}
