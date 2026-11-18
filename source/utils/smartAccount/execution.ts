import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard';
import {
  matchesSmartAccountPayerBudget,
  type SmartAccountFeeQuote,
} from '../../shared/smartAccountFeeQuote';
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
  signSmartAccountWithValidator,
  type SmartAccountAuthenticatorPorts,
  type SmartAccountAuthenticatorSigningCallback,
  type SmartAccountLocalOwner,
  type SmartAccountLocalEcdsaSigner,
  type SmartAccountSLHDSASigner,
} from './authenticatorDispatch';
import {
  collectCompositePolicyPossession,
  type createCompositePolicyPossession,
} from './compositePossession';
import {
  snapshotSmartAccountExpectedErc20Transfers,
  type SmartAccountExpectedErc20Transfer,
} from './erc20Transfer';
import { assertSmartAccountOwnerSigningIntent } from './ownerSigningIntent';
import type { SmartAccountAuthenticatorSignature } from './signature';
import { canUseReservedSLHDSASignature } from './slhDsaPurpose';
import type { SmartAccountControllerCallOptions } from '../../shared/smartAccountControllerAuthority';

export type { SmartAccountFeeQuote } from '../../shared/smartAccountFeeQuote';

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
  retryConnection?: boolean,
  options?: SmartAccountControllerCallOptions
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
  expectedErc20Transfers,
  expectedContext,
  feeOverrides,
  approvedFeeQuote,
  smartAccount,
}: {
  accountAddress?: string;
  accountId?: number;
  approvedFeeQuote?: Pick<
    SmartAccountFeeQuote,
    'feePayer' | 'maximumFeeWei' | 'executionContextId'
  >;
  executions: SmartAccountExecutionIntent[];
  expectedContext?: IEvmTransactionContext;
  expectedErc20Transfers?: readonly SmartAccountExpectedErc20Transfer[];
  feeOverrides?: SmartAccountFeeOverrides;
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
      expectedErc20Transfers: expectedErc20Transfers ?? null,
      expectedContext: expectedContext ?? null,
      feeOverrides: {
        gasPrice: feeOverrides?.gasPrice ?? null,
        maxFeePerGas: feeOverrides?.maxFeePerGas ?? null,
        maxPriorityFeePerGas: feeOverrides?.maxPriorityFeePerGas ?? null,
      },
      approvedFeeQuote: approvedFeeQuote ?? null,
    })
  );

export type SmartAccountExecutionFeeConsent =
  SmartAccountControllerCallOptions & {
    confirmEntryPoint(
      quote: SmartAccountFeeQuote & { executionContextId: string }
    ): Promise<string | null>;
  };

export type SubmitSmartAccountExecutionsParams = {
  accountAddress?: string;
  accountId?: number;
  approvedFeeQuote?: Pick<
    SmartAccountFeeQuote,
    | 'feePayer'
    | 'maximumFeeWei'
    | 'executionContextId'
    | 'cancellationPayerBudget'
    | 'payerBudget'
  >;
  authenticatorContexts?: SmartAccountAuthenticatorRuntimeContexts;
  controllerEmitter: ControllerEmitter;
  executions: SmartAccountExecutionIntent[];
  expectedContext?: IEvmTransactionContext;
  expectedErc20Transfers?: readonly SmartAccountExpectedErc20Transfer[];
  feeConsent?: SmartAccountExecutionFeeConsent;
  feeOverrides?: SmartAccountFeeOverrides;
  onAssertionResolved?: () => void;
  onAuthenticatorSigningResolved?: SmartAccountAuthenticatorSigningCallback;
  onAuthenticatorSigningStarted?: SmartAccountAuthenticatorSigningCallback;
  onBeforeAuthentication?: () => void;
  onBeforeSubmit?: (
    prepared: Readonly<{ executionContextId: string }>
  ) => Promise<void>;
  onPrepared?: () => void;
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

// This is a wallet-internal read-only preparation, not a provider method or
// an app-supplied estimate. Approval must bind the exact ordered executions.
export const prepareSmartAccountFeeQuote = async ({
  accountAddress,
  accountId,
  controllerEmitter,
  executions,
  expectedErc20Transfers,
  expectedContext,
  feeOverrides,
  includePayerBudget,
  maximumGasUnits,
}: {
  accountAddress: string;
  accountId?: number;
  controllerEmitter: ControllerEmitter;
  executions: SmartAccountExecutionIntent[];
  expectedContext?: IEvmTransactionContext;
  expectedErc20Transfers?: readonly SmartAccountExpectedErc20Transfer[];
  feeOverrides?: SmartAccountFeeOverrides;
  includePayerBudget?: true;
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
      {
        ...(expectedContext ? { expectedContext } : {}),
        ...(includePayerBudget ? { includePayerBudget } : {}),
        feeOverrides,
        expectedErc20Transfers: snapshotSmartAccountExpectedErc20Transfers(
          expectedErc20Transfers
        ),
      },
    ],
    300000
  );
  const userOp = prepared?.userOperation;
  const payer = prepared?.gasPayer;
  const payerBudget = prepared?.entryPointFeeQuote?.payerBudget;
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
    !/^0x[\da-f]{64}$/i.test(userOp?.gasFees || '') ||
    !Number.isSafeInteger(payer?.id) ||
    payer.id < 0 ||
    !['HDAccount', 'Imported', 'Ledger', 'Trezor'].includes(payer?.type) ||
    typeof payer?.address !== 'string' ||
    (includePayerBudget &&
      (typeof payerBudget?.gasTank !== 'boolean' ||
        prepared.entryPointFeeQuote.executionContextId !==
          prepared.executionContextId ||
        payerBudget.maximumFeeWei !==
          quantity(payerBudget.maximumFeeWei).toString() ||
        payerBudget.maximumPrefundWei !==
          quantity(payerBudget.maximumPrefundWei).toString() ||
        payerBudget.maximumPrefundFeeWei !==
          quantity(payerBudget.maximumPrefundFeeWei).toString()))
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
    executionContextId: prepared.executionContextId,
    feePayer: {
      address: getAddress(payer.address),
      id: payer.id,
      type: payer.type,
    },
    gasUnits: gasUnits.toString(),
    maximumFeeWei: getSmartAccountUserOpRequiredPrefund(userOp).toString(),
    ...(includePayerBudget && {
      payerBudget: Object.freeze({ ...payerBudget }),
    }),
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
  availableKeyIds?: readonly string[];
  signActionHash?: SmartAccountSLHDSASigner;
  signMessageActionHash?: (keyId: string, validator: string) => Promise<string>;
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
        executionContextId,
        owner,
        validator,
      }: Parameters<SmartAccountLocalEcdsaSigner>[0]) => {
        if (signMessageActionHash)
          return signMessageActionHash(owner, validator);
        if (!executionContextId)
          throw new Error('Prepared Smart account operation is required');
        return controllerEmitter(
          ['wallet', 'signSmartAccountPreparedOwner'],
          [executionContextId, { id: owner.id, type: owner.type }],
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
          ...(slh.availableKeyIds !== undefined && {
            availableKeyIds: slh.availableKeyIds,
          }),
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
    expectedErc20Transfers: suppliedExpectedTransfers,
    expectedContext,
    feeOverrides,
    approvedFeeQuote,
    feeConsent,
    onAssertionResolved,
    onBeforeAuthentication,
    onAuthenticatorSigningResolved,
    onAuthenticatorSigningStarted,
    onBeforeSubmit,
    onPrepared,
    skipRapidPolling,
    trackLocalSubmission,
    smartAccount,
    useCachedMetadata,
    waitForConfirmation,
  } = params;
  const expectedErc20Transfers = snapshotSmartAccountExpectedErc20Transfers(
    suppliedExpectedTransfers
  );
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
        expectedErc20Transfers,
        expectedContext,
        feeOverrides,
        approvedFeeQuote,
        smartAccount,
      })
    : '';

  const prepareSignAndSubmit = async () => {
    const retainedContextId =
      useCachedMetadata !== false
        ? approvedFeeQuote?.executionContextId
        : undefined;
    const prepared = (await controllerEmitter(
      [
        'wallet',
        retainedContextId
          ? 'reuseSmartAccountExecutions'
          : 'prepareSmartAccountExecutions',
      ],
      [
        executions,
        accountId,
        {
          ...(expectedContext ? { expectedContext } : {}),
          ...(approvedFeeQuote?.payerBudget && !retainedContextId
            ? { includePayerBudget: true }
            : {}),
          feeOverrides,
          expectedErc20Transfers,
          useCachedMetadata,
          ...(retainedContextId
            ? { executionContextId: retainedContextId }
            : {}),
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
    if (approvedFeeQuote !== undefined) {
      if (
        !/^\d+$/.test(approvedFeeQuote.maximumFeeWei) ||
        ((approvedFeeQuote.cancellationPayerBudget ||
          approvedFeeQuote.payerBudget) &&
          approvedFeeQuote.executionContextId !==
            prepared.executionContextId) ||
        !matchesSmartAccountPayerBudget(
          approvedFeeQuote.payerBudget,
          prepared.entryPointFeeQuote?.payerBudget
        ) ||
        prepared.gasPayer?.id !== approvedFeeQuote.feePayer.id ||
        prepared.gasPayer?.type !== approvedFeeQuote.feePayer.type ||
        prepared.gasPayer?.address?.toLowerCase() !==
          approvedFeeQuote.feePayer.address.toLowerCase() ||
        getSmartAccountUserOpRequiredPrefund(prepared.userOperation).gt(
          approvedFeeQuote.maximumFeeWei
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
    const assertClientCurrent = () => {
      if (onBeforeAuthentication)
        assertSynchronousEvmFeeGuard(onBeforeAuthentication);
    };
    const assertContext = async () => {
      assertClientCurrent();
      if (prepared.executionContextId)
        await controllerEmitter(
          ['wallet', 'assertSmartAccountExecutionContext'],
          [prepared.executionContextId, prepared.actionHash]
        );
      assertClientCurrent();
    };
    await assertContext();

    const entryPointQuote = prepared.entryPointFeeQuote as
      | (SmartAccountFeeQuote & { executionContextId: string })
      | undefined;
    if (entryPointQuote) {
      if (
        entryPointQuote.executionContextId !== prepared.executionContextId ||
        entryPointQuote.maximumFeeWei !==
          getSmartAccountUserOpRequiredPrefund(
            prepared.userOperation
          ).toString() ||
        !matchesSmartAccountPayerBudget(
          entryPointQuote.cancellationPayerBudget,
          approvedFeeQuote?.cancellationPayerBudget
        ) ||
        (entryPointQuote.payerBudget !== undefined && !approvedFeeQuote) ||
        entryPointQuote.feePayer.id !== prepared.gasPayer?.id ||
        entryPointQuote.feePayer.type !== prepared.gasPayer?.type ||
        entryPointQuote.feePayer.address.toLowerCase() !==
          prepared.gasPayer?.address?.toLowerCase()
      )
        throw new Error(INVALID_FEE_QUOTE_ERROR);
      if (!approvedFeeQuote) {
        if (!feeConsent)
          throw new Error('Smart account fee approval is required');
        const accepted = await feeConsent.confirmEntryPoint(entryPointQuote);
        await assertContext();
        if (accepted !== prepared.executionContextId)
          throw Object.assign(
            new Error('Smart account fee approval cancelled'),
            { code: 4001, transactionNotBroadcast: true }
          );
      }
      await controllerEmitter(
        ['wallet', 'approveSmartAccountExecutionFeeQuote'],
        [prepared.executionContextId, entryPointQuote]
      );
      await assertContext();
    } else {
      throw new Error(INVALID_FEE_QUOTE_ERROR);
    }

    if (prepared.requiresCompositePossession === true) {
      const challenge = (await controllerEmitter(
        ['wallet', 'getSmartAccountCompositePossession'],
        [prepared.executionContextId]
      )) as ReturnType<typeof createCompositePolicyPossession> & {
        accountId: number;
        executionContextId: string;
      };
      await assertContext();
      if (
        !challenge ||
        challenge.accountId !== prepared.accountId ||
        challenge.executionContextId !== prepared.executionContextId ||
        challenge.intent.purpose !== 'policy-possession' ||
        challenge.intent.actionHash.toLowerCase() ===
          prepared.actionHash.toLowerCase()
      )
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      assertSmartAccountOwnerSigningIntent(challenge.intent);
      const basePorts = extensionAuthenticatorPorts(authenticatorContexts);
      const ports: SmartAccountAuthenticatorPorts = {
        ...basePorts,
        ecdsa: basePorts.ecdsa && {
          ...basePorts.ecdsa,
          signActionHash: ({ owner }) =>
            controllerEmitter(
              ['wallet', 'signSmartAccountCompositeOwner'],
              [prepared.executionContextId, { id: owner.id, type: owner.type }],
              owner.type === 'Ledger' || owner.type === 'Trezor'
                ? 300000
                : 10000
            ),
        },
        // Possession has its own prepared-context digest; never substitute a
        // general message-signing callback or the current transaction digest.
        slhDsa: basePorts.slhDsa && {
          signActionHash: basePorts.slhDsa.signActionHash,
          signMessageActionHash: null,
        },
      };
      await collectCompositePolicyPossession({
        proposal: challenge.proposal,
        assertCurrent: assertClientCurrent,
        sign: async (validator) => {
          const proof = await signSmartAccountWithValidator({
            assertBeforeAuthentication: assertContext,
            accountId: prepared.accountId,
            actionHash: challenge.intent.actionHash,
            executionContextId: prepared.executionContextId,
            onAuthenticatorSigningResolved,
            onAuthenticatorSigningStarted,
            ports,
            smartAccount: challenge.smartAccount,
            validator,
          });
          return proof.signature;
        },
        verify: async (signatures) => {
          await assertContext();
          const result = await controllerEmitter(
            ['wallet', 'verifySmartAccountCompositePossession'],
            [prepared.executionContextId, [...signatures]]
          );
          await assertContext();
          return result;
        },
      });
      await assertContext();
    }

    const signature = await signSmartAccountActionHash({
      assertBeforeAuthentication: assertContext,
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
    return controllerEmitter(
      ['wallet', 'submitSmartAccountExecution'],
      [
        {
          executionCalldata: prepared.executionCalldata,
          expectedErc20Transfers,
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
      false,
      feeConsent ? { confirmFee: feeConsent.confirmFee } : undefined
    );
  };

  // A signed UserOperation may already be executable after an estimate or
  // simulation, even when no outer payer transaction was broadcast. A failed
  // attempt must never create a fresh nonce authorization under this approval.
  if (!shouldTrackJob) {
    return prepareSignAndSubmit();
  }

  const inFlightJob = smartAccountSubmitJobs.get(submitJobKey);
  if (inFlightJob) {
    return inFlightJob;
  }

  const job = prepareSignAndSubmit();
  smartAccountSubmitJobs.set(submitJobKey, job);
  try {
    return await job;
  } finally {
    smartAccountSubmitJobs.delete(submitJobKey);
  }
};
