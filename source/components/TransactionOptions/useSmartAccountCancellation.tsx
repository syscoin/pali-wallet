import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { SMART_ACCOUNT_AUTHORIZATION_UPDATED_EVENT } from '../../shared/smartAccountControllerAuthority';
import { ConfirmationModal } from 'components/Modal';
import { useUtils } from 'hooks/useUtils';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { RootState } from 'state/store';
import { ISmartAccountMetadata, KeyringAccountType } from 'types/network';
import { formatEther } from 'utils/ethersV6Compat';
import { IEvmTransactionContext } from 'utils/evmTransactionContext';
import { getWalletNavigationScope } from 'utils/navigationState';
import {
  getSmartAccountLocalOwnerContexts,
  signAndSubmitSmartAccountExecutions,
  SmartAccountExecutionIntent,
  SmartAccountFeeQuote,
} from 'utils/smartAccount/execution';

type CancellationFeeQuote = SmartAccountFeeQuote &
  Required<Pick<SmartAccountFeeQuote, 'cancellationPayerBudget'>> & {
    executionContextId: string;
  };
type PreparedCancellation = {
  accountAddress: string;
  accountId: number;
  entryPointFeeQuote: CancellationFeeQuote;
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
const isWeiAmount = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:0|[1-9]\d{0,77})$/.test(value);

function CancellationReviewDetails({
  prepared,
  symbol,
}: {
  prepared: PreparedCancellation;
  symbol: string;
}) {
  const { t } = useTranslation();
  const { accountAddress, entryPointFeeQuote, operationCancellation } =
    prepared;
  const { cancellationPayerBudget, feePayer, maximumFeeWei } =
    entryPointFeeQuote;
  const { originalHash, operationHash, operationNonce } = operationCancellation;
  const showFunding =
    cancellationPayerBudget.maximumPrefundWei !== '0' ||
    cancellationPayerBudget.maximumPrefundFeeWei !== '0';
  const formatFee = (amount: string) => `${formatEther(amount)} ${symbol}`;
  const row = (label: string, value: string) => (
    <div>
      <dt className="text-brand-gray200">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
  return (
    <>
      <dl className="mt-4 space-y-3 rounded-2xl bg-alpha-whiteAlpha100 p-3 text-left text-sm">
        {row(t('smartAccountHub.accountAddress'), accountAddress)}
        {row(t('send.smartAccountMaxFee'), formatFee(maximumFeeWei))}
        {row(t('transactions.feePayer'), feePayer.address)}
        {row(
          cancellationPayerBudget.gasTank
            ? t('settings.smartAccountFeeReviewGasTank')
            : t('transactions.smartAccountCancelMaximumReplacementFee'),
          formatFee(cancellationPayerBudget.maximumFeeWei)
        )}
        {showFunding && (
          <>
            {row(
              t('transactions.smartAccountCancelMaximumDeposit'),
              formatFee(cancellationPayerBudget.maximumPrefundWei)
            )}
            {row(
              t('transactions.smartAccountCancelMaximumDepositFee'),
              formatFee(cancellationPayerBudget.maximumPrefundFeeWei)
            )}
          </>
        )}
      </dl>
      <details className="mt-4 text-left text-sm">
        <summary className="cursor-pointer text-brand-gray200">
          {t('transactions.technicalDetails')}
        </summary>
        <dl className="mt-2 space-y-2">
          {originalHash.toLowerCase() !== operationHash.toLowerCase() &&
            row(t('transactions.smartAuthorizations.reference'), originalHash)}
          {row(
            t('transactions.smartAuthorizations.operationHash'),
            operationHash
          )}
          {row(t('transactions.replay.nonce'), operationNonce)}
        </dl>
      </details>
    </>
  );
}

/** The background derives the exact nonce and empty call from authenticated bytes. */
export function useSmartAccountCancellation(
  hash: string,
  operationHash?: string
) {
  const { t } = useTranslation();
  const { alert } = useUtils();
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
    scope: string;
  }>();
  useEffect(() => {
    const owner = lifetime.current;
    owner.alive = true;
    return () => {
      owner.alive = false;
      owner.generation++;
    };
  }, [scope]);
  const finish = () => {
    lifetime.current.pending = false;
    setReview(undefined);
    setView({ scope });
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
      const quote = prepared?.entryPointFeeQuote;
      const budget = quote?.cancellationPayerBudget;
      if (
        prepared?.accountId !== activeAccount.id ||
        prepared?.accountAddress?.toLowerCase() !==
          account!.address.toLowerCase() ||
        prepared?.smartAccount?.chainId !== Number(activeNetwork.chainId) ||
        typeof prepared.executionContextId !== 'string' ||
        !prepared.executionContextId ||
        prepared.executionContextId.length > 160 ||
        quote?.executionContextId !== prepared.executionContextId ||
        typeof quote?.feePayer?.address !== 'string' ||
        !/^0x[\da-f]{40}$/i.test(quote.feePayer.address) ||
        !isWeiAmount(quote.maximumFeeWei) ||
        !isWeiAmount(quote.gasUnits) ||
        typeof budget?.gasTank !== 'boolean' ||
        !isWeiAmount(budget?.maximumFeeWei) ||
        !isWeiAmount(budget?.maximumPrefundWei) ||
        !isWeiAmount(budget?.maximumPrefundFeeWei) ||
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
        finish();
        alert.error(t('transactions.smartAccountCancelUnavailable'));
      } catch {
        /* retired owner */
      }
    }
  };
  const confirm = async (shown: Review) => {
    if (shown.confirming || view?.busy || review !== shown) return;
    shown.confirming = true;
    let authorized = false;
    const refreshActivity = () =>
      window.dispatchEvent(
        new Event(SMART_ACCOUNT_AUTHORIZATION_UPDATED_EVENT)
      );
    try {
      shown.assertCurrent();
      setReview(undefined);
      setView({ scope, busy: true });
      const { prepared } = shown;
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
      finish();
      alert.success(t('transactions.transactionCancelSubmitted'));
      refreshActivity();
    } catch (error) {
      try {
        shown.assertCurrent();
        finish();
        if (authorized) {
          alert.warning(t('transactions.smartAccountCancelSigned'));
          refreshActivity();
        } else if (error?.code !== 4001) {
          alert.error(t('transactions.smartAccountCancelUnavailable'));
        }
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
    content: shown && (
      <ConfirmationModal
        show
        title={t('header.cancelTx')}
        description={t('transactions.smartAccountCancelReviewDescription')}
        buttonText={t('transactions.smartAccountCancelSign')}
        describeDialog
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
        <CancellationReviewDetails
          prepared={shown.prepared}
          symbol={activeNetwork.currency.toUpperCase()}
        />
      </ConfirmationModal>
    ),
  };
}
