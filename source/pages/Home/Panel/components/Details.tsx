import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { ExternalLinkSvg } from 'components/Icon/Icon';
import { useUtils } from 'hooks/useUtils';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import type { ExtensionUtxoReplacementActions } from 'scripts/Background/controllers/utxoReplacementReview';
import { RootState } from 'state/store';
import { selectActiveAccountTransactions } from 'state/vault/selectors';
import { TransactionsType } from 'state/vault/types';
import { getWalletNavigationScope, navigateBack } from 'utils/navigationState';
import { buildExplorerUrl, selectExplorerUrl } from 'utils/strings';

import { AssetDetails } from './AssetDetails';
import { NftsDetails } from './Nfts';
import { TransactionDetails } from './TransactionDetails';
import { replacementHash } from './Transactions/EVM/replacementWinner';
import { readUtxoReplacementTabTxid } from './Transactions/UTXO/utxoReplacementNavigation';
import { getUtxoSummaryObservation } from './Transactions/UTXO/utxoTransactionDetails';

export const DetailsView = () => {
  const { t } = useTranslation();
  const explorer = useSelector(selectExplorerUrl);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const location = useLocation();
  const { navigate } = useUtils();
  const accountTransactions = useSelector(selectActiveAccountTransactions);
  const walletScope = useSelector(getWalletNavigationScope, shallowEqual);
  const {
    id,
    hash: rawHash,
    nftCollection,
    nftData,
    tx,
  } = location.state || {};
  const transactions =
    accountTransactions[
      isBitcoinBased ? TransactionsType.Syscoin : TransactionsType.Ethereum
    ]?.[activeNetwork.chainId] || [];
  const routeScope = location.state?.walletScope;
  const isCurrentRoute =
    routeScope?.account === walletScope.account &&
    routeScope?.network === walletScope.network;
  // Older public previews did not carry a wallet scope. Bind those snapshots
  // to their first route context, not whichever account/network opens later.
  const publicEntry = useRef({ key: location.key, scope: walletScope });
  if (publicEntry.current.key !== location.key)
    publicEntry.current = { key: location.key, scope: walletScope };
  const publicScope = routeScope || publicEntry.current.scope;
  const routeHash =
    typeof rawHash === 'string' && rawHash.trim() ? rawHash : undefined;
  const tabTxid =
    !routeHash &&
    isBitcoinBased &&
    publicScope.account === walletScope.account &&
    publicScope.network === walletScope.network
      ? readUtxoReplacementTabTxid(location.search)
      : undefined;
  const cachedTabTarget =
    tabTxid &&
    transactions.some(
      (transaction) => transaction.txid?.toLowerCase() === tabTxid
    );
  const lookupKey =
    tabTxid && !cachedTabTarget
      ? JSON.stringify([
          location.key,
          tabTxid,
          walletScope.account,
          walletScope.network,
          accountTransactions.utxoActivityReset?.[activeNetwork.chainId]
            ?.revision,
        ])
      : undefined;
  const [tabLookup, setTabLookup] = useState<{
    eligible: boolean;
    key: string;
  }>();
  useEffect(() => {
    if (!lookupKey || !tabTxid) return;
    let live = true;
    const finish = (eligible: boolean) => {
      if (live) setTabLookup({ key: lookupKey, eligible });
    };
    void controllerEmitter(
      ['wallet', 'getUtxoReplacementActions'],
      [tabTxid, { account: walletScope.account, network: walletScope.network }],
      15_000,
      false
    ).then(
      (value: ExtensionUtxoReplacementActions) =>
        finish(
          value?.hardware === true &&
            (value.speedUp === true || value.cancel === true)
        ),
      () => finish(false)
    );
    return () => {
      live = false;
    };
  }, [lookupKey, tabTxid, walletScope.account, walletScope.network]);
  const checkingTabTarget = !!lookupKey && tabLookup?.key !== lookupKey;
  const ownedReplacementTarget =
    !!lookupKey && tabLookup?.key === lookupKey && tabLookup.eligible;
  const hash =
    routeHash ??
    (cachedTabTarget || ownedReplacementTarget ? tabTxid : undefined);
  const payloadChain = (nftData || location.state)?.chainId;
  const isCurrentPublicPayload =
    publicScope.account === walletScope.account &&
    publicScope.network === walletScope.network &&
    (payloadChain === undefined || payloadChain === activeNetwork.chainId);
  const routeTransaction = isCurrentRoute ? tx : undefined;
  const winnerHash =
    isCurrentRoute && !isBitcoinBased
      ? replacementHash(location.state?.replacementWinnerHash)
      : undefined;
  const winnerProps =
    winnerHash && replacementHash(hash) && winnerHash !== replacementHash(hash)
      ? {
          replacementWinnerHash: winnerHash,
          replacementWinner: location.state?.replacementWinner,
        }
      : {};

  const isAsset = id && !hash;
  const isNft = Boolean(
    nftCollection && nftData?.contractAddress && isCurrentPublicPayload
  );
  const currentNft = useSelector((state: RootState) =>
    !isNft || nftData.isImportPreview === true
      ? nftData
      : state.vault.accountAssets?.[state.vault.activeAccount.type]?.[
          state.vault.activeAccount.id
        ]?.ethereum.find(
          (asset) =>
            asset.id === nftData.id &&
            asset.chainId === activeNetwork.chainId &&
            asset.isNft &&
            asset.tokenStandard === nftData.tokenStandard &&
            asset.contractAddress.toLowerCase() ===
              nftData.contractAddress.toLowerCase()
        )
  );
  const hasDetails = Boolean(isAsset || isNft || hash);
  const restoredTransaction = hash
    ? transactions.find(
        (transaction: any) =>
          String(transaction.hash || transaction.txid).toLowerCase() ===
          String(hash).toLowerCase()
      )
    : undefined;
  const utxoRouteSummaryObservation =
    isBitcoinBased &&
    hash &&
    typeof routeTransaction?.txid === 'string' &&
    routeTransaction.txid.toLowerCase() === hash.toLowerCase()
      ? getUtxoSummaryObservation(routeTransaction)
      : undefined;

  useEffect(() => {
    if (!hasDetails && !checkingTabTarget) navigateBack(navigate, location);
  }, [hasDetails, checkingTabTarget, navigate, location]);

  const openExplorer = () => {
    if (!explorer) return;
    window.open(buildExplorerUrl(explorer, 'tx', hash), '_blank');
  };

  if (!hasDetails)
    return checkingTabTarget ? (
      <p role="status">{t('networkConnection.loadingTransactions')}</p>
    ) : null;

  return (
    <ul
      id="details-view-content"
      data-navigation-scroll="details-view-content"
      className="remove-scrollbar md:max-h-max w-full text-sm overflow-auto"
    >
      {isNft ? (
        <NftsDetails nftData={currentNft} />
      ) : isAsset ? (
        <AssetDetails
          id={id}
          navigationState={isCurrentPublicPayload ? location.state : undefined}
        />
      ) : (
        <TransactionDetails
          hash={hash}
          tx={restoredTransaction || routeTransaction}
          utxoRouteSummaryObservation={utxoRouteSummaryObservation}
          {...(ownedReplacementTarget
            ? { ownedUtxoReplacementTarget: true }
            : {})}
          {...winnerProps}
        />
      )}

      {!isAsset && !isNft && Boolean(explorer) ? (
        <li className="mt-6 mb-4 flex items-center justify-center">
          <button
            type="button"
            className="flex items-center justify-center gap-2 cursor-pointer transition-all duration-300 hover:opacity-60 py-3 px-4 rounded-lg border border-dashed border-[#FFFFFF29] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={openExplorer}
          >
            <ExternalLinkSvg className="w-4 h-4" />
            <span className="text-sm text-white underline">
              {t('home.viewOnExplorer')}
            </span>
          </button>
        </li>
      ) : null}
    </ul>
  );
};
