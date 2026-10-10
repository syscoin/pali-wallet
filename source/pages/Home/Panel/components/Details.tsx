import React, { useEffect } from 'react';
import { shallowEqual, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { ExternalLinkSvg } from 'components/Icon/Icon';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { selectActiveAccountTransactions } from 'state/vault/selectors';
import { TransactionsType } from 'state/vault/types';
import { adjustUrl } from 'utils/index';
import { getWalletNavigationScope, navigateBack } from 'utils/navigationState';

import { AssetDetails } from './AssetDetails';
import { NftsDetails } from './Nfts';
import { TransactionDetails } from './TransactionDetails';

export const DetailsView = () => {
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
  const routeTransaction =
    routeScope?.account === walletScope.account &&
    routeScope?.network === walletScope.network
      ? tx
      : undefined;

  const isAsset = id && !hash;
  const isNft = Boolean(nftCollection && nftData?.contractAddress);
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

  const adjustedExplorer = useAdjustedExplorer(
    activeNetwork.explorer || activeNetwork.url
  );

  useEffect(() => {
    if (!hasDetails) navigateBack(navigate, location);
  }, [hasDetails, navigate, location]);

  const openEthExplorer = () => {
    const url = `${adjustedExplorer}${isAsset ? 'address' : 'tx'}/${
      isAsset ? id : hash
    }`;
    window.open(url, '_blank');
  };

  const openSysExplorer = () => {
    const base = adjustUrl(activeNetwork.explorer || activeNetwork.url);
    const url = `${base}${isAsset ? 'asset' : 'tx'}/${isAsset ? id : hash}`;
    window.open(url, '_blank');
  };

  if (!hasDetails) return null;

  return (
    <ul
      id="details-view-content"
      data-navigation-scroll="details-view-content"
      className="remove-scrollbar md:max-h-max w-full text-sm overflow-auto"
    >
      {isNft ? (
        <NftsDetails nftData={nftData} />
      ) : isAsset ? (
        <AssetDetails id={id} />
      ) : (
        <TransactionDetails
          hash={hash}
          tx={restoredTransaction || routeTransaction}
        />
      )}

      {!isAsset && !isNft ? (
        <li className="mt-6 mb-4 flex items-center justify-center">
          <div
            className="flex items-center justify-center gap-2 cursor-pointer transition-all duration-300 hover:opacity-60 py-3 px-4 rounded-lg border border-dashed border-[#FFFFFF29]"
            onClick={isBitcoinBased ? openSysExplorer : openEthExplorer}
          >
            <ExternalLinkSvg className="w-4 h-4" />
            <p className="text-sm text-white underline">View on Explorer</p>
          </div>
        </li>
      ) : null}
    </ul>
  );
};
