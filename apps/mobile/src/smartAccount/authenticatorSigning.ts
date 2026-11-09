import { recoverAddress } from 'ethers/transaction';
import {
  getAddress,
  isHexString,
} from '../../../../source/utils/ethersV6Compat.ts';
import {
  signSmartAccountActionHash,
  canSignSmartAccountActionHash,
  type SmartAccountAuthenticatorSignature,
  type SmartAccountAuthenticatorPorts,
} from '../../../../source/utils/smartAccount/authenticatorDispatch.ts';
import { requireSmartAccountAuthenticator } from '../../../../source/utils/smartAccount/prepareOperation.ts';
import { getSmartAccountLocalEcdsaOwners } from '../../../../source/utils/smartAccount/signOperation.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import type {
  ISmartAccountMetadata,
  KeyringAccountType,
} from '../../../../source/types/network.ts';

export type NativeSmartAccountSigningOwner = Readonly<{
  address: string;
  id: number;
  type: 'HDAccount' | 'Imported';
}>;

/** The shared chain observer owns deployment addresses; retain its active module identity. */
export function assertNativeSmartAccountAuthenticator(
  metadata: ISmartAccountMetadata
) {
  const auth = requireSmartAccountAuthenticator(metadata);
  if (!['ecdsa', 'p256-webauthn', 'slh-dsa', 'composite'].includes(auth.module))
    throw new Error('Native smart account validator identity changed');
  const address = getAddress(auth.validator);
  const active = metadata.installedModules?.find(
    (module) =>
      module.type === 'validator' &&
      module.address.toLowerCase() === address.toLowerCase()
  );
  if (active && active.id !== auth.module)
    throw new Error('Native smart account validator module changed');
  return auth;
}

function captureNativeSmartAccountSigningContext(inputMetadata: ISmartAccountMetadata, localOwners: readonly NativeSmartAccountSigningOwner[]) {
  // Public validator DTOs must not change child order or owner thresholds
  // while an asynchronous authentication prompt is held.
  let metadata: ISmartAccountMetadata = {
    ...inputMetadata,
    ...JSON.parse(
      JSON.stringify({
        auth: inputMetadata.auth,
        installedModules: inputMetadata.installedModules,
      })
    ),
  };
  const auth = assertNativeSmartAccountAuthenticator(metadata);
  const inventory = localOwners.map((owner) => {
    if (
      !Number.isSafeInteger(owner.id) ||
      owner.id < 0 ||
      (owner.type !== 'HDAccount' && owner.type !== 'Imported')
    )
      throw new Error('Native smart account owner is unavailable');
    return Object.freeze({
      address: getAddress(owner.address),
      id: owner.id,
      type: owner.type,
    });
  });
  if (
    new Set(inventory.map((owner) => `${owner.type}:${owner.id}`)).size !==
    inventory.length
  )
    throw new Error('Native smart account owner identity changed');
  // Match the original native findOwner: the first software account for an
  // address owns signing. An alias neither blocks another owner nor counts as
  // another approval, and a rejection never falls through to its alias.
  const firstOwners = new Map<string, NativeSmartAccountSigningOwner>();
  for (const owner of inventory)
    if (!firstOwners.has(owner.address)) firstOwners.set(owner.address, owner);
  let owners = [...firstOwners.values()];
  // Preserve the native ECDSA path's canonical auth.data precedence, including
  // undeployed accounts that do not yet have an installed-module inventory.
  if (auth.module === 'ecdsa') {
    const { owners: orderedOwners, configuredOwners, threshold } = getSmartAccountLocalEcdsaOwners(
      metadata,
      (address) => {
        const owner = owners.find(
          (owner) => owner.address === getAddress(address)
        );
        return owner
          ? { id: owner.id, type: owner.type as KeyringAccountType }
          : null;
      }
    );
    owners = orderedOwners.map(({ address, owner }) => {
      const captured = firstOwners.get(address);
      if (!captured || captured.id !== owner.id || captured.type !== owner.type)
        throw new Error('Native smart account owner identity changed');
      return captured;
    });
    metadata = {
      ...metadata,
      installedModules: [
        ...(metadata.installedModules ?? []).filter(
          (module) =>
            module.address.toLowerCase() !== auth.validator.toLowerCase()
        ),
        {
          id: 'ecdsa',
          type: 'validator',
          address: getAddress(auth.validator),
          data: auth.data,
          config: { owners: configuredOwners, threshold },
        },
      ],
    };
  }
  return { metadata, owners };
}

export function canSignNativeSmartAccountActionHash(metadata: ISmartAccountMetadata, localOwners: readonly NativeSmartAccountSigningOwner[], available: Readonly<{ slhDsa: boolean }>): boolean {
  try {
    if (typeof available?.slhDsa !== 'boolean') return false;
    const captured = captureNativeSmartAccountSigningContext(metadata, localOwners);
    return canSignSmartAccountActionHash(captured.metadata, { ecdsa: captured.owners, p256WebAuthn: false, slhDsa: available.slhDsa });
  } catch { return false; }
}

/** Host-owned keys around the existing shared threshold/composite collector. */
export async function signNativeSmartAccountActionHash(
  params: Readonly<{
    metadata: ISmartAccountMetadata;
    actionHash: string;
    slhDsa: SmartAccountAuthenticatorPorts['slhDsa'];
    allowReservedSLHDSASignature: boolean;
    accountId: number;
    localOwners: readonly NativeSmartAccountSigningOwner[];
    assertCurrent(): void;
    assertOwnerCurrent(owner: NativeSmartAccountSigningOwner): void;
    signOwner(
      address: string,
      digest: string,
      owner: NativeSmartAccountSigningOwner,
      assertCurrent: () => void
    ): Promise<string>;
  }>
): Promise<SmartAccountAuthenticatorSignature> {
  params = Object.freeze({ ...params });
  const check = () => assertSynchronousEvmFeeGuard(params.assertCurrent);
  check();
  if (
    !isHexString(params.actionHash, 32) ||
    !Array.isArray(params.localOwners) ||
    typeof params.assertOwnerCurrent !== 'function' ||
    typeof params.signOwner !== 'function' ||
    !Object.hasOwn(params, 'slhDsa') ||
    (params.slhDsa !== null && (!params.slhDsa || typeof params.slhDsa.signActionHash !== 'function' || params.slhDsa.signMessageActionHash !== null)) ||
    typeof params.allowReservedSLHDSASignature !== 'boolean' ||
    !Number.isSafeInteger(params.accountId) || params.accountId < 0
  )
    throw new Error('Native smart account signing ports are required');
  const { metadata, owners } = captureNativeSmartAccountSigningContext(params.metadata, params.localOwners);
  const slhDsa = params.slhDsa === null ? null : Object.freeze({ signActionHash: params.slhDsa.signActionHash!.bind(params.slhDsa), signMessageActionHash: null });
  const result = await signSmartAccountActionHash({
    accountId: params.accountId,
    allowReservedSLHDSASignature: params.allowReservedSLHDSASignature,
    smartAccount: metadata,
    actionHash: params.actionHash,
    async assertBeforeAuthentication() {
      check();
    },
    ports: {
      ecdsa: {
        localOwners: owners,
        async signActionHash(request) {
          const owner = owners.find(
            (candidate) =>
              candidate.address === request.owner.address &&
              candidate.id === request.owner.id &&
              candidate.type === request.owner.type
          );
          if (!owner || request.actionHash !== params.actionHash)
            throw new Error('Native smart account signer changed');
          const ownerCurrent = () => {
            check();
            assertSynchronousEvmFeeGuard(() =>
              params.assertOwnerCurrent(owner)
            );
            check();
          };
          ownerCurrent();
          const signature = await params.signOwner(
            owner.address,
            request.actionHash,
            owner,
            ownerCurrent
          );
          ownerCurrent();
          if (
            !isHexString(signature, 65) ||
            getAddress(recoverAddress(request.actionHash, signature)) !==
              owner.address
          )
            throw new Error('Native smart account owner signature is invalid');
          return signature;
        },
      },
      p256WebAuthn: null,
      slhDsa,
    },
  });
  check();
  return result;
}
