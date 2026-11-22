import { withEvmReadPhase } from '../../../../source/shared/evmReadPhase.ts';
import { assertNativeSmartModuleCommandCurrent } from './modules.ts';
import { preflightCustomValidatorInstall } from '../../../../source/utils/smartAccount/custom.ts';
import { buildSmartAccountUserOpSigningIntent } from '../../../../source/utils/smartAccount/userOperationHash.ts';
import type { SmartAccountOwnerSigningIntent } from '../../../../source/utils/smartAccount/ownerSigningIntent.ts';
import {
  createSmartAccountPendingState,
  type SmartAccountPendingState,
} from '../../../../source/utils/smartAccount/pendingState.ts';
import { assertSmartAccountBuiltinInstallCurrent } from '../../../../source/utils/smartAccount/moduleCommands.ts';
import { assertSmartAccountValidatorSwitchCurrent } from '../../../../source/utils/smartAccount/validatorSwitch.ts';
import {
  createSmartAccountCallsExecutions,
  normalizeDappCallsRequest,
} from '../../../../source/shared/dappCalls.ts';
import { assertSmartAccountAuthorizationReceipt, resolveSmartAccountAuthorization, type SmartAccountAuthorizationReceipt, type SmartAccountPendingRecords } from '../../../../source/wallet/evmSignedRecords.ts';
import type { SmartAccountAuthorizationBlock } from '../../../../source/wallet/smartAccountAuthorization.ts';
import { assertSmartAccountCancellation, assertSmartAccountCancellationOperation, inspectSmartAccountCancellationPayer,
  smartAccountCancellationExecutions, smartAccountCancellationPendingRecords, type SmartAccountCancellation,
  type SmartAccountCancellationDispatch } from '../../../../source/wallet/smartAccountCancellation.ts';
import type { EvmAutoNonceSnapshot } from '../../../../source/shared/evmAutoNonce.ts';
import type { SmartAccountActivityIdentity } from '../../../../source/wallet/smartAccountActivity.ts';
import { buildSmartAccountNftTransfer } from '../../../../source/utils/smartAccount/nftTransfer.ts';
import { buildSmartAccountErc20Transfer, snapshotSmartAccountExpectedErc20Transfers } from '../../../../source/utils/smartAccount/erc20Transfer.ts';
import { assertSmartAccountSpendability } from '../../../../source/utils/smartAccount/assetSpendability.ts';
import { getSmartAccountUserOpRequiredPrefund, SMART_ACCOUNT_ZERO_GAS_FEES } from '../../../../source/utils/smartAccount/account.ts';
import { getZkSysGasTankAddress } from '../../../../source/utils/smartAccount/deploymentMetadata.ts';
import { assertSmartAccountPayerFee, getSmartAccountPayerBudget } from '../../../../source/utils/smartAccount/cancellationFee.ts';
import { SMART_ACCOUNT_PAYER_BUDGET_EXCEEDED, type SmartAccountPayerBudget } from '../../../../source/shared/smartAccountFeeQuote.ts';
import type { SmartAccountPackedUserOperation } from '../../../../source/utils/smartAccount/account.ts';
import { buildGuardianPolicyExecutions } from '../../../../source/utils/smartAccount/guardianPolicy.ts';
import type { EvmFeeFunding } from '../../../../source/shared/evmFeeApproval.ts';
import { assertSmartAccountTargetsAllowed } from '../../../../source/utils/smartAccount/targetPolicy.ts';
import { getBlacklistTargetsForEvmCall } from '../../../../source/shared/evmCallBlacklist.ts';
import { canUseReservedSLHDSASignature } from '../../../../source/utils/smartAccount/slhDsaPurpose.ts';
import { getSmartAccountSigningPlan, type SmartAccountAuthenticatorPorts } from '../../../../source/utils/smartAccount/authenticatorDispatch.ts';
import { captureCompositePolicyChange, collectCompositePolicyPossession, compositeSourceConfiguration,
  createCompositePolicyPossession, verifyCompositePolicyPossession, type CompositePolicyChange } from '../../../../source/utils/smartAccount/compositePossession.ts';
import { getPaliEntryPointAddress, paliEcdsaValidatorInterface } from '../../../../source/utils/smartAccount/contracts.ts';
import type { IBlacklistCheckResult } from '../../../../source/types/security.ts';
import {
  hasUsableSmartAccountAuthMetadata,
  readSmartAccountValidatorMetadata,
} from '../../../../source/utils/smartAccount/executionMetadata.ts';
import { readSmartAccountDeploymentState } from '../../../../source/utils/smartAccount/deploymentState.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import {
  prepareSmartAccountOperation,
  type SmartAccountGasPayer,
} from '../../../../source/utils/smartAccount/prepareOperation.ts';
import {
  assertNativeSmartAccountAuthenticator,
  signNativeSmartAccountActionHash,
  type NativeSmartAccountSigningOwner,
} from './authenticatorSigning.ts';
import {
  submitSmartAccountOperation,
  type SmartAccountSubmitHost,
} from '../../../../source/utils/smartAccount/submitOperation.ts';
import {
  canUseSmartAccountGasTank,
  ensureSmartAccountDeploymentPrefund,
  getSmartAccountGasPayerCandidates,
  readSmartAccountDeploymentShortfall,
  selectSmartAccountGasPayer,
  type SmartAccountPayerWallet,
} from '../../../../source/utils/smartAccount/payerPolicy.ts';
import type {
  IKeyringAccountState,
  ISmartAccountMetadata,
  SmartAccountCustomModuleRecord,
} from '../../../../source/types/network.ts';
import type { NativePreparedConnectionTransaction } from '../connections/transactionRuntime.ts';
import type { NativeNetworkRegistration } from '../custody/networkContext.ts';
import { EvmTransferReadRpc } from '../custody/evmTransferReadRpc.ts';
import { EvmTransferReadError } from '../custody/evmFeeContracts.ts';
import { snapshotEvmFeeChoice } from '../../../../source/shared/transactionFeeChoice.ts';
import {
  NativeSmartAccountOperation,
  SmartAccountPayerQuoteUnavailable,
  type NativeSmartAccountIntent,
  type PreparedSmartAccountOperation,
} from './operation.ts';
import { createNativeSmartAccountProvider } from './provider.ts';
import { createSmartAccountInfrastructureReader, infrastructureCodeAddresses,
  assertSmartAccountInfrastructureReady } from '../../../../source/utils/smartAccount/infrastructureObservation.ts';

const infrastructureReaders = new WeakMap<SmartAccountPayerWallet, ReturnType<typeof createSmartAccountInfrastructureReader>>();

type Response = { hash: string; wait(): Promise<unknown> };
export type NativeSmartPayerAdmission = (provider: unknown, currentSignedHash?: string, admission?: EvmAutoNonceSnapshot, signedRaw?: string) => Promise<void>;
export type NativeSmartOperationPorts = Readonly<{
  intent: NativeSmartAccountIntent;
  pendingRecords: SmartAccountPendingRecords;
  cancellation?: SmartAccountCancellation;
  account: IKeyringAccountState & { smartAccount: ISmartAccountMetadata };
  network: NativeNetworkRegistration;
  rpc: EvmTransferReadRpc;
  wallet: SmartAccountPayerWallet;
  assertCurrent(): void;
  authorizationExpiresAt: number;
  background(): void;
  signingOwners: readonly NativeSmartAccountSigningOwner[];
  slhDsaKeyIds?: readonly string[];
  assertOwnerCurrent(owner: NativeSmartAccountSigningOwner): void;
  p256WebAuthn: ((metadata: ISmartAccountMetadata, intent: SmartAccountOwnerSigningIntent, assertCurrent: () => void, signal: AbortSignal) => NonNullable<SmartAccountAuthenticatorPorts['p256WebAuthn']>) | null;
  slhDsa: ((metadata: ISmartAccountMetadata, intent: SmartAccountOwnerSigningIntent, assertCurrent: () => void, signal: AbortSignal) => NonNullable<SmartAccountAuthenticatorPorts['slhDsa']>) | null;
  checkAddress(address: string): Promise<IBlacklistCheckResult>;
  /** One reviewed aggregate owner proof. Payer signing remains separately owned. */
  withOwnerProof<T>(signal: AbortSignal, guard: () => void, work: () => Promise<T>, options?: Readonly<{compositePossession:true}>): Promise<T>;
  retainAuthorization(operation: SmartAccountPackedUserOperation, payer: SmartAccountGasPayer,
    observedAt: SmartAccountAuthorizationBlock, guard: () => void): Promise<SmartAccountAuthorizationReceipt>;
  captureCompositePossession?(proposal: CompositePolicyChange, preparedActionHash: string): ReturnType<typeof createCompositePolicyPossession>;
  signOwner(
    address: string,
    digest: string,
    owner: { id: number; type: SmartAccountGasPayer['type'] },
    guard: () => void,
    intent: SmartAccountOwnerSigningIntent,
    signal: AbortSignal,
    metadata: ISmartAccountMetadata
  ): Promise<string>;
  preparePayer(
    request: unknown,
    payer: SmartAccountGasPayer,
    signal: AbortSignal,
    guard: () => void,
    metadata: Readonly<Record<string, unknown>>,
    funding: EvmFeeFunding,
    assertAssetState: (() => Promise<void>) | null,
    assertFinalAdmission?: NativeSmartPayerAdmission,
    finalAdmissionIncludesAssets?: true,
    cancellation?: SmartAccountCancellationDispatch
  ): Promise<NativePreparedConnectionTransaction>;
  waitForReceipt(
    hash: string,
    transaction: NativePreparedConnectionTransaction['transaction'],
    signal: AbortSignal,
    guard: () => void,
    operation: SmartAccountActivityIdentity | undefined
  ): Promise<unknown>;
  markDeployed(guard: () => void): Promise<void>;
  rememberCustomModule?(signal: AbortSignal, guard: () => void): Promise<SmartAccountCustomModuleRecord>;
  refreshMetadata(signal: AbortSignal, guard: () => void): Promise<void>;
  assertGuardianPolicy?(signal: AbortSignal, guard: () => void): Promise<void>;
  submitBatch?(
    prepared: PreparedSmartAccountOperation,
    submit: () => Promise<string>
  ): Promise<string>;
}>;

/** Native presentation and transport around the extension's shared operation engine. */
export function createNativeSmartOperation(
  ports: NativeSmartOperationPorts
): NativeSmartAccountOperation {
  if (!Object.hasOwn(ports, 'p256WebAuthn') || (ports.p256WebAuthn !== null && typeof ports.p256WebAuthn !== 'function'))
    throw new TypeError('Explicit native passkey signing capability is required');
  if (!Object.hasOwn(ports, 'slhDsa') || (ports.slhDsa !== null && typeof ports.slhDsa !== 'function'))
    throw new TypeError('Explicit native SLH signing capability is required');
  if (typeof ports.retainAuthorization !== 'function')
    throw new TypeError('Native Smart authorization retention is required');
  const account = ports.account;
  const cancellation = ports.cancellation;
  if (cancellation) assertSmartAccountCancellation(cancellation);
  if ((ports.intent.kind === 'cancel-operation') !== Boolean(cancellation) || cancellation &&
      (ports.intent.kind !== 'cancel-operation' || ports.intent.reference.originalHash !== cancellation.referenceHash ||
        ports.intent.reference.operationHash !== undefined && ports.intent.reference.operationHash !== cancellation.authorization.operationHash))
    throw new Error('SMART_OPERATION_EXPIRED');
  const readInfrastructureCodes = infrastructureReaders.get(ports.wallet) ?? createSmartAccountInfrastructureReader();
  infrastructureReaders.set(ports.wallet, readInfrastructureCodes);
  let metadata = account.smartAccount;
  const originalSourceConfiguration = compositeSourceConfiguration(account.smartAccount);
  const selectedFees = ports.intent.feeChoice === undefined ? undefined : snapshotEvmFeeChoice(ports.intent.feeChoice);
  if (selectedFees && (selectedFees.kind !== 'custom' || selectedFees.gasLimit !== undefined))
    throw new Error('Invalid Smart account fee choice');
  const intent =
    ports.intent.kind === 'dapp-batch'
      ? Object.freeze({
          kind: 'dapp-batch' as const,
          calls: normalizeDappCallsRequest({
            version: '2.0.0',
            calls: ports.intent.calls,
          }).calls,
        })
      : Object.freeze({ ...ports.intent, ...(selectedFees ? { feeChoice: selectedFees } : {}) });
  if (intent.kind === 'dapp-batch' && typeof ports.submitBatch !== 'function')
    throw new Error('Smart batch submission boundary is required');
  if (
    intent.kind === 'guardian-policy' &&
    typeof ports.assertGuardianPolicy !== 'function'
  )
    throw new Error('Guardian policy ownership is required');
  if (intent.kind === 'modules' && intent.command.draft.kind === 'install-custom') {
    if (typeof ports.rememberCustomModule !== 'function') throw new Error('Durable custom module discovery is required');
    const draft = intent.command.draft;
    // Probe the requested address during review, without persisting an abandoned draft.
    metadata = { ...metadata, customModules: [...(metadata.customModules ?? []).filter(record => record.address.toLowerCase() !== draft.address.toLowerCase()),
      { address: draft.address, name: draft.name, initData: draft.initData, moduleType: 1, compositeCompatible: false }] };
  }
  const expectedErc20Transfers = intent.kind === 'erc20-transfer'
    ? snapshotSmartAccountExpectedErc20Transfers([{ contractAddress: intent.token.contractAddress, recipient: intent.recipient, amountUnits: intent.amountUnits, decimals: intent.token.decimals }])
    : undefined;
  const chainId = Number(ports.network.chainId);
  const nftIntent = intent.kind === 'nft-transfer' ? (() => {
    const { feeChoice: _choice, ...transfer } = intent;
    return transfer;
  })() : undefined;
  const feeOverrides = selectedFees?.kind === 'custom'
    ? selectedFees.type === 0 ? Object.freeze({ gasPrice: selectedFees.gasPrice })
      : Object.freeze({ maxFeePerGas: selectedFees.maxFeePerGas, maxPriorityFeePerGas: selectedFees.maxPriorityFeePerGas })
    : undefined;
  const combinedFeeReview = ['native-transfer', 'native-max', 'erc20-transfer', 'nft-transfer', 'dapp-call', 'dapp-batch'].includes(intent.kind);
  let issued: PreparedSmartAccountOperation | undefined;
  let payerBudget: SmartAccountPayerBudget & Readonly<{ address: string }> | undefined;
  let observedAt: SmartAccountAuthorizationBlock | undefined;
  let authorization: SmartAccountAuthorizationReceipt | undefined;
  let pending: SmartAccountPendingState;
  const contextId = 'native-smart-account-operation';
  let policySignal: AbortSignal;
  const check = () => assertSynchronousEvmFeeGuard(ports.assertCurrent);
  const pendingRecords = cancellation ? smartAccountCancellationPendingRecords(ports.pendingRecords,cancellation,check) : ports.pendingRecords;
  let cancellationPayer: Awaited<ReturnType<typeof inspectSmartAccountCancellationPayer>> | undefined;
  const assertValidatorSwitch = async (assertCurrent: () => void, preparedMetadata?: ISmartAccountMetadata) => {
    if (intent.kind !== 'authenticator' && intent.kind !== 'modules') return;
    const observed = preparedMetadata ?? await readSmartAccountValidatorMetadata({
      account: intent.kind === 'modules' ? { ...account, smartAccount: metadata } : account,
      chainId,
      provider: pending.provider,
      assertCurrent,
    });
    assertCurrent();
    if (intent.kind === 'modules') {
      assertNativeSmartModuleCommandCurrent(intent.command, observed);
      if (intent.command.draft.kind === 'install-custom') {
        const preflight = await preflightCustomValidatorInstall(pending.provider, { address: intent.command.targetAddress, chainId, metadata: observed });
        assertCurrent();
        if (!preflight.ok) throw new Error('Custom validator preflight changed');
      }
    } else if (intent.command.purpose === 'add-to-combined') assertSmartAccountBuiltinInstallCurrent(intent.command, observed);
    else assertSmartAccountValidatorSwitchCurrent(intent.command, observed);
  };
  return new NativeSmartAccountOperation({ authorizationExpiresAt: ports.authorizationExpiresAt, background:ports.background,
    account: account.address,
    intent,
    network: ports.network,
    assertCurrent: check,
    refreshMetadata: ports.refreshMetadata,
    async prepare(signal, assertCurrent) {
      policySignal = signal;
      const rawProvider = createNativeSmartAccountProvider(
        ports.network,
        ports.rpc,
        signal,
        assertCurrent
      );
      pending = createSmartAccountPendingState(
        rawProvider,
        pendingRecords,
        chainId,
        account.address,
        assertCurrent, undefined, false, cancellation ? 'latest' : 'pending'
      );
      // Deployment can land while preparation runs. Keep its first observation
      // separate so the operation's later admission reads the chain again.
      const deploymentState = intent.kind === 'deploy'
        ? await withEvmReadPhase(rawProvider, assertCurrent, provider =>
            readSmartAccountDeploymentState({ account, chainId, provider, assertCurrent }))
        : undefined;
      return withEvmReadPhase(rawProvider, assertCurrent, async (scopedProvider) => {
        const pending = createSmartAccountPendingState(scopedProvider, pendingRecords, chainId, account.address, assertCurrent, undefined, false, cancellation ? 'latest' : 'pending');
        const provider = pending.provider;
        const captureObservation = async (prepared: PreparedSmartAccountOperation) => {
          let prefund = BigInt(0);
          const operation = prepared.userOperation;
          if (combinedFeeReview && operation.initCode !== '0x' && !getSmartAccountUserOpRequiredPrefund(operation).isZero()) {
            const shortfall = await readSmartAccountDeploymentShortfall(provider, account.address,
              getPaliEntryPointAddress(chainId), operation, assertCurrent);
            if (shortfall.gt(0)) prefund = BigInt(shortfall.toString());
          }
          // Share any earlier header read inside this preparation phase.
          const sampled = await provider.send('eth_getBlockByNumber', ['latest', false]);
          assertCurrent();
          if (!sampled || typeof sampled.number !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(sampled.number) ||
              typeof sampled.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(sampled.hash)) throw new Error('SMART_ACCOUNT_AUTHORIZATION_REQUIRED');
          observedAt = Object.freeze({number: BigInt(sampled.number).toString(), hash: sampled.hash.toLowerCase()});
          if (combinedFeeReview) {
            if (typeof sampled.gasLimit !== 'string' || !/^0x[1-9a-f][0-9a-f]{0,63}$/i.test(sampled.gasLimit))
              throw new Error('SMART_OPERATION_EXPIRED');
            const limits = BigInt(operation.accountGasLimits);
            const operationGas = (limits >> 128n) + (limits & ((1n << 128n) - 1n)) + BigInt(operation.preVerificationGas);
            payerBudget = Object.freeze({
              address: prepared.gasPayer.address,
              ...getSmartAccountPayerBudget({
                chainId, blockGasLimit: BigInt(sampled.gasLimit), operationGas, prefund,
                feeRate: BigInt(prepared.gasPrice ?? prepared.maxFeePerGas!),
                gasTank: Boolean(getZkSysGasTankAddress(chainId)) && operation.gasFees === SMART_ACCOUNT_ZERO_GAS_FEES,
              }),
            });
          }
        };
        await pending.verify();
        if (intent.kind === 'modules') {
          await assertSmartAccountTargetsAllowed(getBlacklistTargetsForEvmCall({ to: account.address, data: '0x' }), ports.checkAddress, assertCurrent);
        } else if (intent.kind === 'dapp-batch') {
          for (const call of createSmartAccountCallsExecutions(intent.calls))
            await assertSmartAccountTargetsAllowed(
              getBlacklistTargetsForEvmCall({ to: call.target, data: call.data }),
              ports.checkAddress,
              assertCurrent
            );
        } else if (
          intent.kind !== 'deploy' &&
          intent.kind !== 'guardian-policy' &&
          intent.kind !== 'cancel-operation' &&
          intent.kind !== 'authenticator'
        ) {
          await assertSmartAccountTargetsAllowed(
            getBlacklistTargetsForEvmCall(
              intent.kind === 'nft-transfer'
                ? {
                    to: intent.contractAddress,
                    data: buildSmartAccountNftTransfer(nftIntent!).data,
                  }
                : intent.kind === 'erc20-transfer'
                ? {
                    to: intent.token.contractAddress,
                    data: buildSmartAccountErc20Transfer(
                      intent.token.contractAddress,
                      intent.recipient,
                      intent.amountUnits
                    ).data,
                  }
                : {
                    to: intent.recipient,
                    data: intent.kind === 'dapp-call' ? intent.data : '0x',
                  }
            ),
            ports.checkAddress,
            assertCurrent
          );
        }
        const state = deploymentState ?? await readSmartAccountDeploymentState({
          account,
          chainId,
          provider,
          assertCurrent,
        });
        const ordinaryTransfer = ['native-transfer', 'native-max', 'erc20-transfer', 'nft-transfer', 'dapp-call', 'dapp-batch', 'cancel-operation'].includes(intent.kind);
        const deployedTransfer = ordinaryTransfer && state === 'deployed' && metadata.isDeployed && hasUsableSmartAccountAuthMetadata(metadata);
        // A deployed transfer uses its observed account and installed validator.
        // Deployment and management retain the complete infrastructure check.
        if (!deployedTransfer) {
          const factoryAddress = metadata.descriptor?.factoryAddress;
          const infrastructure = await readInfrastructureCodes({
            factoryAddress,
            chainId, url: ports.network.rpcUrl, provider, assertCurrent,
            readCodes: async blockTag => {
              const codeResults = await provider.readMany(infrastructureCodeAddresses(factoryAddress).map(address => ({
                method: 'eth_getCode', params: [address, blockTag],
              })));
              return codeResults.map((result: PromiseSettledResult<unknown>) => {
                if (result.status === 'rejected') throw result.reason;
                return result.value;
              });
            },
          });
          assertSmartAccountInfrastructureReady(infrastructure);
        }
        if (state === 'deployed' && intent.kind === 'deploy') {
          await ports.markDeployed(assertCurrent);
          assertCurrent();
          return { kind: 'already-deployed' };
        }
        if (intent.kind === 'authenticator' || intent.kind === 'modules') {
          if (state !== 'deployed' && (intent.kind !== 'modules' || intent.command.deploymentAdmission !== 'constructor-or-deployed' || intent.command.sourceIsDeployed))
            throw new Error('Smart account must be deployed');
          metadata = await readSmartAccountValidatorMetadata({
            account: intent.kind === 'modules' ? { ...account, smartAccount: metadata } : account,
            chainId,
            provider,
            assertCurrent,
          });
          assertCurrent();
          if (intent.kind === 'modules') await assertValidatorSwitch(assertCurrent, metadata);
          else if (intent.command.purpose === 'add-to-combined') assertSmartAccountBuiltinInstallCurrent(intent.command, metadata);
          else assertSmartAccountValidatorSwitchCurrent(intent.command, metadata);
          if (intent.kind === 'authenticator' && intent.command.executions.length === 0)
            return { kind: 'already-configured' };
        } else if (
          intent.kind !== 'deploy' &&
          state === 'deployed' &&
          (!metadata.isDeployed || !hasUsableSmartAccountAuthMetadata(metadata))
        ) {
          metadata = await readSmartAccountValidatorMetadata({
            account,
            chainId,
            provider,
            assertCurrent,
          });
          assertCurrent();
        }
        if (cancellation && state === 'deployed') {
          metadata = await readSmartAccountValidatorMetadata({account,chainId,provider,assertCurrent});
          assertCurrent();
        }
        const authenticator = assertNativeSmartAccountAuthenticator(metadata);
        if (!['ecdsa', 'composite'].includes(authenticator.module) &&
            !(authenticator.module === 'slh-dsa' && ports.slhDsa !== null) &&
            !(authenticator.module === 'p256-webauthn' && ports.p256WebAuthn !== null))
          throw new Error(
            'This authenticator is not available for native transfers'
          );
        cancellationPayer = cancellation ? await inspectSmartAccountCancellationPayer(cancellation,provider,assertCurrent) : undefined;
        const prepare = (
          executions: { target: string; data: string; value: string }[],
          nativeMaximum?: true
        ) =>
          prepareSmartAccountOperation({
            account: { ...account, smartAccount: metadata },
            chainId,
            provider,
            pending,
            knownDeployed:
              intent.kind !== 'deploy' &&
              state === 'deployed' &&
              metadata.isDeployed &&
              hasUsableSmartAccountAuthMetadata(metadata),
            executions,
            expectedErc20Transfers,
            nativeMaximum,
            ...(cancellationPayer?.replaceOuter ? {feeOverrides:cancellationPayer.feeOverrides} : feeOverrides ? { feeOverrides } : intent.kind === 'dapp-call'
              ? {
                  // Match extension Smart submissions. EOA gas/gasLimit fields
                  // do not replace the shared UserOperation gas estimate.
                  feeOverrides: {
                    ...(intent.maxFeePerGas === undefined
                      ? {}
                      : { maxFeePerGas: intent.maxFeePerGas }),
                    ...(intent.maxPriorityFeePerGas === undefined
                      ? {}
                      : { maxPriorityFeePerGas: intent.maxPriorityFeePerGas }),
                  },
                }
              : {}),
            assertCurrent,
            async selectGasPayer(gasEstimate, maxFeePerGas) {
              if (cancellationPayer?.replaceOuter) {
                const gasPayer = await selectSmartAccountGasPayer(ports.wallet,provider,cancellationPayer.payer as SmartAccountGasPayer,undefined,{requirePreferred:true});
                const useGasTank = await canUseSmartAccountGasTank(provider,{chainId,gasEstimate,maxFeePerGas,gasPayerAddress:gasPayer.address});
                assertCurrent();return{gasPayer,useGasTank};
              }
              const primary = getSmartAccountGasPayerCandidates(
                ports.wallet,
                metadata.deploymentGasPayer
              )[0];
              const useGasTank = primary
                ? await canUseSmartAccountGasTank(provider, {
                    chainId,
                    gasEstimate,
                    maxFeePerGas,
                    gasPayerAddress: primary.address,
                  })
                : false;
              assertCurrent();
              const gasPayer = useGasTank
                ? {
                    address: primary!.address,
                    id: primary!.id,
                    type: primary!.type,
                  }
                : await selectSmartAccountGasPayer(
                    ports.wallet,
                    provider,
                    metadata.deploymentGasPayer
                  );
              assertCurrent();
              return { gasPayer, useGasTank };
            },
          });
        if (intent.kind === 'native-max') {
          issued = await prepare(
            [{ target: intent.recipient, data: '0x', value: '0x0' }],
            true
          );
          assertCurrent();
          const maximumAmount = issued.execution?.value;
          if (!maximumAmount)
            throw new Error('Smart account maximum amount unavailable');
          await captureObservation(issued);
          return {
            kind: 'authorization',
            operation: issued,
            payerBudget,
            intent: {
              kind: 'native-transfer',
              recipient: intent.recipient,
              amountUnits: BigInt(maximumAmount).toString(),
              ...(intent.feeChoice ? { feeChoice: intent.feeChoice } : {}),
            },
          };
        }
        issued = await prepare(
          intent.kind === 'cancel-operation' ? smartAccountCancellationExecutions(cancellation!) : intent.kind === 'authenticator' || intent.kind === 'modules'
            ? intent.command.executions.map((execution) => ({ ...execution }))
            : intent.kind === 'guardian-policy'
            ? buildGuardianPolicyExecutions(intent.command)
            : intent.kind === 'dapp-batch'
            ? [...createSmartAccountCallsExecutions(intent.calls)]
            : intent.kind === 'deploy'
            ? [{ target: account.address, data: '0x', value: '0x0' }]
            : intent.kind === 'nft-transfer'
            ? [{ ...buildSmartAccountNftTransfer(nftIntent!) }]
            : intent.kind === 'erc20-transfer'
            ? [
                {
                  ...buildSmartAccountErc20Transfer(
                    intent.token.contractAddress,
                    intent.recipient,
                    intent.amountUnits
                  ),
                },
              ]
            : [
                {
                  target: intent.recipient,
                  data: intent.kind === 'dapp-call' ? intent.data : '0x',
                  value: intent.amountUnits,
                },
              ]
        );
        assertCurrent();
        if (cancellation) assertSmartAccountCancellationOperation(cancellation,issued.userOperation,issued.validator);
        if (intent.kind === 'deploy' && issued.userOperation.initCode === '0x') {
          await ports.markDeployed(assertCurrent);
          assertCurrent();
          return { kind: 'already-deployed' };
        }
        await captureObservation(issued);
        return { kind: 'authorization', operation: issued, intent, payerBudget } as const;
      });
    },
    async sign(prepared, assertCurrent, signal) {
      if (prepared !== issued || combinedFeeReview && !payerBudget) throw new Error('SMART_OPERATION_EXPIRED');
      await assertValidatorSwitch(assertCurrent);
      if (intent.kind === 'guardian-policy')
        await ports.assertGuardianPolicy!(policySignal, assertCurrent);
      const signingIntent = buildSmartAccountUserOpSigningIntent(prepared.userOperation, chainId);
      const proposal = captureCompositePolicyChange({accountAddress:account.address,metadata,executions:prepared.executions});
      const proofCurrent = () => {
        assertCurrent();
        if (proposal && compositeSourceConfiguration(account.smartAccount) !== originalSourceConfiguration)
          throw new Error('SMART_OPERATION_EXPIRED');
      };
      const signature = await ports.withOwnerProof(signal, proofCurrent, async () => {
        if (proposal) {
          if (!ports.captureCompositePossession) throw new Error('Combined approval possession is required');
          const challenge = ports.captureCompositePossession(proposal,prepared.actionHash);
          proofCurrent();
          const proofs = new Map<string,{signature:string;valid:boolean}>();
          await collectCompositePolicyPossession({proposal,assertCurrent:proofCurrent,
            async sign(child) {
              if (!child.data || !['ecdsa','p256-webauthn','slh-dsa'].includes(child.id)) return null;
              const childMetadata: ISmartAccountMetadata = {...proposal.smartAccount,
                auth:{module:child.id,validator:child.address,data:child.data}};
              if(!getSmartAccountSigningPlan(childMetadata,{ecdsa:ports.signingOwners,p256WebAuthn:ports.p256WebAuthn!==null,slhDsa:ports.slhDsa!==null, ...(ports.slhDsaKeyIds === undefined ? {} : {slhDsaKeyIds:ports.slhDsaKeyIds})}))return null;
              const result = await signNativeSmartAccountActionHash({metadata:childMetadata, actionHash:challenge.intent.actionHash,
                accountId:account.id,allowReservedSLHDSASignature:false,
                p256WebAuthn:ports.p256WebAuthn===null?null:ports.p256WebAuthn(childMetadata,challenge.intent,proofCurrent,signal),
                slhDsa:ports.slhDsa===null?null:ports.slhDsa(childMetadata,challenge.intent,proofCurrent,signal),
                localOwners:ports.signingOwners,assertCurrent:proofCurrent,assertOwnerCurrent:ports.assertOwnerCurrent,
                signOwner:(address,digest,owner,guard)=>ports.signOwner(address,digest,{id:owner.id,type:owner.type as SmartAccountGasPayer['type']},guard,challenge.intent,signal,childMetadata)});
              proofCurrent(); return result.signature;
            },
            async verify(signatures) {
              const verifiedChildren = await withEvmReadPhase(pending.provider,proofCurrent,provider=>
                verifyCompositePolicyPossession({proposal,actionHash:challenge.intent.actionHash,signatures,assertCurrent:proofCurrent,
                  async verifyChild(child,proof) {
                    const key=child.address.toLowerCase(),previous=proofs.get(key);
                    if(previous) {if(previous.signature!==proof)throw new Error('Combined approval proof changed');return previous.valid;}
                    const raw = await provider.call({from:account.address,to:child.address,
                      data:paliEcdsaValidatorInterface.encodeFunctionData('isValidSignatureWithSender',[account.address,challenge.intent.actionHash,proof])});
                    proofCurrent();
                    const valid=paliEcdsaValidatorInterface.decodeFunctionResult('isValidSignatureWithSender',raw)[0]==='0x1626ba7e';
                    proofs.set(key,{signature:proof,valid}); return valid;
                  }}));
              return {verifiedChildren,threshold:proposal.threshold,satisfied:verifiedChildren.length>=proposal.threshold};
            }});
          proofCurrent();
        }
        await withEvmReadPhase(pending.provider, proofCurrent, async provider => {
        const current = createSmartAccountPendingState(provider, pendingRecords, chainId, account.address, proofCurrent, undefined, false, cancellation ? 'latest' : 'pending');
        await current.assertNonce(prepared.userOperation);
        await assertSmartAccountSpendability({
          provider: current.provider,
          chainId,
          userOperation: prepared.userOperation,
          expectedErc20Transfers,
          assertCurrent:proofCurrent,
        });
      });
        proofCurrent();
        const signed = await signNativeSmartAccountActionHash({
        metadata,
        actionHash: prepared.actionHash,
        accountId: account.id,
        allowReservedSLHDSASignature: canUseReservedSLHDSASignature({ accountAddress: account.address, executions: prepared.executions, smartAccount: metadata }),
        p256WebAuthn: ports.p256WebAuthn === null ? null : ports.p256WebAuthn(metadata, signingIntent, assertCurrent, signal),
        slhDsa: ports.slhDsa === null ? null : ports.slhDsa(metadata, signingIntent, assertCurrent, signal),
        localOwners: ports.signingOwners,
        assertCurrent:proofCurrent,
        assertOwnerCurrent: ports.assertOwnerCurrent,
        signOwner: (address, digest, owner, guard) =>
          ports.signOwner(
            address,
            digest,
            { id: owner.id, type: owner.type as SmartAccountGasPayer['type'] },
            guard,
            signingIntent,
            signal, metadata
          ),
      });
        proofCurrent();
        if (!observedAt) throw new Error('SMART_ACCOUNT_AUTHORIZATION_REQUIRED');
        const userOperation = {...prepared.userOperation, signature:signed.signature};
        const receipt = await ports.retainAuthorization(userOperation, prepared.gasPayer, observedAt, proofCurrent);
        proofCurrent();
        const retained = resolveSmartAccountAuthorization(receipt,{chainId,payer:prepared.gasPayer.address,userOperation},proofCurrent);
        assertSmartAccountAuthorizationReceipt(receipt,{chainId,payer:prepared.gasPayer.address,userOperation:retained},proofCurrent);
        authorization=receipt;
        pending=pending.withAuthorization(receipt);
        return {...signed,signature:retained.signature};
      },proposal?{compositePossession:true}:undefined);
      if (intent.kind === 'modules' && intent.command.draft.kind === 'install-custom') {
        const record = await ports.rememberCustomModule!(signal, assertCurrent);
        assertCurrent();
        metadata = { ...metadata, customModules: [...(metadata.customModules ?? []).filter(entry => entry.address.toLowerCase() !== record.address.toLowerCase()), record] };
      }
      return signature.signature;
    },
    async submit(
      prepared,
      signature,
      signal,
      assertCurrent,
      reviewPayer,
      onBroadcast,
      onFundingConfirmed
    ) {
      if (prepared !== issued || combinedFeeReview && !payerBudget) throw new Error('SMART_OPERATION_EXPIRED');
      const provider = pending.provider;
      const assertContext = (id: string) => {
        assertCurrent();
        if (id !== contextId || prepared !== issued)
          throw new Error('SMART_OPERATION_EXPIRED');
      };
      const send: SmartAccountSubmitHost<Response>['sendTransaction'] = async (
        request,
        _legacy,
        target,
        transactionMetadata,
        options
      ) => {
        assertCurrent();
        if (
          !target ||
          !options ||
          typeof options.assertBeforeSign !== 'function' ||
          typeof options.assertCurrentContext !== 'function' ||
          ((transactionMetadata?.smartAccountExecution === true || transactionMetadata?.smartAccountDeploymentPrefund === true) &&
            (typeof options.assertPendingState !== 'function' || typeof options.assertAssetState !== 'function')) ||
          !options.feeFunding
        )
          throw new Error('SMART_OPERATION_EXPIRED');
        const payer = getSmartAccountGasPayerCandidates(
          ports.wallet,
          prepared.gasPayer
        ).find(
          (candidate) =>
            candidate.id === target.id && candidate.type === target.type
        );
        if (
          !payer ||
          payer.address.toLowerCase() !==
            prepared.gasPayer.address.toLowerCase()
        )
          throw new Error('SMART_OPERATION_EXPIRED');
        const guard = () => {
          assertCurrent();
          assertSynchronousEvmFeeGuard(options.assertBeforeSign);
          assertSynchronousEvmFeeGuard(options.assertCurrentContext);
        };
        const quote = await ports.preparePayer(
          request,
          payer,
          signal,
          guard,
          {
            ...transactionMetadata,
            ...(intent.kind === 'erc20-transfer'
              ? { smartAccountToken: intent.token }
              : intent.kind === 'nft-transfer'
              ? { smartAccountNftStandard: intent.tokenStandard }
              : {}),
            smartAccountOperationHash: prepared.actionHash,
          },
          options.feeFunding,
          transactionMetadata?.smartAccountExecution === true && options.assertPendingStateIncludesAssets !== true
            ? options.assertAssetState : null,
          (transactionMetadata?.smartAccountDeploymentPrefund === true || transactionMetadata?.smartAccountExecution === true)
            ? (provider, hash, admission, signedRaw) => options.assertPendingState(provider, hash, admission, signedRaw)
            : undefined,
          options.assertPendingStateIncludesAssets,
          options.smartAccountCancellation
        ).catch((error: unknown) => {
          if (!(error instanceof EvmTransferReadError) || error.code !== 'UNAVAILABLE')
            throw error;
          guard();
          // Any preceding funding receipt has settled before the execution
          // quote. This payer transaction has not reached signing or dispatch.
          throw new SmartAccountPayerQuoteUnavailable();
        });
        guard();
        const funding = transactionMetadata?.smartAccountDeploymentPrefund === true;
        if (payerBudget) {
          assertSmartAccountPayerFee(quote, payerBudget, {
            account: account.address, chainId, payer: payerBudget.address, purpose: funding ? 'fund' : 'submit',
          }, SMART_ACCOUNT_PAYER_BUDGET_EXCEEDED);
        } else await reviewPayer(
          {
            transaction: quote.transaction,
            maximumFeeUnits: quote.maximumFeeUnits,
            coveredFeeUnits: quote.coveredFeeUnits,
            maximumTotalUnits: quote.maximumTotalUnits,
            purpose: funding
              ? 'fund-account'
              : 'submit-operation',
          },
          guard
        );
        if (transactionMetadata?.smartAccountExecution === true || transactionMetadata?.smartAccountDeploymentPrefund === true) {
          if (options.assertPendingStateIncludesAssets !== true)
            await pending.withReadPhase(phase => options.assertPendingState(phase.provider));
        } else await pending.assertNonce(prepared.userOperation);
        if (intent.kind === 'guardian-policy')
          await ports.assertGuardianPolicy!(signal, guard);
        await assertValidatorSwitch(guard);
        guard();
        let acknowledged: Promise<void> = Promise.resolve();
        const hash = await quote.submit(guard, (hash) => {
          onBroadcast(
            hash,
            transactionMetadata?.smartAccountExecution === true
              ? 'submit-operation'
              : 'fund-account'
          );
          acknowledged = Promise.resolve(options.onBroadcast?.({ hash }));
          void acknowledged.catch(() => undefined);
        }, { kind: 'transaction' });
        await acknowledged;
        guard();
        return {
          hash,
          wait: async () => {
            const receipt = await ports.waitForReceipt(
              hash,
              quote.transaction,
              signal,
              guard,
              transactionMetadata?.smartAccountExecution === true
                ? {
                    operationHash: prepared.actionHash,
                    operationNonce: prepared.userOperation.nonce,
                    payer: quote.transaction.from,
                  }
                : undefined
            );
            if (funding) {
              guard();
              onFundingConfirmed(hash);
            }
            return receipt;
          },
        };
      };
      const submit = async () => {
        const response = await submitSmartAccountOperation(
          {
            ...prepared,
            accountId: account.id,
            executionContextId: contextId,
            signature,
            waitForConfirmation:
              intent.kind === 'deploy' ||
              intent.kind === 'guardian-policy' ||
              intent.kind === 'authenticator' || intent.kind === 'modules',
          },
          {
            chainId,
            provider,
            pending,
            async retainAuthorization(userOperation, payer, guard) {
              guard();
              if (!authorization || prepared !== issued) throw new Error('SMART_ACCOUNT_AUTHORIZATION_REQUIRED');
              assertSmartAccountAuthorizationReceipt(authorization,{chainId,payer:payer.address,userOperation},guard);
              return authorization;
            },
            assertExpectedExecutionContext: () => {
              throw new Error('Unexpected dapp provenance');
            },
            assertSmartAccountExecutionContext: assertContext,
            getExecutionContext: (id) => {
              assertContext(id);
              return {
                accountId: account.id,
                gasPrice: prepared.gasPrice,
                expectedErc20Transfers: prepared.expectedErc20Transfers,
                userOperation: prepared.userOperation,
                ...(cancellation ? {cancellation,replaceOuter:Boolean(cancellationPayer?.replaceOuter)} : {}),
              };
            },
            getSmartAccountById: (id) => {
              assertCurrent();
              if (id !== account.id) throw new Error('SMART_OPERATION_EXPIRED');
              return { account, metadata };
            },
            getWalletGasPayerAccount: (preferred, request, options) =>
              selectSmartAccountGasPayer(
                ports.wallet,
                provider,
                preferred,
                request,
                options
              ),
            getLocalNativeExecutionRecipients: () => [],
            ensureDeploymentPrefund: (...args) =>
              ensureSmartAccountDeploymentPrefund(provider, send, ...args),
            sendTransaction: send,
            invalidateMetadata: () => undefined,
          },
          assertCurrent
        );
        assertCurrent();
        if (intent.kind === 'deploy') {
          if ((await provider.getCode(account.address)) === '0x')
            throw new Error('Smart account deployment not observed');
          assertCurrent();
          await ports.markDeployed(assertCurrent);
        }
        return response.hash;
      };
      return intent.kind === 'dapp-batch'
        ? ports.submitBatch!(prepared, submit)
        : submit();
    },
  });
}
