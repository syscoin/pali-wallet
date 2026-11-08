import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeApproval.ts';
import {
  prepareSmartAccountOperation,
  type SmartAccountGasPayer,
} from '../../../../source/utils/smartAccount/prepareOperation.ts';
import { signSmartAccountEcdsaOperation } from '../../../../source/utils/smartAccount/signOperation.ts';
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
  NativeSmartAccountDeployment,
  type PreparedSmartAccountDeployment,
} from './deployment.ts';
import { createNativeSmartAccountProvider } from './provider.ts';

type Response = { hash: string; wait(): Promise<unknown> };
export type NativeSmartDeploymentPorts = Readonly<{
  account: IKeyringAccountState & { smartAccount: ISmartAccountMetadata };
  network: NativeNetworkRegistration;
  rpc: EvmTransferReadRpc;
  wallet: SmartAccountPayerWallet;
  assertCurrent(): void;
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
    metadata: Readonly<Record<string, unknown>>
  ): Promise<NativePreparedConnectionTransaction>;
  waitForReceipt(
    hash: string,
    transaction: NativePreparedConnectionTransaction['transaction'],
    signal: AbortSignal,
    guard: () => void
  ): Promise<unknown>;
  markDeployed(guard: () => void): Promise<void>;
}>;

/** Native presentation and transport around the extension's shared operation engine. */
export function createNativeSmartDeployment(
  ports: NativeSmartDeploymentPorts
): NativeSmartAccountDeployment {
  const account = ports.account;
  const metadata = account.smartAccount;
  const chainId = Number(ports.network.chainId);
  let issued: PreparedSmartAccountDeployment | undefined;
  const contextId = 'native-smart-account-deployment';
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
        return { id: owner.id, type: type as SmartAccountGasPayer['type'] };
    }
    return null;
  };
  return new NativeSmartAccountDeployment({
    account: account.address,
    network: ports.network,
    assertCurrent: check,
    async prepare(signal, assertCurrent) {
      const provider = createNativeSmartAccountProvider(
        ports.network,
        ports.rpc,
        signal,
        assertCurrent
      );
      await ports.rpc.assertSmartAccountSupported(signal, assertCurrent);
      issued = await prepareSmartAccountOperation({
        account,
        chainId,
        provider,
        knownDeployed: false,
        executions: [{ target: account.address, data: '0x', value: '0x0' }],
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
      assertCurrent();
      return issued;
    },
    async sign(prepared, assertCurrent) {
      if (prepared !== issued) throw new Error('DEPLOYMENT_EXPIRED');
      return signSmartAccountEcdsaOperation({
        metadata,
        actionHash: prepared.actionHash,
        assertCurrent,
        findOwner: ownerFor,
        signOwner: (address, digest, owner) =>
          ports.signOwner(address, digest, owner, assertCurrent),
      });
    },
    async submit(
      prepared,
      signature,
      signal,
      assertCurrent,
      reviewPayer,
      onBroadcast
    ) {
      if (prepared !== issued) throw new Error('DEPLOYMENT_EXPIRED');
      const provider = createNativeSmartAccountProvider(
        ports.network,
        ports.rpc,
        signal,
        assertCurrent
      );
      const assertContext = (id: string) => {
        assertCurrent();
        if (id !== contextId || prepared !== issued)
          throw new Error('DEPLOYMENT_EXPIRED');
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
          typeof options.assertCurrentContext !== 'function'
        )
          throw new Error('DEPLOYMENT_EXPIRED');
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
          throw new Error('DEPLOYMENT_EXPIRED');
        const guard = () => {
          assertCurrent();
          assertSynchronousEvmFeeGuard(options.assertBeforeSign);
          assertSynchronousEvmFeeGuard(options.assertCurrentContext);
        };
        const quote = await ports.preparePayer(request, payer, signal, guard, {
          ...transactionMetadata,
          smartAccountOperationHash: prepared.actionHash,
        });
        guard();
        await reviewPayer(
          {
            transaction: quote.transaction,
            maximumFeeUnits: quote.maximumFeeUnits,
            maximumTotalUnits: quote.maximumTotalUnits,
            purpose: transactionMetadata?.smartAccountDeploymentPrefund
              ? 'fund-account'
              : 'submit-deployment',
          },
          guard
        );
        guard();
        let acknowledged: Promise<void> = Promise.resolve();
        const hash = await quote.submit(guard, (hash) => {
          onBroadcast(hash);
          acknowledged = Promise.resolve(options.onBroadcast?.({ hash }));
          void acknowledged.catch(() => undefined);
        });
        await acknowledged;
        guard();
        return {
          hash,
          wait: () =>
            ports.waitForReceipt(hash, quote.transaction, signal, guard),
        };
      };
      const response = await submitSmartAccountOperation(
        {
          ...prepared,
          accountId: account.id,
          executionContextId: contextId,
          signature,
          waitForConfirmation: true,
        },
        {
          chainId,
          provider,
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
            if (id !== account.id) throw new Error('DEPLOYMENT_EXPIRED');
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
      if ((await provider.getCode(account.address)) === '0x')
        throw new Error('Smart account deployment not observed');
      assertCurrent();
      await ports.markDeployed(assertCurrent);
      return response.hash;
    },
  });
}
