import { defaultAbiCoder } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { hexConcat, isHexString } from '@ethersproject/bytes';

import {
  getP256WebAuthnExternalSignatureMetadata,
  signP256WebAuthnActionHash,
} from '../passkey/authenticator';
import type {
  ISmartAccountMetadata,
  KeyringAccountType,
  SmartAccountValidatorModule,
} from 'types/network';
import { SLH_DSA_SIGNATURE_HEX_LENGTH } from 'utils/slhDsa/constants';

import { getInstalledValidatorModule } from './modules';
import { hasSmartAccountPaymaster } from './paymaster';
import type { SmartAccountPaymasterApprovalSetup } from './paymaster';

type ControllerEmitter = (
  methods: string[],
  payload?: any[],
  timeout?: number
) => Promise<any>;

export type SmartAccountExecutionIntent = {
  data?: string;
  target: string;
  value: string;
};

const smartAccountSubmitJobs = new Map<string, Promise<any>>();

export type SmartAccountAuthenticatorSigningCallback = (
  authenticator: SmartAccountValidatorModule['id']
) => void;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify((value as any)[key])}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const getSmartAccountSubmitJobKey = async ({
  accountId,
  executions,
  smartAccount,
}: {
  accountId?: number;
  executions: SmartAccountExecutionIntent[];
  smartAccount: ISmartAccountMetadata;
}) =>
  sha256Hex(
    stableStringify({
      account: (smartAccount as any)?.address?.toLowerCase?.() ?? null,
      accountId: accountId ?? null,
      authValidator: smartAccount.auth?.validator?.toLowerCase?.() ?? null,
      chainId: smartAccount.chainId,
      executions: executions.map((execution) => ({
        data: execution.data || '0x',
        target: execution.target.toLowerCase(),
        value: execution.value,
      })),
    })
  );

export type SubmitSmartAccountExecutionsParams = {
  accountId?: number;
  authenticatorContexts?: SmartAccountAuthenticatorRuntimeContexts;
  controllerEmitter: ControllerEmitter;
  enablePaymasterApprovalSetup?: boolean;
  executions: SmartAccountExecutionIntent[];
  onAssertionResolved?: () => void;
  onAuthenticatorSigningResolved?: SmartAccountAuthenticatorSigningCallback;
  onAuthenticatorSigningStarted?: SmartAccountAuthenticatorSigningCallback;
  onPaymasterApprovalConfirmed?: () => void;
  onPaymasterApprovalRequired?: (
    setup: SmartAccountPaymasterApprovalSetup
  ) => boolean | Promise<boolean>;
  onPrepared?: () => void;
  skipPaymaster?: boolean;
  skipRapidPolling?: boolean;
  smartAccount: ISmartAccountMetadata;
  useCachedMetadata?: boolean;
  waitForConfirmation?: boolean;
};

export type SmartAccountAuthenticatorSignature = {
  proof?: unknown;
  signature: string;
  validator?: string;
};

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
  owner: SmartAccountLocalOwner;
}) => Promise<string>;

export type SmartAccountAuthenticatorRuntimeContexts = Partial<
  Record<SmartAccountValidatorModule['id'], unknown>
>;

type EcdsaAuthenticatorRuntimeContext = {
  localOwners?: SmartAccountLocalOwner[];
  signActionHash?: SmartAccountLocalEcdsaSigner;
};

type P256WebAuthnAuthenticatorRuntimeContext = {
  onBackupStatus?: (backupStatus: unknown) => Promise<void> | void;
};

export type SmartAccountSLHDSASigner = (params: {
  actionHash: string;
  keyId: string;
  parameterSet: 'SLH-DSA-SHA2-128-24';
  pkRoot: string;
  pkSeed: string;
}) => Promise<string>;

type SLHDSAAuthenticatorRuntimeContext = {
  signActionHash?: SmartAccountSLHDSASigner;
};

const stringifyError = (error: unknown): string => {
  if (!error || typeof error !== 'object') {
    return '';
  }

  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
};

const getErrorText = (error: unknown, depth = 0): string => {
  if (!error || depth > 4) {
    return '';
  }
  if (typeof error === 'string') {
    try {
      return [error, getErrorText(JSON.parse(error), depth + 1)]
        .filter(Boolean)
        .join(' ');
    } catch {
      return error;
    }
  }
  if (typeof error !== 'object') {
    return String(error);
  }

  const errorRecord = error as Record<string, unknown>;
  const parts = [
    errorRecord.message,
    errorRecord.reason,
    errorRecord.code,
    errorRecord.data,
    errorRecord.error,
    errorRecord.body,
    errorRecord.response,
    errorRecord.info,
    stringifyError(error),
    ...Object.getOwnPropertyNames(error)
      .filter((key) => key !== 'stack')
      .map((key) => errorRecord[key]),
  ].flatMap((value) => {
    if (!value) {
      return [];
    }
    if (typeof value === 'string') {
      try {
        return [value, getErrorText(JSON.parse(value), depth + 1)];
      } catch {
        return [value];
      }
    }
    return [getErrorText(value, depth + 1)];
  });

  return parts.filter(Boolean).join(' ');
};

const isSmartAccountSignatureError = (error: unknown) => {
  const message = getErrorText(error);
  return (
    message.includes('AA24') ||
    message.includes('PALI_SMART_ACCOUNT_SIGNATURE_ERROR') ||
    message.includes('41413234207369676e6174757265206572726f72')
  );
};

export class SmartAccountExternalSignatureRequired extends Error {
  public readonly request: SmartAccountExternalSignatureRequest;

  constructor(request: SmartAccountExternalSignatureRequest) {
    super(request.message);
    this.name = 'SmartAccountExternalSignatureRequired';
    this.request = request;
  }
}

export const getSmartAccountLocalOwnerContexts = ({
  accounts,
  controllerEmitter,
}: {
  accounts: Record<string, Record<string, any>>;
  controllerEmitter: ControllerEmitter;
}): SmartAccountAuthenticatorRuntimeContexts => {
  const ownerTypes: KeyringAccountType[] = [
    'HDAccount' as KeyringAccountType,
    'Imported' as KeyringAccountType,
    'Ledger' as KeyringAccountType,
    'Trezor' as KeyringAccountType,
  ];
  const localOwners = ownerTypes.flatMap((type) =>
    Object.entries(accounts[type] || {}).flatMap(
      ([id, walletAccount]: [string, any]) => {
        try {
          return [
            {
              address: getAddress(walletAccount.address),
              id: Number(id),
              type,
            },
          ];
        } catch {
          return [];
        }
      }
    )
  );

  return {
    ecdsa: {
      localOwners,
      signActionHash: ({ actionHash, owner }) =>
        controllerEmitter(
          ['wallet', 'ethSignWithAccount'],
          [[owner.address, actionHash], { id: owner.id, type: owner.type }],
          owner.type === 'Ledger' || owner.type === 'Trezor' ? 300000 : 10000
        ) as Promise<string>,
    },
    'slh-dsa': {
      signActionHash: (params) =>
        controllerEmitter(
          ['wallet', 'signSLHDSAActionHash'],
          [params],
          600000
        ) as Promise<string>,
    },
  };
};

export type SmartAccountAuthenticatorContext<
  T extends SmartAccountValidatorModule
> = {
  actionHash: string;
  runtimeContext?: unknown;
  smartAccount: ISmartAccountMetadata;
  validator: T;
};

export interface SmartAccountAuthenticatorDriver<
  T extends SmartAccountValidatorModule = SmartAccountValidatorModule
> {
  createExternalSignatureRequest: (
    context: SmartAccountAuthenticatorContext<T>
  ) => SmartAccountExternalSignatureRequest;
  id: T['id'];
  signActionHash: (
    context: SmartAccountAuthenticatorContext<T>
  ) => Promise<SmartAccountAuthenticatorSignature>;
}

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
      getP256WebAuthnExternalSignatureMetadata(context.validator.config)
    ),
  id: 'p256-webauthn',
  signActionHash: async ({ actionHash, runtimeContext, validator }) => {
    const signature = await signP256WebAuthnActionHash({
      actionHash,
      credentialId: validator.config.credentialId || undefined,
      expectedCredentialIdHash: validator.config.credentialIdHash,
      expectedPublicKey: validator.config.publicKey,
    });
    const p256Context = runtimeContext as
      | P256WebAuthnAuthenticatorRuntimeContext
      | undefined;
    if (signature.backupStatus) {
      await p256Context?.onBackupStatus?.(signature.backupStatus);
    }

    return {
      proof: signature.proof,
      signature: signature.signature,
    };
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
    const runtimeContext = context.runtimeContext as
      | EcdsaAuthenticatorRuntimeContext
      | undefined;
    const localOwners = (runtimeContext?.localOwners || []).filter((owner) =>
      context.validator.config.owners.some(
        (configuredOwner) =>
          configuredOwner.toLowerCase() === owner.address.toLowerCase()
      )
    );
    const threshold = context.validator.config.threshold;

    if (runtimeContext?.signActionHash && localOwners.length >= threshold) {
      const signatures = await Promise.all(
        localOwners.slice(0, threshold).map((owner) =>
          runtimeContext.signActionHash({
            actionHash: context.actionHash,
            owner,
          })
        )
      );

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
  signActionHash: async ({ actionHash, runtimeContext, validator }) => {
    const slhDsaContext = runtimeContext as
      | SLHDSAAuthenticatorRuntimeContext
      | undefined;
    const signature = await slhDsaContext?.signActionHash?.({
      actionHash,
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

  return driver as SmartAccountAuthenticatorDriver<T>;
};

export const getSmartAccountExternalSignatureRequest = (params: {
  actionHash: string;
  authenticatorContexts?: SmartAccountAuthenticatorRuntimeContexts;
  smartAccount: ISmartAccountMetadata;
}): SmartAccountExternalSignatureRequest => {
  const validator = getCurrentValidatorModule(params.smartAccount);
  const driver = getAuthenticatorDriver(validator);
  return driver.createExternalSignatureRequest({
    actionHash: params.actionHash,
    runtimeContext: params.authenticatorContexts?.[validator.id],
    smartAccount: params.smartAccount,
    validator,
  });
};

// 4337/paymaster gas abstraction is intentionally not an authenticator.
// Authenticators prove authorization for the account action; bundlers/paymasters
// choose how that authorized action is submitted and paid for.
export type SmartAccountGasPolicy =
  | {
      paymasterData?: string;
      paymasterService?: string;
      type: 'erc4337-paymaster';
    }
  | { type: 'self-funded' };

export const signSmartAccountActionHash = async (params: {
  actionHash: string;
  authenticatorContexts?: SmartAccountAuthenticatorRuntimeContexts;
  onAuthenticatorSigningResolved?: SmartAccountAuthenticatorSigningCallback;
  onAuthenticatorSigningStarted?: SmartAccountAuthenticatorSigningCallback;
  smartAccount: ISmartAccountMetadata;
}): Promise<SmartAccountAuthenticatorSignature> => {
  const validator = getCurrentValidatorModule(params.smartAccount);
  const driver = getAuthenticatorDriver(validator);

  params.onAuthenticatorSigningStarted?.(validator.id);
  const signature = await driver
    .signActionHash({
      actionHash: params.actionHash,
      runtimeContext: params.authenticatorContexts?.[validator.id],
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

export const encodeSmartAccountAuthenticatorSignature = (
  signature: SmartAccountAuthenticatorSignature | string
) => {
  if (typeof signature === 'string') {
    return signature;
  }
  return signature.validator
    ? hexConcat([getAddress(signature.validator), signature.signature])
    : signature.signature;
};

export const signAndSubmitSmartAccountExecutions = async (
  params: SubmitSmartAccountExecutionsParams
) => {
  const {
    accountId,
    authenticatorContexts,
    controllerEmitter,
    enablePaymasterApprovalSetup = true,
    executions,
    onAssertionResolved,
    onAuthenticatorSigningResolved,
    onAuthenticatorSigningStarted,
    onPaymasterApprovalConfirmed,
    onPaymasterApprovalRequired,
    onPrepared,
    skipPaymaster,
    skipRapidPolling,
    smartAccount,
    useCachedMetadata,
    waitForConfirmation,
  } = params;
  const validatorForJob = getCurrentValidatorModule(smartAccount);
  const shouldTrackJob = validatorForJob.id === 'slh-dsa';
  const submitJobKey = shouldTrackJob
    ? await getSmartAccountSubmitJobKey({
        accountId,
        executions,
        smartAccount,
      })
    : '';

  const prepareSignAndSubmit = async (
    useCachedMetadataOverride?: boolean,
    skipPaymaster = false
  ) => {
    const prepared = (await controllerEmitter(
      ['wallet', 'prepareSmartAccountExecutions'],
      [
        executions,
        accountId,
        {
          skipPaymaster,
          useCachedMetadata: useCachedMetadataOverride,
        },
      ],
      300000
    )) as any;
    onPrepared?.();

    if (
      enablePaymasterApprovalSetup &&
      !skipPaymaster &&
      prepared.paymasterApprovalSetup &&
      onPaymasterApprovalRequired
    ) {
      const approved = await onPaymasterApprovalRequired(
        prepared.paymasterApprovalSetup
      );
      if (!approved) {
        if (prepared.paymasterApprovalSetup.required) {
          throw new Error('zkSYS gas approval was not authorized');
        }
      } else {
        await signAndSubmitSmartAccountExecutions({
          accountId,
          authenticatorContexts,
          controllerEmitter,
          enablePaymasterApprovalSetup: false,
          executions: [prepared.paymasterApprovalSetup.execution],
          onAuthenticatorSigningResolved,
          onAuthenticatorSigningStarted,
          skipPaymaster: true,
          skipRapidPolling: true,
          smartAccount: prepared.smartAccount || smartAccount,
          useCachedMetadata: useCachedMetadataOverride,
          waitForConfirmation: true,
        });
        onPaymasterApprovalConfirmed?.();

        return prepareSignAndSubmit(useCachedMetadataOverride, false);
      }
    }
    if (prepared.paymasterApprovalSetup?.required) {
      throw new Error('zkSYS gas approval is required before this operation');
    }

    const signature = await signSmartAccountActionHash({
      actionHash: prepared.actionHash,
      authenticatorContexts,
      onAuthenticatorSigningResolved,
      onAuthenticatorSigningStarted,
      smartAccount: prepared.smartAccount || smartAccount,
    });
    onAssertionResolved?.();

    try {
      const result = await controllerEmitter(
        ['wallet', 'submitSmartAccountExecution'],
        [
          {
            executionCalldata: prepared.executionCalldata,
            executions: prepared.executions,
            accountId,
            mode: prepared.mode,
            signature: signature.signature,
            skipRapidPolling,
            userOperation: prepared.userOperation,
            validator: prepared.validator,
            waitForConfirmation,
          },
        ],
        300000
      );
      return result;
    } catch (error) {
      const usedOptionalPaymaster =
        !skipPaymaster &&
        hasSmartAccountPaymaster(prepared.userOperation) &&
        prepared.paymasterRequired !== true;

      if (usedOptionalPaymaster) {
        return prepareSignAndSubmit(useCachedMetadataOverride, true);
      }
      throw error;
    }
  };

  const run = async () => {
    try {
      return await prepareSignAndSubmit(useCachedMetadata, skipPaymaster);
    } catch (error) {
      if (useCachedMetadata !== false && isSmartAccountSignatureError(error)) {
        return await prepareSignAndSubmit(false, skipPaymaster);
      }
      throw error;
    }
  };

  if (!shouldTrackJob) {
    return run();
  }

  const inFlightJob = smartAccountSubmitJobs.get(submitJobKey);
  if (inFlightJob) {
    return inFlightJob;
  }

  const job = run();
  smartAccountSubmitJobs.set(submitJobKey, job);
  try {
    return await job;
  } finally {
    smartAccountSubmitJobs.delete(submitJobKey);
  }
};
