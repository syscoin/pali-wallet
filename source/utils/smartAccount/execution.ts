import { signP256WebAuthnActionHash } from '../passkey/authenticator';
import type {
  ISmartAccountMetadata,
  KeyringAccountType,
  SmartAccountValidatorModule,
} from 'types/network';
import { BigNumber } from 'utils/ethersV6Compat';
import { getAddress } from 'utils/ethersV6Compat';
import { hexDataSlice } from 'utils/ethersV6Compat';
import {
  EVM_TRANSACTION_CONTEXT_CHANGED,
  IEvmTransactionContext,
} from 'utils/evmTransactionContext';

import { getSmartAccountUserOpRequiredPrefund } from './account';
import {
  signSmartAccountActionHash as dispatchSmartAccountActionHash,
  type SmartAccountAuthenticatorPorts,
  type SmartAccountAuthenticatorSigningCallback,
  type SmartAccountLocalOwner,
  type SmartAccountLocalEcdsaSigner,
  type SmartAccountSLHDSASigner,
} from './authenticatorDispatch';
import type { SmartAccountAuthenticatorSignature } from './signature';
import { canUseReservedSLHDSASignature } from './slhDsaPurpose';

export {
  SmartAccountExternalSignatureRequired,
  getSmartAccountExternalSignatureRequest,
  type SmartAccountAuthenticatorSigningCallback,
  type SmartAccountLocalOwner,
  type SmartAccountLocalEcdsaSigner,
  type SmartAccountSLHDSASigner,
  type SmartAccountAuthenticatorSignature,
} from './authenticatorDispatch';

type ControllerEmitter = (
  methods: string[],
  payload?: any[],
  timeout?: number,
  retryConnection?: boolean
) => Promise<any>;

export type SmartAccountExecutionIntent = {
  data?: string;
  target: string;
  value: string;
};

const smartAccountSubmitJobs = new Map<string, Promise<any>>();
const INVALID_FEE_QUOTE_ERROR = 'Invalid smart account fee quote';
export const SMART_ACCOUNT_FEE_QUOTE_CHANGED =
  'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED';
export const isSmartAccountFeeQuoteChanged = (error: unknown): boolean =>
  (error as any)?.message === SMART_ACCOUNT_FEE_QUOTE_CHANGED &&
  (error as any)?.transactionNotBroadcast === true;

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
  accountAddress,
  accountId,
  executions,
  expectedContext,
  feeOverrides,
  maximumUserOpFeeWei,
  smartAccount,
}: {
  accountAddress?: string;
  accountId?: number;
  executions: SmartAccountExecutionIntent[];
  expectedContext?: IEvmTransactionContext;
  feeOverrides?: SmartAccountFeeOverrides;
  maximumUserOpFeeWei?: string;
  smartAccount: ISmartAccountMetadata;
}) =>
  sha256Hex(
    stableStringify({
      account:
        accountAddress?.toLowerCase?.() ||
        (smartAccount as any)?.address?.toLowerCase?.() ||
        null,
      accountId: accountId ?? null,
      authValidator: smartAccount.auth?.validator?.toLowerCase?.() ?? null,
      chainId: smartAccount.chainId,
      executions: executions.map((execution) => ({
        data: execution.data || '0x',
        target: execution.target.toLowerCase(),
        value: execution.value,
      })),
      expectedContext: expectedContext ?? null,
      feeOverrides: {
        gasPrice: feeOverrides?.gasPrice ?? null,
        maxFeePerGas: feeOverrides?.maxFeePerGas ?? null,
        maxPriorityFeePerGas: feeOverrides?.maxPriorityFeePerGas ?? null,
      },
      maximumUserOpFeeWei: maximumUserOpFeeWei ?? null,
    })
  );

export type SubmitSmartAccountExecutionsParams = {
  accountAddress?: string;
  accountId?: number;
  authenticatorContexts?: SmartAccountAuthenticatorRuntimeContexts;
  controllerEmitter: ControllerEmitter;
  executions: SmartAccountExecutionIntent[];
  expectedContext?: IEvmTransactionContext;
  feeOverrides?: SmartAccountFeeOverrides;
  maximumUserOpFeeWei?: string;
  onAssertionResolved?: () => void;
  onAuthenticatorSigningResolved?: SmartAccountAuthenticatorSigningCallback;
  onAuthenticatorSigningStarted?: SmartAccountAuthenticatorSigningCallback;
  onBeforeSubmit?: (
    prepared: Readonly<{ executionContextId: string }>
  ) => Promise<void>;
  onPrepared?: () => void;
  onSubmissionNotBroadcast?: () => Promise<void>;
  skipRapidPolling?: boolean;
  smartAccount: ISmartAccountMetadata;
  /** Internal wallet controls share only the same exact approval context. */
  trackLocalSubmission?: boolean;
  useCachedMetadata?: boolean;
  waitForConfirmation?: boolean;
};

export type SmartAccountFeeOverrides = {
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
};

export type SmartAccountFeeQuote = {
  gasUnits: string;
  maximumFeeWei: string;
};

// This is a wallet-internal read-only preparation, not a provider method or
// an app-supplied estimate. Approval must bind the exact ordered executions.
export const prepareSmartAccountFeeQuote = async ({
  accountAddress,
  accountId,
  controllerEmitter,
  executions,
  expectedContext,
  feeOverrides,
  maximumGasUnits,
}: {
  accountAddress: string;
  accountId?: number;
  controllerEmitter: ControllerEmitter;
  executions: SmartAccountExecutionIntent[];
  expectedContext?: IEvmTransactionContext;
  feeOverrides?: SmartAccountFeeOverrides;
  maximumGasUnits?: string;
}): Promise<SmartAccountFeeQuote> => {
  const quantity = (value: unknown) => {
    if (
      value !== null &&
      typeof value === 'object' &&
      (value as any).type === 'BigNumber'
    )
      value = (value as any).hex;
    if (
      !BigNumber.isBigNumber(value) &&
      !(
        (typeof value === 'number' && Number.isSafeInteger(value)) ||
        (typeof value === 'string' &&
          /^(?:0x[\da-f]+|\d+)$/i.test(value) &&
          value.length <= 80)
      )
    )
      throw new Error(INVALID_FEE_QUOTE_ERROR);
    const parsed = BigNumber.from(value);
    if (parsed.lt(0) || parsed.gt(BigNumber.from(2).pow(256).sub(1)))
      throw new Error(INVALID_FEE_QUOTE_ERROR);
    return parsed;
  };
  if (
    !executions.length ||
    (expectedContext &&
      expectedContext.account.address.toLowerCase() !==
        accountAddress.toLowerCase())
  )
    throw new Error(INVALID_FEE_QUOTE_ERROR);
  const prepared = await controllerEmitter(
    ['wallet', 'prepareSmartAccountExecutions'],
    [
      executions,
      accountId,
      { ...(expectedContext ? { expectedContext } : {}), feeOverrides },
    ],
    300000
  );
  const userOp = prepared?.userOperation;
  if (
    !prepared?.executionContextId ||
    !Array.isArray(prepared.executions) ||
    prepared.executions.length !== executions.length ||
    prepared.executions.some((quoted: any, index: number) => {
      const execution = executions[index];
      return (
        quoted?.target?.toLowerCase() !== execution.target.toLowerCase() ||
        String(quoted?.data || '0x').toLowerCase() !==
          (execution.data || '0x').toLowerCase() ||
        !quantity(quoted?.value).eq(quantity(execution.value))
      );
    }) ||
    userOp?.sender?.toLowerCase() !== accountAddress.toLowerCase() ||
    !/^0x[\da-f]{64}$/i.test(userOp?.accountGasLimits || '') ||
    !/^0x[\da-f]{64}$/i.test(userOp?.gasFees || '')
  )
    throw new Error(INVALID_FEE_QUOTE_ERROR);
  const gasUnits = quantity(hexDataSlice(userOp.accountGasLimits, 0, 16))
    .add(quantity(hexDataSlice(userOp.accountGasLimits, 16, 32)))
    .add(quantity(userOp.preVerificationGas));
  const selectedMaxFee = feeOverrides
    ? quantity(feeOverrides.gasPrice ?? feeOverrides.maxFeePerGas)
    : null;
  const userOpMaxFee = quantity(hexDataSlice(userOp.gasFees, 16, 32));
  if (
    gasUnits.isZero() ||
    gasUnits.gt(Number.MAX_SAFE_INTEGER) ||
    (maximumGasUnits !== undefined && gasUnits.gt(quantity(maximumGasUnits))) ||
    (selectedMaxFee &&
      !userOpMaxFee.eq(selectedMaxFee) &&
      userOp.gasFees !== '0x' + '0'.repeat(64))
  )
    throw new Error(INVALID_FEE_QUOTE_ERROR);
  return {
    gasUnits: gasUnits.toString(),
    maximumFeeWei: getSmartAccountUserOpRequiredPrefund(userOp).toString(),
  };
};

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

type SLHDSAAuthenticatorRuntimeContext = {
  signActionHash?: SmartAccountSLHDSASigner;
  signMessageActionHash?: (keyId: string, validator: string) => Promise<string>;
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

export const getSmartAccountLocalOwnerContexts = ({
  accounts,
  controllerEmitter,
  messageSignValidator,
}: {
  accounts: Record<string, Record<string, any>>;
  controllerEmitter: ControllerEmitter;
  messageSignValidator?: string;
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

  const signMessageActionHash =
    messageSignValidator === undefined
      ? undefined
      : (signer: SmartAccountLocalOwner | string, validator: string) =>
          controllerEmitter(
            ['wallet', 'signSmartAccountMessageDigest'],
            [signer, messageSignValidator, validator],
            typeof signer === 'string'
              ? 600000
              : signer.type === 'Ledger' || signer.type === 'Trezor'
              ? 300000
              : undefined
          );

  return {
    ecdsa: {
      localOwners,
      signActionHash: ({
        actionHash,
        executionContextId,
        owner,
        validator,
      }: Parameters<SmartAccountLocalEcdsaSigner>[0]) => {
        if (signMessageActionHash)
          return signMessageActionHash(owner, validator);
        return controllerEmitter(
          ['wallet', 'signSmartAccountActionDigestInternal'],
          [
            [owner.address, actionHash],
            { id: owner.id, type: owner.type },
            ...(executionContextId ? [executionContextId] : []),
          ],
          owner.type === 'Ledger' || owner.type === 'Trezor' ? 300000 : 10000
        );
      },
    },
    'slh-dsa': {
      signActionHash: (params) =>
        controllerEmitter(['wallet', 'signSLHDSAActionHash'], [params], 600000),
      signMessageActionHash,
    } satisfies SLHDSAAuthenticatorRuntimeContext,
  };
};

// Gas abstraction is intentionally not an authenticator. Authenticators prove
// authorization for the account action; how that action is paid for is decided
// by the chain (e.g. zkSYS gas is native via the bootloader gas tank).
export type SmartAccountGasPolicy = { type: 'self-funded' };

function extensionAuthenticatorPorts(
  contexts?: SmartAccountAuthenticatorRuntimeContexts
): SmartAccountAuthenticatorPorts {
  const ecdsa = contexts?.ecdsa as EcdsaAuthenticatorRuntimeContext | undefined;
  const passkey = contexts?.['p256-webauthn'] as
    | P256WebAuthnAuthenticatorRuntimeContext
    | undefined;
  const slh = contexts?.['slh-dsa'] as
    | SLHDSAAuthenticatorRuntimeContext
    | undefined;
  return {
    ecdsa: ecdsa?.signActionHash
      ? {
          localOwners: ecdsa.localOwners ?? [],
          signActionHash: ecdsa.signActionHash,
        }
      : null,
    p256WebAuthn: {
      async signActionHash(request) {
        const result = await signP256WebAuthnActionHash(request);
        if (result.backupStatus)
          await passkey?.onBackupStatus?.(result.backupStatus);
        return { proof: result.proof, signature: result.signature };
      },
    },
    slhDsa: slh
      ? {
          signActionHash: slh.signActionHash ?? null,
          signMessageActionHash: slh.signMessageActionHash ?? null,
        }
      : null,
  };
}

export const signSmartAccountActionHash = (
  params: Omit<
    Parameters<typeof dispatchSmartAccountActionHash>[0],
    'ports'
  > & {
    authenticatorContexts?: SmartAccountAuthenticatorRuntimeContexts;
  }
): Promise<SmartAccountAuthenticatorSignature> =>
  dispatchSmartAccountActionHash({
    ...params,
    ports: extensionAuthenticatorPorts(params.authenticatorContexts),
  });

export { encodeSmartAccountAuthenticatorSignature } from './signature';

export const signAndSubmitSmartAccountExecutions = async (
  params: SubmitSmartAccountExecutionsParams
) => {
  const {
    accountAddress,
    accountId,
    authenticatorContexts,
    controllerEmitter,
    executions,
    expectedContext,
    feeOverrides,
    maximumUserOpFeeWei,
    onAssertionResolved,
    onAuthenticatorSigningResolved,
    onAuthenticatorSigningStarted,
    onBeforeSubmit,
    onPrepared,
    onSubmissionNotBroadcast,
    skipRapidPolling,
    trackLocalSubmission,
    smartAccount,
    useCachedMetadata,
    waitForConfirmation,
  } = params;
  const validatorIdForJob =
    smartAccount.auth?.module || smartAccount.auth?.scheme;
  // An external approval owns its own context checks and durable submit marker.
  const shouldTrackJob =
    (validatorIdForJob === 'slh-dsa' || validatorIdForJob === 'composite') &&
    (!expectedContext || trackLocalSubmission === true);
  const submitJobKey = shouldTrackJob
    ? await getSmartAccountSubmitJobKey({
        accountAddress,
        accountId,
        executions,
        expectedContext,
        feeOverrides,
        maximumUserOpFeeWei,
        smartAccount,
      })
    : '';

  let submissionStarted = false;
  const prepareSignAndSubmit = async (useCachedMetadataOverride?: boolean) => {
    submissionStarted = false;
    const prepared = (await controllerEmitter(
      ['wallet', 'prepareSmartAccountExecutions'],
      [
        executions,
        accountId,
        {
          ...(expectedContext ? { expectedContext } : {}),
          feeOverrides,
          useCachedMetadata: useCachedMetadataOverride,
        },
      ],
      300000
    )) as any;
    if (
      !Number.isSafeInteger(prepared.accountId) ||
      prepared.accountId < 0 ||
      !prepared.executionContextId ||
      (accountId !== undefined && prepared.accountId !== accountId)
    )
      throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
        transactionNotBroadcast: true,
      });
    if (maximumUserOpFeeWei !== undefined) {
      if (
        !/^\d+$/.test(maximumUserOpFeeWei) ||
        getSmartAccountUserOpRequiredPrefund(prepared.userOperation).gt(
          maximumUserOpFeeWei
        )
      ) {
        throw Object.assign(new Error(SMART_ACCOUNT_FEE_QUOTE_CHANGED), {
          transactionNotBroadcast: true,
        });
      }
    }
    onPrepared?.();
    if (expectedContext && !prepared.executionContextId)
      throw Object.assign(new Error(EVM_TRANSACTION_CONTEXT_CHANGED), {
        transactionNotBroadcast: true,
      });
    const assertContext = async () => {
      if (prepared.executionContextId)
        await controllerEmitter(
          ['wallet', 'assertSmartAccountExecutionContext'],
          [prepared.executionContextId, prepared.actionHash]
        );
    };
    await assertContext();

    const signature = await signSmartAccountActionHash({
      assertBeforeAuthentication: async () => {
        await controllerEmitter(
          ['wallet', 'assertSmartAccountPreparedNonce'],
          [prepared.executionContextId, prepared.actionHash]
        );
      },
      accountId: prepared.accountId,
      actionHash: prepared.actionHash,
      executionContextId: prepared.executionContextId,
      allowReservedSLHDSASignature: canUseReservedSLHDSASignature({
        accountAddress,
        executions: prepared.executions,
        smartAccount: prepared.smartAccount || smartAccount,
      }),
      authenticatorContexts,
      onAuthenticatorSigningResolved,
      onAuthenticatorSigningStarted,
      smartAccount: prepared.smartAccount || smartAccount,
    });
    await assertContext();
    onAssertionResolved?.();

    await onBeforeSubmit?.(
      Object.freeze({
        executionContextId: prepared.executionContextId,
      })
    );
    await assertContext();
    submissionStarted = true;
    return controllerEmitter(
      ['wallet', 'submitSmartAccountExecution'],
      [
        {
          executionCalldata: prepared.executionCalldata,
          executions: prepared.executions,
          accountId: prepared.accountId,
          executionContextId: prepared.executionContextId,
          expectedContext,
          gasPayer: prepared.gasPayer,
          gasPrice: prepared.gasPrice,
          maxFeePerGas: prepared.maxFeePerGas,
          maxPriorityFeePerGas: prepared.maxPriorityFeePerGas,
          mode: prepared.mode,
          signature: signature.signature,
          skipRapidPolling,
          userOperation: prepared.userOperation,
          validator: prepared.validator,
          waitForConfirmation,
        },
      ],
      300000,
      false
    );
  };

  const run = async () => {
    try {
      return await prepareSignAndSubmit(useCachedMetadata);
    } catch (error) {
      if (
        useCachedMetadata !== false &&
        isSmartAccountSignatureError(error) &&
        !(error as any)?.transactionHash &&
        (error as any)?.transactionNotBroadcast !== false &&
        (!submissionStarted || (error as any)?.transactionNotBroadcast === true)
      ) {
        // A host's durable begin must be settled before a refreshed operation
        // can acquire the reservation. Unknown submissions never reach here.
        if (submissionStarted) await onSubmissionNotBroadcast?.();
        return await prepareSignAndSubmit(false);
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
