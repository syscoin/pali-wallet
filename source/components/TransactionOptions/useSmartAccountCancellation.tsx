import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { useSmartAccountFeeConfirmation } from '../../pages/Settings/SmartAccountFeeConfirmation';
import { ConfirmationModal } from 'components/Modal';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { RootState } from 'state/store';
import { ISmartAccountMetadata, KeyringAccountType } from 'types/network';
import { IEvmTransactionContext } from 'utils/evmTransactionContext';
import { getWalletNavigationScope } from 'utils/navigationState';
import {
  getSmartAccountLocalOwnerContexts,
  signAndSubmitSmartAccountExecutions,
  SmartAccountExecutionIntent,
  SmartAccountFeeQuote,
} from 'utils/smartAccount/execution';

type PreparedCancellation = {
  accountAddress: string;
  accountId: number;
  entryPointFeeQuote: SmartAccountFeeQuote & { executionContextId: string };
  executionContextId: string;
  executions: SmartAccountExecutionIntent[];
  operationCancellation: {
    operationHash: string;
    operationNonce: string;
    originalHash: string;
  };
  smartAccount: ISmartAccountMetadata;
};
type Review = {
  assertCurrent(): void;
  confirming?: boolean;
  expectedContext: IEvmTransactionContext;
  prepared: PreparedCancellation;
  scope: string;
};
const hashPattern = /^0x[\da-f]{64}$/i;

/** The background derives the exact nonce and empty call from authenticated bytes. */
export function useSmartAccountCancellation(
  hash: string,
  operationHash?: string
) {
  const { t } = useTranslation();
  const { activeAccount, accounts, activeNetwork, isBitcoinBased } =
    useSelector((state: RootState) => state.vault);
  const slip44 = useSelector(
    (state: RootState) => state.vaultGlobal?.activeSlip44
  );
  const account = accounts[activeAccount.type]?.[activeAccount.id];
  const available = Boolean(
    !isBitcoinBased &&
      activeAccount.type === KeyringAccountType.SmartAccount &&
      account?.isSmartAccount &&
      account.smartAccount?.chainId === Number(activeNetwork.chainId)
  );
  const navigation = getWalletNavigationScope();
  const scope = JSON.stringify([
    navigation.account,
    navigation.network,
    activeAccount,
    account?.address,
    activeNetwork.chainId,
    activeNetwork.url,
    slip44,
    hash,
    operationHash,
    window.location.href,
  ]);
  const lifetime = useRef({
    scope,
    generation: 0,
    alive: true,
    pending: false,
  });
  if (lifetime.current.scope !== scope)
    lifetime.current = {
      scope,
      generation: lifetime.current.generation + 1,
      alive: true,
      pending: false,
    };
  const [review, setReview] = useState<Review>();
  const [view, setView] = useState<{
    busy?: boolean;
    message?: string;
    scope: string;
  }>();
  const { forExecution, feeConfirmation } =
    useSmartAccountFeeConfirmation(scope);
  useEffect(() => {
    const owner = lifetime.current;
    owner.alive = true;
    return () => {
      owner.alive = false;
      owner.generation++;
    };
  }, [scope]);
  const finish = (message?: string) => {
    lifetime.current.pending = false;
    setReview(undefined);
    setView({ scope, message });
  };
  const request = async () => {
    const owner = lifetime.current;
    if (!available || owner.pending || !hashPattern.test(hash)) return;
    owner.pending = true;
    const generation = ++owner.generation;
    const location = window.location.href;
    const assertCurrent = () => {
      const current = getWalletNavigationScope();
      if (
        !owner.alive ||
        lifetime.current !== owner ||
        owner.generation !== generation ||
        current.account !== navigation.account ||
        current.network !== navigation.network ||
        window.location.href !== location
      )
        throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
    };
    setView({ scope, busy: true });
    try {
      assertCurrent();
      const sessionGeneration = await controllerEmitter(
        ['wallet', 'getWalletSessionGeneration'],
        []
      );
      assertCurrent();
      if (
        typeof sessionGeneration !== 'number' ||
        !Number.isSafeInteger(sessionGeneration) ||
        sessionGeneration < 0
      )
        throw new Error('Invalid wallet session');
      const expectedContext: IEvmTransactionContext = {
        account: {
          id: activeAccount.id,
          type: activeAccount.type,
          address: account!.address,
        },
        chainId: Number(activeNetwork.chainId),
        rpcUrl: activeNetwork.url,
        slip44,
        sessionGeneration,
      };
      const prepared = (await controllerEmitter(
        ['wallet', 'prepareSmartAccountCancellation'],
        [
          { originalHash: hash, ...(operationHash ? { operationHash } : {}) },
          activeAccount.id,
          { expectedContext },
        ],
        300000,
        false
      )) as PreparedCancellation;
      assertCurrent();
      const cancellation = prepared?.operationCancellation;
      const call = prepared?.executions?.[0];
      if (
        prepared?.accountId !== activeAccount.id ||
        prepared?.accountAddress?.toLowerCase() !==
          account!.address.toLowerCase() ||
        prepared?.smartAccount?.chainId !== Number(activeNetwork.chainId) ||
        !prepared.executionContextId ||
        prepared.entryPointFeeQuote?.executionContextId !==
          prepared.executionContextId ||
        cancellation?.originalHash?.toLowerCase() !== hash.toLowerCase() ||
        !hashPattern.test(cancellation?.operationHash ?? '') ||
        (operationHash &&
          cancellation.operationHash.toLowerCase() !==
            operationHash.toLowerCase()) ||
        !/^(?:0|[1-9]\d{0,77})$/.test(cancellation?.operationNonce ?? '') ||
        prepared.executions.length !== 1 ||
        call?.target?.toLowerCase() !== account!.address.toLowerCase() ||
        call.data !== '0x' ||
        !/^(?:0|0x0+)$/.test(call.value)
      )
        throw new Error('Invalid Smart Account cancellation');
      setReview({ scope, prepared, expectedContext, assertCurrent });
      setView({ scope });
    } catch {
      try {
        assertCurrent();
        finish(t('transactions.smartAccountCancelUnavailable'));
      } catch {
        /* retired owner */
      }
    }
  };
  const confirm = async (shown: Review) => {
    if (shown.confirming || view?.busy || review !== shown) return;
    shown.confirming = true;
    let authorized = false;
    try {
      shown.assertCurrent();
      setReview(undefined);
      setView({ scope, busy: true });
      const { prepared } = shown;
      const consent = forExecution({
        account: shown.expectedContext.account.address,
        smartAccount: prepared.accountAddress,
        chainId: shown.expectedContext.chainId,
        symbol: activeNetwork.currency,
        label: t('header.cancelTx'),
        assertCurrent: shown.assertCurrent,
      });
      if (
        (await consent.confirmEntryPoint(prepared.entryPointFeeQuote)) !==
        prepared.executionContextId
      ) {
        shown.assertCurrent();
        finish();
        return;
      }
      shown.assertCurrent();
      await signAndSubmitSmartAccountExecutions({
        accountAddress: prepared.accountAddress,
        accountId: prepared.accountId,
        authenticatorContexts: getSmartAccountLocalOwnerContexts({
          accounts,
          controllerEmitter,
        }),
        controllerEmitter,
        executions: prepared.executions,
        expectedContext: shown.expectedContext,
        approvedFeeQuote: prepared.entryPointFeeQuote,
        feeConsent: consent,
        smartAccount: prepared.smartAccount,
        onPrepared: shown.assertCurrent,
        onBeforeAuthentication: shown.assertCurrent,
        onBeforeSubmit: async () => shown.assertCurrent(),
        onAssertionResolved: () => {
          authorized = true;
        },
        skipRapidPolling: true,
        waitForConfirmation: false,
      });
      shown.assertCurrent();
      finish(t('transactions.transactionCancelSubmitted'));
    } catch (error) {
      try {
        shown.assertCurrent();
        finish(
          error?.code === 4001
            ? authorized
              ? t('transactions.smartAccountAuthorizationRetained')
              : undefined
            : t('transactions.smartAccountCancelUnavailable')
        );
      } catch {
        /* retired owner */
      }
    }
  };
  const shown = review?.scope === scope ? review : undefined;
  return {
    available,
    busy: Boolean((view?.scope === scope && view.busy) || shown),
    request,
    content: (
      <>
        {view?.scope === scope && view.message && (
          <p role="status" className="mt-2 text-sm text-brand-gray200">
            {view.message}
          </p>
        )}
        {shown && (
          <ConfirmationModal
            show
            title={t('header.cancelTx')}
            description={t('transactions.smartAccountCancelDescription')}
            buttonText={t('buttons.confirm')}
            onClose={() => {
              try {
                shown.assertCurrent();
              } catch {
                return;
              }
              lifetime.current.generation++;
              finish();
            }}
            onClick={() => void confirm(shown)}
          >
            <dl className="mt-4 space-y-3 text-sm">
              {[
                [
                  t('smartAccountHub.accountAddress'),
                  shown.prepared.accountAddress,
                ],
                [
                  t('transactions.smartAuthorizations.reference'),
                  shown.prepared.operationCancellation.originalHash,
                ],
                [
                  t('transactions.smartAuthorizations.operationHash'),
                  shown.prepared.operationCancellation.operationHash,
                ],
                [
                  t('transactions.replay.nonce'),
                  shown.prepared.operationCancellation.operationNonce,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-brand-gray200">{label}</dt>
                  <dd className="break-all">{value}</dd>
                </div>
              ))}
            </dl>
          </ConfirmationModal>
        )}
        {feeConfirmation}
      </>
    ),
  };
}
