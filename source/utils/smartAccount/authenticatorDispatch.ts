import { recoverAddress } from 'ethers/transaction';

import { defaultAbiCoder, getAddress, isHexString } from '../ethersV6Compat.ts';
import { SLH_DSA_SIGNATURE_HEX_LENGTH } from '../slhDsa/constants.ts';

import {
  getInstalledValidatorModule,
  getInstalledValidatorModuleByAddress,
} from './modules.ts';
import type { SmartAccountAuthenticatorSignature } from './signature.ts';
import { isPaliSignableValidator } from './validatorSignability.ts';
import type {
  ISmartAccountMetadata,
  SmartAccountP256WebAuthnConfig,
  SmartAccountValidatorModule,
} from '../../types/network.ts';

export type SmartAccountAuthenticatorSigningCallback = (
  authenticator: SmartAccountValidatorModule['id']
) => void;

export type { SmartAccountAuthenticatorSignature } from './signature';

export type SmartAccountExternalSignatureRequest = {
  actionHash: string;
  authenticator: SmartAccountValidatorModule['id'];
  message: string;
  metadata?: Record<string, unknown>;
  validator: string;
};

export type SmartAccountLocalOwner = {
  address: string;
  id: number;
  type: string;
};

export type SmartAccountLocalEcdsaSigner = (params: {
  actionHash: string;
  executionContextId?: string;
  owner: SmartAccountLocalOwner;
  validator: string;
}) => Promise<string>;

export type SmartAccountSLHDSASigner = (params: {
  accountId?: number;
  actionHash: string;
  allowReservedSignature?: boolean;
  executionContextId?: string;
  keyId: string;
  parameterSet: 'SLH-DSA-SHA2-128-24';
  pkRoot: string;
  pkSeed: string;
}) => Promise<string>;

export type SmartAccountAuthenticatorPorts = Readonly<{
  ecdsa: Readonly<{
    localOwners: readonly SmartAccountLocalOwner[];
    signActionHash: SmartAccountLocalEcdsaSigner;
  }> | null;
  p256WebAuthn: Readonly<{
    signActionHash(
      request: Readonly<{
        actionHash: string;
        credentialId?: string;
        expectedCredentialIdHash?: string;
        expectedPublicKey?: SmartAccountP256WebAuthnConfig['publicKey'];
      }>
    ): Promise<SmartAccountAuthenticatorSignature>;
  }> | null;
  slhDsa: Readonly<{
    signActionHash: SmartAccountSLHDSASigner | null;
    signMessageActionHash:
      | ((keyId: string, validator: string) => Promise<string>)
      | null;
  }> | null;
}>;

function assertSigningPorts(ports: SmartAccountAuthenticatorPorts): void {
  if (
    !ports ||
    !Object.hasOwn(ports, 'ecdsa') ||
    !Object.hasOwn(ports, 'p256WebAuthn') ||
    !Object.hasOwn(ports, 'slhDsa') ||
    (ports.ecdsa !== null &&
      (!Array.isArray(ports.ecdsa?.localOwners) ||
        typeof ports.ecdsa?.signActionHash !== 'function')) ||
    (ports.p256WebAuthn !== null &&
      typeof ports.p256WebAuthn?.signActionHash !== 'function') ||
    (ports.slhDsa !== null &&
      (!Object.hasOwn(ports.slhDsa, 'signActionHash') ||
        !Object.hasOwn(ports.slhDsa, 'signMessageActionHash') ||
        (ports.slhDsa.signActionHash !== null &&
          typeof ports.slhDsa.signActionHash !== 'function') ||
        (ports.slhDsa.signMessageActionHash !== null &&
          typeof ports.slhDsa.signMessageActionHash !== 'function')))
  )
    throw new TypeError(
      'Explicit smart account authenticator ports are required'
    );
}

export class SmartAccountExternalSignatureRequired extends Error {
  public readonly request: SmartAccountExternalSignatureRequest;

  constructor(request: SmartAccountExternalSignatureRequest) {
    super(request.message);
    this.name = 'SmartAccountExternalSignatureRequired';
    this.request = request;
  }
}

export type SmartAccountAuthenticatorContext<
  T extends SmartAccountValidatorModule
> = {
  accountId?: number;
  actionHash: string;
  allowReservedSLHDSASignature?: boolean;
  executionContextId?: string;
  onAuthenticatorSigningResolved?: SmartAccountAuthenticatorSigningCallback;
  onAuthenticatorSigningStarted?: SmartAccountAuthenticatorSigningCallback;
  smartAccount: ISmartAccountMetadata;
  validator: T;
};

type SmartAccountAuthenticatorDriver<
  T extends SmartAccountValidatorModule = SmartAccountValidatorModule
> = {
  createExternalSignatureRequest: (
    context: SmartAccountAuthenticatorContext<T>
  ) => SmartAccountExternalSignatureRequest;
  id: T['id'];
  signActionHash: (
    context: SmartAccountAuthenticatorContext<T> & {
      assertBeforeAuthentication(): Promise<void>;
      ports: SmartAccountAuthenticatorPorts;
      signingPlan: SmartAccountSigningPlan;
    }
  ) => Promise<SmartAccountAuthenticatorSignature>;
};

const getCurrentValidatorModule = (
  smartAccount: ISmartAccountMetadata
): SmartAccountValidatorModule => {
  const moduleId = smartAccount.auth?.module || smartAccount.auth?.scheme;
  const validator =
    smartAccount.installedModules?.find(
      (module): module is SmartAccountValidatorModule =>
        module.type === 'validator' &&
        module.address.toLowerCase() ===
          smartAccount.auth?.validator?.toLowerCase()
    ) ||
    (moduleId && moduleId !== 'composite'
      ? getInstalledValidatorModule(smartAccount, moduleId)
      : undefined);

  if (!validator) {
    throw new Error('Smart account has no active validator module metadata');
  }

  return validator;
};

const externalSignatureRequest = (
  context: SmartAccountAuthenticatorContext<SmartAccountValidatorModule>,
  message: string,
  metadata?: Record<string, unknown>
): SmartAccountExternalSignatureRequest => ({
  actionHash: context.actionHash,
  authenticator: context.validator.id,
  message,
  metadata,
  validator: context.validator.address,
});

const p256WebAuthnDriver: SmartAccountAuthenticatorDriver<
  Extract<SmartAccountValidatorModule, { id: 'p256-webauthn' }>
> = {
  createExternalSignatureRequest: (context) =>
    externalSignatureRequest(
      context,
      'Open this wallet on a device with the configured passkey and approve the request.',
      {
        credentialId: context.validator.config.credentialId,
        passkeyName: context.validator.config.passkeyName,
      }
    ),
  id: 'p256-webauthn',
  signActionHash: async (context) => {
    const { actionHash, validator, ports } = context;
    if (ports.p256WebAuthn === null)
      throw new SmartAccountExternalSignatureRequired(
        p256WebAuthnDriver.createExternalSignatureRequest(context)
      );
    return ports.p256WebAuthn.signActionHash({
      actionHash,
      credentialId: validator.config.credentialId || undefined,
      expectedCredentialIdHash: validator.config.credentialIdHash,
      expectedPublicKey: validator.config.publicKey,
    });
  },
};

const localEcdsaOwners = (
  validator: Extract<SmartAccountValidatorModule, { id: 'ecdsa' }>,
  inventory: readonly SmartAccountLocalOwner[] | null
) => {
  const seen = new Set<string>();
  const configured = new Set(
    validator.config.owners.map((owner) => getAddress(owner))
  );
  return (inventory ?? [])
    .filter((owner) => {
      const address = getAddress(owner.address);
      if (seen.has(address) || !configured.has(address)) return false;
      seen.add(address);
      return true;
    })
    .map((owner) =>
      Object.freeze({ address: owner.address, id: owner.id, type: owner.type })
    );
};

/** Match the contract's exact 65-byte ECDSA proof; never normalize wire bytes. */
export function assertEcdsaOwnerSignature(
  actionHash: string,
  owner: string,
  signature: string
): void {
  try {
    // ethers accepts normalized recovery ids 0/1; OpenZeppelin requires 27/28.
    if (
      !isHexString(signature, 65) ||
      !['1b', '1c'].includes(signature.slice(-2).toLowerCase()) ||
      getAddress(recoverAddress(actionHash, signature)) !== getAddress(owner)
    )
      throw new Error('Invalid signature');
    // recoverAddress uses ethers' canonical signature parser, including low-s.
  } catch {
    throw new Error('Smart account owner signature is invalid');
  }
}

export type SmartAccountAuthenticatorAvailability = Readonly<{
  ecdsa: readonly SmartAccountLocalOwner[] | null;
  p256WebAuthn: boolean;
  slhDsa: boolean;
}>;

export type SmartAccountSigningPlan = Readonly<{
  authenticators: readonly Readonly<{
    index: number;
    owners: readonly SmartAccountLocalOwner[];
    validator: SmartAccountValidatorModule;
  }>[];
  validator: SmartAccountValidatorModule;
}>;

function assertAuthenticatorAvailability(
  available: SmartAccountAuthenticatorAvailability
): void {
  if (
    !available ||
    !Object.hasOwn(available, 'ecdsa') ||
    !Object.hasOwn(available, 'p256WebAuthn') ||
    !Object.hasOwn(available, 'slhDsa') ||
    (available.ecdsa !== null && !Array.isArray(available.ecdsa)) ||
    typeof available.p256WebAuthn !== 'boolean' ||
    typeof available.slhDsa !== 'boolean'
  )
    throw new TypeError(
      'Explicit smart account authenticator availability is required'
    );
}

/** Validator metadata is a public JSON DTO; do not retain caller-mutated policy arrays. */
function captureSigningValidator(
  validator: SmartAccountValidatorModule
): SmartAccountValidatorModule {
  const copy: SmartAccountValidatorModule = JSON.parse(
    JSON.stringify(validator)
  );
  for (const value of Object.values(copy.config))
    if (value && typeof value === 'object') Object.freeze(value);
  Object.freeze(copy.config);
  return Object.freeze(copy);
}

/** One ordered, threshold-stopping plan for capability, device connection and signing. */
function planAuthenticator(
  validator: SmartAccountValidatorModule,
  metadata: ISmartAccountMetadata,
  available: SmartAccountAuthenticatorAvailability
): SmartAccountSigningPlan | null {
  assertAuthenticatorAvailability(available);
  const availableLeaf = (child: SmartAccountValidatorModule): boolean => {
    if (child.id === 'ecdsa')
      return (
        Number.isSafeInteger(child.config.threshold) &&
        child.config.threshold >= 1 &&
        localEcdsaOwners(child, available.ecdsa).length >=
          child.config.threshold
      );
    if (child.id === 'p256-webauthn') return available.p256WebAuthn;
    if (child.id === 'slh-dsa') return available.slhDsa;
    return false;
  };
  if (!isPaliSignableValidator(validator, metadata, availableLeaf)) return null;
  validator = captureSigningValidator(validator);
  const candidates =
    validator.id === 'composite'
      ? validator.config.childValidators.map((address, index) => ({
          index,
          validator: captureSigningValidator(
            getInstalledValidatorModuleByAddress(metadata, address)!
          ),
        }))
      : [{ index: 0, validator }];
  const threshold =
    validator.id === 'composite' ? validator.config.threshold : 1;
  const authenticators: Array<
    SmartAccountSigningPlan['authenticators'][number]
  > = [];
  for (const candidate of candidates) {
    if (!availableLeaf(candidate.validator)) continue;
    authenticators.push(
      Object.freeze({
        ...candidate,
        owners: Object.freeze(
          candidate.validator.id === 'ecdsa'
            ? localEcdsaOwners(candidate.validator, available.ecdsa).slice(
                0,
                candidate.validator.config.threshold
              )
            : []
        ),
      })
    );
    if (authenticators.length === threshold) break;
  }
  return Object.freeze({
    validator,
    authenticators: Object.freeze(authenticators),
  });
}

export function getSmartAccountSigningPlan(
  smartAccount: ISmartAccountMetadata,
  available: SmartAccountAuthenticatorAvailability
): SmartAccountSigningPlan | null {
  return planAuthenticator(
    getCurrentValidatorModule(smartAccount),
    smartAccount,
    available
  );
}

/** Capability uses the identical owner order and composite stopping point as dispatch. */
export function canSignSmartAccountActionHash(
  smartAccount: ISmartAccountMetadata,
  available: SmartAccountAuthenticatorAvailability
): boolean {
  return getSmartAccountSigningPlan(smartAccount, available) !== null;
}

const ecdsaDriver: SmartAccountAuthenticatorDriver<
  Extract<SmartAccountValidatorModule, { id: 'ecdsa' }>
> = {
  createExternalSignatureRequest: (context) =>
    externalSignatureRequest(
      context,
      'Sign this smart account action hash with one of the configured ECDSA owners, then submit the signature.',
      {
        actionHash: context.actionHash,
        owners: context.validator.config.owners,
        threshold: context.validator.config.threshold,
      }
    ),
  id: 'ecdsa',
  signActionHash: async (context) => {
    const runtimeContext = context.ports.ecdsa;
    const localOwners =
      context.signingPlan.authenticators.find(
        (entry) =>
          entry.validator.address.toLowerCase() ===
          context.validator.address.toLowerCase()
      )?.owners ?? [];
    const threshold = context.validator.config.threshold;

    if (runtimeContext?.signActionHash && localOwners.length >= threshold) {
      const signatures: string[] = [];
      for (const owner of localOwners) {
        const signature = await runtimeContext.signActionHash({
          actionHash: context.actionHash,
          ...(context.executionContextId
            ? { executionContextId: context.executionContextId }
            : {}),
          owner,
          validator: context.validator.address,
        });
        assertEcdsaOwnerSignature(context.actionHash, owner.address, signature);
        signatures.push(signature);
      }

      return {
        proof:
          threshold === 1
            ? signatures[0]
            : defaultAbiCoder.encode(['bytes[]'], [signatures]),
        signature:
          threshold === 1
            ? signatures[0]
            : defaultAbiCoder.encode(['bytes[]'], [signatures]),
      };
    }

    throw new SmartAccountExternalSignatureRequired(
      ecdsaDriver.createExternalSignatureRequest(context)
    );
  },
};

const slhDsaDriver: SmartAccountAuthenticatorDriver<
  Extract<SmartAccountValidatorModule, { id: 'slh-dsa' }>
> = {
  createExternalSignatureRequest: (context) =>
    externalSignatureRequest(
      context,
      'Sign this smart account action hash with the configured SLH-DSA key, then submit the signature.',
      {
        actionHash: context.actionHash,
        keyId: context.validator.config.keyId,
        parameterSet: context.validator.config.parameterSet,
        pkRoot: context.validator.config.pkRoot,
        pkSeed: context.validator.config.pkSeed,
      }
    ),
  id: 'slh-dsa',
  signActionHash: async ({
    accountId,
    allowReservedSLHDSASignature,
    actionHash,
    executionContextId,
    ports,
    validator,
  }) => {
    const slhDsaContext = ports.slhDsa;
    const signature = slhDsaContext?.signMessageActionHash
      ? await slhDsaContext.signMessageActionHash(
          validator.config.keyId,
          validator.address
        )
      : await slhDsaContext?.signActionHash?.({
          accountId,
          actionHash,
          ...(executionContextId ? { executionContextId } : {}),
          allowReservedSignature: allowReservedSLHDSASignature,
          keyId: validator.config.keyId,
          parameterSet: validator.config.parameterSet,
          pkRoot: validator.config.pkRoot,
          pkSeed: validator.config.pkSeed,
        });

    if (!signature) {
      throw new SmartAccountExternalSignatureRequired(
        slhDsaDriver.createExternalSignatureRequest({
          actionHash,
          smartAccount: {} as never,
          validator,
        })
      );
    }
    if (
      !isHexString(signature) ||
      signature.length !== SLH_DSA_SIGNATURE_HEX_LENGTH
    ) {
      throw new Error('SLH-DSA signer returned an invalid signature');
    }

    return {
      proof: signature,
      signature,
    };
  },
};

const compositeDriver: SmartAccountAuthenticatorDriver<
  Extract<SmartAccountValidatorModule, { id: 'composite' }>
> = {
  createExternalSignatureRequest: (context) =>
    externalSignatureRequest(
      context,
      'Collect enough child authenticator approvals for this composite policy, then submit the aggregate proof.',
      {
        actionHash: context.actionHash,
        childValidators: context.validator.config.childValidators,
        threshold: context.validator.config.threshold,
      }
    ),
  id: 'composite',
  signActionHash: async (context) => {
    // Composite v1 forwards one action hash to each child. Its bytes[] must
    // retain configured contract order, including empty external/unused slots;
    // child signatures do not carry the outer validator-address prefix.
    const signatures = context.validator.config.childValidators.map(() => '0x');
    let approvals = 0;
    for (const { index, validator: child } of context.signingPlan
      .authenticators) {
      const driver = getAuthenticatorDriver(child);
      await context.assertBeforeAuthentication();
      context.onAuthenticatorSigningStarted?.(child.id);
      try {
        const signature = await driver.signActionHash({
          ...context,
          validator: child,
        });
        signatures[index] = signature.signature;
        if (++approvals >= context.validator.config.threshold) {
          const aggregate = defaultAbiCoder.encode(['bytes[]'], [signatures]);
          return { proof: aggregate, signature: aggregate };
        }
      } finally {
        context.onAuthenticatorSigningResolved?.(child.id);
      }
    }
    throw new SmartAccountExternalSignatureRequired(
      compositeDriver.createExternalSignatureRequest(context)
    );
  },
};

// Generic arm for bring-your-own validators: Pali cannot produce these
// signatures natively, so every action routes through the external-signature
// flow with full context (module address, label, init data).
const customDriver: SmartAccountAuthenticatorDriver<
  Extract<SmartAccountValidatorModule, { id: 'custom' }>
> = {
  createExternalSignatureRequest: (context) =>
    externalSignatureRequest(
      context,
      `Sign this smart account action hash with the external "${context.validator.config.name}" validator, then submit the signature.`,
      {
        actionHash: context.actionHash,
        moduleAddress: context.validator.address,
        moduleName: context.validator.config.name,
        moduleType: context.validator.config.moduleType,
      }
    ),
  id: 'custom',
  signActionHash: async (context) => {
    throw new SmartAccountExternalSignatureRequired(
      customDriver.createExternalSignatureRequest(context)
    );
  },
};

const authenticatorDrivers = [
  p256WebAuthnDriver,
  ecdsaDriver,
  slhDsaDriver,
  compositeDriver,
  customDriver,
] as const;

const getAuthenticatorDriver = <T extends SmartAccountValidatorModule>(
  validator: T
): SmartAccountAuthenticatorDriver<T> => {
  const driver = authenticatorDrivers.find(
    (candidate) => candidate.id === validator.id
  );

  if (!driver) {
    throw new SmartAccountExternalSignatureRequired({
      actionHash: '',
      authenticator: validator.id,
      message: `No wallet signer is available for smart account authenticator ${validator.id}`,
      validator: validator.address,
    });
  }

  return driver as unknown as SmartAccountAuthenticatorDriver<T>;
};

export const getSmartAccountExternalSignatureRequest = (params: {
  accountId?: number;
  actionHash: string;
  smartAccount: ISmartAccountMetadata;
}): SmartAccountExternalSignatureRequest => {
  const validator = getCurrentValidatorModule(params.smartAccount);
  const driver = getAuthenticatorDriver(validator);
  return driver.createExternalSignatureRequest({
    accountId: params.accountId,
    actionHash: params.actionHash,
    smartAccount: params.smartAccount,
    validator,
  });
};

type SmartAccountSigningParams = {
  accountId?: number;
  actionHash: string;
  allowReservedSLHDSASignature?: boolean;
  assertBeforeAuthentication(): Promise<void>;
  executionContextId?: string;
  onAuthenticatorSigningResolved?: SmartAccountAuthenticatorSigningCallback;
  onAuthenticatorSigningStarted?: SmartAccountAuthenticatorSigningCallback;
  ports: SmartAccountAuthenticatorPorts;
  smartAccount: ISmartAccountMetadata;
};

/** Dispatch an explicit validator through the same host ports used by every wallet. */
export const signSmartAccountWithValidator = async (
  params: SmartAccountSigningParams & { validator: SmartAccountValidatorModule }
): Promise<SmartAccountAuthenticatorSignature> => {
  assertSigningPorts(params.ports);
  params = Object.freeze({ ...params });
  const { validator } = params;
  const driver = getAuthenticatorDriver(validator);
  const signingPlan = planAuthenticator(validator, params.smartAccount, {
    ecdsa: params.ports.ecdsa?.localOwners ?? null,
    p256WebAuthn: params.ports.p256WebAuthn !== null,
    slhDsa:
      params.ports.slhDsa !== null &&
      (params.ports.slhDsa.signActionHash !== null ||
        params.ports.slhDsa.signMessageActionHash !== null),
  });
  if (!signingPlan)
    throw new SmartAccountExternalSignatureRequired(
      driver.createExternalSignatureRequest({ ...params, validator })
    );

  await params.assertBeforeAuthentication();
  params.onAuthenticatorSigningStarted?.(validator.id);
  const signature = await driver
    .signActionHash({
      assertBeforeAuthentication: params.assertBeforeAuthentication,
      accountId: params.accountId,
      actionHash: params.actionHash,
      ports: params.ports,
      signingPlan,
      executionContextId: params.executionContextId,
      onAuthenticatorSigningResolved: params.onAuthenticatorSigningResolved,
      onAuthenticatorSigningStarted: params.onAuthenticatorSigningStarted,
      allowReservedSLHDSASignature: params.allowReservedSLHDSASignature,
      smartAccount: params.smartAccount,
      validator: signingPlan.validator,
    })
    .finally(() => {
      params.onAuthenticatorSigningResolved?.(validator.id);
    });

  return {
    ...signature,
    validator: getAddress(signingPlan.validator.address),
  };
};

/** Resolve the active installed validator before using the shared dispatcher. */
export const signSmartAccountActionHash = async (
  params: SmartAccountSigningParams
): Promise<SmartAccountAuthenticatorSignature> => {
  assertSigningPorts(params.ports);
  return signSmartAccountWithValidator({
    ...params,
    validator: getCurrentValidatorModule(params.smartAccount),
  });
};
