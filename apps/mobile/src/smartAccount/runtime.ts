import {
  createSmartAccountPendingState,
  type SmartAccountPendingState,
} from '../../../../source/utils/smartAccount/pendingState.ts';
import { assertPaliWalletValidatorSwitchCurrent } from '../../../../source/utils/smartAccount/validatorSwitch.ts';
import {
  createSmartAccountCallsExecutions,
  normalizeDappCallsRequest,
} from '../../../../source/shared/dappCalls.ts';
import type { SmartAccountPendingRecords } from '../../../../source/wallet/evmSignedRecords.ts';
import type { SmartAccountActivityIdentity } from '../../../../source/wallet/smartAccountActivity.ts';
import { buildSmartAccountNftTransfer } from '../../../../source/utils/smartAccount/nftTransfer.ts';
import { buildSmartAccountErc20Transfer } from '../../../../source/utils/smartAccount/erc20Transfer.ts';
import { prepareSmartAccountNativeMaximum } from '../../../../source/utils/smartAccount/nativeMaximum.ts';
import { assertSmartAccountNativeSpendability } from '../../../../source/utils/smartAccount/nativeSpendability.ts';
import { getSmartAccountUserOpRequiredPrefund } from '../../../../source/utils/smartAccount/account.ts';
import { buildGuardianPolicyExecutions } from '../../../../source/utils/smartAccount/guardianPolicy.ts';
import type { EvmFeeFunding } from '../../../../source/shared/evmFeeApproval.ts';
import { assertSmartAccountTargetsAllowed } from '../../../../source/utils/smartAccount/targetPolicy.ts';
import { getBlacklistTargetsForEvmCall } from '../../../../source/shared/evmCallBlacklist.ts';
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
  assertSmartAccountGasTankCredit,
  canUseSmartAccountGasTank,
  ensureSmartAccountDeploymentPrefund,
  getSmartAccountGasPayerCandidates,
  selectSmartAccountGasPayer,
  type SmartAccountPayerWallet,
} from '../../../../source/utils/smartAccount/payerPolicy.ts';
import type {
  IKeyringAccountState,
  ISmartAccountMetadata,
} from '../../../../source/types/network.ts';
import type { NativePreparedConnectionTransaction } from '../connections/transactionRuntime.ts';
import type { NativeNetworkRegistration } from '../custody/networkContext.ts';
import { EvmTransferReadRpc } from '../custody/evmTransferReadRpc.ts';
import {
  NativeSmartAccountOperation,
  type NativeSmartAccountIntent,
  type PreparedSmartAccountOperation,
} from './operation.ts';
import { createNativeSmartAccountProvider } from './provider.ts';

type Response = { hash: string; wait(): Promise<unknown> };
export type NativeSmartOperationPorts = Readonly<{
  intent: NativeSmartAccountIntent;
  pendingRecords: SmartAccountPendingRecords;
  account: IKeyringAccountState & { smartAccount: ISmartAccountMetadata };
  network: NativeNetworkRegistration;
  rpc: EvmTransferReadRpc;
  wallet: SmartAccountPayerWallet;
  assertCurrent(): void;
  checkAddress(address: string): Promise<IBlacklistCheckResult>;
  signOwner(
    address: string,
    digest: string,
    owner: { id: number; type: SmartAccountGasPayer['type'] },
    guard: () => void
  ): Promise<string>;
  preparePayer(
    request: unknown,
    payer: SmartAccountGasPayer,
    signal: AbortSignal,
    guard: () => void,
    metadata: Readonly<Record<string, unknown>>,
    funding: EvmFeeFunding
  ): Promise<NativePreparedConnectionTransaction>;
  waitForReceipt(
    hash: string,
    transaction: NativePreparedConnectionTransaction['transaction'],
    signal: AbortSignal,
    guard: () => void,
    operation: SmartAccountActivityIdentity | undefined
  ): Promise<unknown>;
  markDeployed(guard: () => void): Promise<void>;
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
  const account = ports.account;
  let metadata = account.smartAccount;
  const intent =
    ports.intent.kind === 'dapp-batch'
      ? Object.freeze({
          kind: 'dapp-batch' as const,
          calls: normalizeDappCallsRequest({
            version: '2.0.0',
            calls: ports.intent.calls,
          }).calls,
        })
      : Object.freeze({ ...ports.intent });
  if (intent.kind === 'dapp-batch' && typeof ports.submitBatch !== 'function')
    throw new Error('Smart batch submission boundary is required');
  if (
    intent.kind === 'guardian-policy' &&
    typeof ports.assertGuardianPolicy !== 'function'
  )
    throw new Error('Guardian policy ownership is required');
  const chainId = Number(ports.network.chainId);
  let issued: PreparedSmartAccountOperation | undefined;
  let pending: SmartAccountPendingState;
  const contextId = 'native-smart-account-operation';
  let policySignal: AbortSignal;
  const check = () => assertSynchronousEvmFeeGuard(ports.assertCurrent);
  const ownerFor = (address: string) => {
    for (const type of ['HDAccount', 'Imported'] as const) {
      const owner = Object.values(ports.wallet.accounts[type]).find(
        (candidate) =>
          !candidate.isSmartAccount &&
          !candidate.isLedgerWallet &&
          !candidate.isTrezorWallet &&
          candidate.address.toLowerCase() === address.toLowerCase()
      );
      if (owner)
        return { id: owner.id, type };
    }
    return null;
  };
  const assertValidatorSwitch = async (assertCurrent: () => void) => {
    if (intent.kind !== 'wallet-authenticator') return;
    const observed = await readSmartAccountValidatorMetadata({
      account,
      chainId,
      provider: pending.provider,
      assertCurrent,
    });
    assertCurrent();
    assertPaliWalletValidatorSwitchCurrent(intent.command, observed);
  };
  return new NativeSmartAccountOperation({
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
        ports.pendingRecords,
        chainId,
        account.address,
        assertCurrent
      );
      const provider = pending.provider;
      await pending.verify();
      if (intent.kind === 'dapp-batch') {
        for (const call of createSmartAccountCallsExecutions(intent.calls))
          await assertSmartAccountTargetsAllowed(
            getBlacklistTargetsForEvmCall({ to: call.target, data: call.data }),
            ports.checkAddress,
            assertCurrent
          );
      } else if (
        intent.kind !== 'deploy' &&
        intent.kind !== 'guardian-policy' &&
        intent.kind !== 'wallet-authenticator'
      ) {
        await assertSmartAccountTargetsAllowed(
          getBlacklistTargetsForEvmCall(
            intent.kind === 'nft-transfer'
              ? {
                  to: intent.contractAddress,
                  data: buildSmartAccountNftTransfer(intent).data,
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
      await ports.rpc.assertSmartAccountSupported(signal, assertCurrent);
      const state = await readSmartAccountDeploymentState({
        account,
        chainId,
        provider,
        assertCurrent,
      });
      if (state === 'deployed' && intent.kind === 'deploy') {
        await ports.markDeployed(assertCurrent);
        assertCurrent();
        return { kind: 'already-deployed' };
      }
      if (intent.kind === 'wallet-authenticator') {
        if (state !== 'deployed')
          throw new Error('Smart account must be deployed');
        metadata = await readSmartAccountValidatorMetadata({
          account,
          chainId,
          provider,
          assertCurrent,
        });
        assertCurrent();
        assertPaliWalletValidatorSwitchCurrent(intent.command, metadata);
        if (intent.command.executions.length === 0)
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
      if (
        !['ecdsa', 'composite'].includes(
          assertNativeSmartAccountAuthenticator(metadata).module
        )
      )
        throw new Error(
          'This authenticator is not available for native transfers'
        );
      const prepare = (
        executions: { target: string; data: string; value: string }[]
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
          ...(intent.kind === 'dapp-call'
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
        const maximum = await prepareSmartAccountNativeMaximum({
          target: intent.recipient,
          assertCurrent,
          async readBalance() {
            return (await provider.getBalance(account.address)).toString();
          },
          async quote(execution) {
            const quote = await prepare([{ ...execution }]);
            return {
              quote,
              maximumFeeUnits: getSmartAccountUserOpRequiredPrefund(
                quote.userOperation
              ).toString(),
            };
          },
        });
        issued = maximum.quote;
        assertCurrent();
        return {
          kind: 'authorization',
          operation: issued,
          intent: {
            kind: 'native-transfer',
            recipient: intent.recipient,
            amountUnits: BigInt(maximum.execution.value).toString(),
          },
        };
      }
      issued = await prepare(
        intent.kind === 'wallet-authenticator'
          ? intent.command.executions.map((execution) => ({ ...execution }))
          : intent.kind === 'guardian-policy'
          ? buildGuardianPolicyExecutions(intent.command)
          : intent.kind === 'dapp-batch'
          ? [...createSmartAccountCallsExecutions(intent.calls)]
          : intent.kind === 'deploy'
          ? [{ target: account.address, data: '0x', value: '0x0' }]
          : intent.kind === 'nft-transfer'
          ? [{ ...buildSmartAccountNftTransfer(intent) }]
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
      if (intent.kind === 'deploy' && issued.userOperation.initCode === '0x') {
        await ports.markDeployed(assertCurrent);
        assertCurrent();
        return { kind: 'already-deployed' };
      }
      return { kind: 'authorization', operation: issued, intent };
    },
    async sign(prepared, assertCurrent) {
      if (prepared !== issued) throw new Error('SMART_OPERATION_EXPIRED');
      await assertValidatorSwitch(assertCurrent);
      if (intent.kind === 'guardian-policy')
        await ports.assertGuardianPolicy!(policySignal, assertCurrent);
      await pending.assertNonce(prepared.userOperation);
      await assertSmartAccountNativeSpendability({
        provider: pending.provider,
        chainId,
        userOperation: prepared.userOperation,
        assertCurrent,
      });
      const localOwners: NativeSmartAccountSigningOwner[] = [];
      const ownerRecords = new Map<string, IKeyringAccountState>();
      for (const type of ['HDAccount', 'Imported'] as const)
        for (const owner of Object.values(ports.wallet.accounts[type]))
          if (
            !owner.isSmartAccount &&
            !owner.isLedgerWallet &&
            !owner.isTrezorWallet
          ) {
            localOwners.push({ address: owner.address, id: owner.id, type });
            ownerRecords.set(`${type}:${owner.id}`, owner);
          }
      const signature = await signNativeSmartAccountActionHash({
        metadata,
        actionHash: prepared.actionHash,
        localOwners,
        assertCurrent,
        assertOwnerCurrent(owner) {
          const current = ownerFor(owner.address);
          if (
            !current || current.id !== owner.id || current.type !== owner.type ||
            ports.wallet.accounts[owner.type][owner.id] !==
              ownerRecords.get(`${owner.type}:${owner.id}`)
          )
            throw new Error('Native smart account owner identity changed');
        },
        signOwner: (address, digest, owner, guard) =>
          ports.signOwner(
            address,
            digest,
            { id: owner.id, type: owner.type as SmartAccountGasPayer['type'] },
            guard
          ),
      });
      return signature.signature;
    },
    async submit(
      prepared,
      signature,
      signal,
      assertCurrent,
      reviewPayer,
      onBroadcast
    ) {
      if (prepared !== issued) throw new Error('SMART_OPERATION_EXPIRED');
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
          (transactionMetadata?.smartAccountExecution === true &&
            typeof options.assertPendingState !== 'function') ||
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
          options.feeFunding
        );
        guard();
        await reviewPayer(
          {
            transaction: quote.transaction,
            maximumFeeUnits: quote.maximumFeeUnits,
            coveredFeeUnits: quote.coveredFeeUnits,
            maximumTotalUnits: quote.maximumTotalUnits,
            purpose: transactionMetadata?.smartAccountDeploymentPrefund
              ? 'fund-account'
              : 'submit-operation',
          },
          guard
        );
        if (transactionMetadata?.smartAccountExecution === true)
          await options.assertPendingState();
        else await pending.assertNonce(prepared.userOperation);
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
          wait: () =>
            ports.waitForReceipt(
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
            ),
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
              intent.kind === 'wallet-authenticator',
          },
          {
            chainId,
            provider,
            pending,
            assertExpectedExecutionContext: () => {
              throw new Error('Unexpected dapp provenance');
            },
            assertSmartAccountExecutionContext: assertContext,
            getExecutionContext: (id) => {
              assertContext(id);
              return {
                accountId: account.id,
                gasPrice: prepared.gasPrice,
                userOperation: prepared.userOperation,
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
            assertGasTankCoversTransaction: (request) =>
              assertSmartAccountGasTankCredit(provider, request),
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
