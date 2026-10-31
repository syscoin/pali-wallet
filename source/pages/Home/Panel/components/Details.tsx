import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { ExternalLinkSvg } from 'components/Icon/Icon';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { selectActiveAccountTransactions } from 'state/vault/selectors';
import { TransactionsType } from 'state/vault/types';
import { getWalletNavigationScope, navigateBack } from 'utils/navigationState';
import { buildExplorerUrl, selectExplorerUrl } from 'utils/strings';

import { AssetDetails } from './AssetDetails';
import { NftsDetails } from './Nfts';
import { TransactionDetails } from './TransactionDetails';
import { replacementHash } from './Transactions/EVM/replacementWinner';

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
  const hash =
    typeof rawHash === 'string' && rawHash.trim() ? rawHash : undefined;

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
  const transactions =
    accountTransactions[
      isBitcoinBased ? TransactionsType.Syscoin : TransactionsType.Ethereum
    ]?.[activeNetwork.chainId] || [];
  const restoredTransaction = hash
    ? transactions.find(
        (transaction: any) =>
          String(transaction.hash || transaction.txid).toLowerCase() ===
          String(hash).toLowerCase()
      )
    : undefined;

  useEffect(() => {
    if (!hasDetails) navigateBack(navigate, location);
  }, [hasDetails, navigate, location]);

  const openExplorer = () => {
    if (!explorer) return;
    window.open(buildExplorerUrl(explorer, 'tx', hash), '_blank');
  };

  if (!hasDetails) return null;

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
