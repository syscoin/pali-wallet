import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';
import { defaultAbiCoder, getAddress } from '../ethersV6Compat.ts';

import { signSmartAccountWithValidator } from './authenticatorDispatch.ts';
import type {
  ISmartAccountMetadata,
  KeyringAccountType,
} from '../../types/network.ts';

export type SmartAccountLocalOwner = { id: number; type: KeyringAccountType };

/** The capability check and actual signing share the same local-owner selection. */
export function getSmartAccountLocalEcdsaOwners(
  metadata: ISmartAccountMetadata,
  findOwner: (address: string) => SmartAccountLocalOwner | null
) {
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
    .filter(
      (entry): entry is { address: string; owner: SmartAccountLocalOwner } =>
        entry.owner !== null
    );
  if (localOwners.length < threshold)
    throw new Error(
      'This smart account requires the configured ECDSA owner keys in this wallet.'
    );
  return {
    owners: localOwners.slice(0, threshold),
    configuredOwners: owners,
    threshold,
  };
}

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
  const { owners, configuredOwners, threshold } =
    getSmartAccountLocalEcdsaOwners(metadata, findOwner);
  const result = await signSmartAccountWithValidator({
    smartAccount: metadata,
    actionHash,
    validator: {
      id: 'ecdsa',
      type: 'validator',
      address: getAddress(metadata.auth!.validator),
      data: metadata.auth!.data,
      config: { owners: configuredOwners, threshold },
    },
    async assertBeforeAuthentication() {
      assertSynchronousEvmFeeGuard(assertCurrent);
    },
    ports: {
      ecdsa: {
        localOwners: owners.map(({ address, owner }) => ({
          address,
          id: owner.id,
          type: owner.type,
        })),
        signActionHash({ actionHash: digest, owner: requested }) {
          const entry = owners.find(
            ({ address, owner }) =>
              address === requested.address &&
              owner.id === requested.id &&
              owner.type === requested.type
          );
          if (!entry) throw new Error('Smart account signer changed');
          assertSynchronousEvmFeeGuard(assertCurrent);
          return signOwner(entry.address, digest, entry.owner);
        },
      },
      p256WebAuthn: null,
      slhDsa: null,
    },
  });
  assertSynchronousEvmFeeGuard(assertCurrent);
  return result.signature;
}
