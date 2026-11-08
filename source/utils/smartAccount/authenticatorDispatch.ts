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
    const localOwners = (runtimeContext?.localOwners ?? []).filter((owner) =>
      context.validator.config.owners.some(
        (configuredOwner) =>
          configuredOwner.toLowerCase() === owner.address.toLowerCase()
      )
    );
    const threshold = context.validator.config.threshold;

    if (runtimeContext?.signActionHash && localOwners.length >= threshold) {
      const signatures: string[] = [];
      for (const owner of localOwners.slice(0, threshold)) {
        signatures.push(
          await runtimeContext.signActionHash({
            actionHash: context.actionHash,
            ...(context.executionContextId
              ? { executionContextId: context.executionContextId }
              : {}),
            owner,
            validator: context.validator.address,
          })
        );
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
    if (!isPaliSignableValidator(context.validator, context.smartAccount)) {
      throw new SmartAccountExternalSignatureRequired(
        compositeDriver.createExternalSignatureRequest(context)
      );
    }
    // Composite v1 forwards one action hash to each child. Its bytes[] must
    // retain configured contract order, including empty external/unused slots;
    // child signatures do not carry the outer validator-address prefix.
    const signatures = context.validator.config.childValidators.map(() => '0x');
    let approvals = 0;
    for (const [
      index,
      childAddress,
    ] of context.validator.config.childValidators.entries()) {
      const child = getInstalledValidatorModuleByAddress(
        context.smartAccount,
        childAddress
      )!;
      if (child.id === 'custom') continue;
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
      } catch (error) {
        // Only explicit absence of a local signer is skippable. Rejection,
        // stale context, storage and cryptographic errors must reach the user.
        if (!(error instanceof SmartAccountExternalSignatureRequired))
          throw error;
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

  await params.assertBeforeAuthentication();
  params.onAuthenticatorSigningStarted?.(validator.id);
  const signature = await driver
    .signActionHash({
      assertBeforeAuthentication: params.assertBeforeAuthentication,
      accountId: params.accountId,
      actionHash: params.actionHash,
      ports: params.ports,
      executionContextId: params.executionContextId,
      onAuthenticatorSigningResolved: params.onAuthenticatorSigningResolved,
      onAuthenticatorSigningStarted: params.onAuthenticatorSigningStarted,
      allowReservedSLHDSASignature: params.allowReservedSLHDSASignature,
      smartAccount: params.smartAccount,
      validator,
    })
    .finally(() => {
      params.onAuthenticatorSigningResolved?.(validator.id);
    });

  return {
    ...signature,
    validator: getAddress(validator.address),
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
