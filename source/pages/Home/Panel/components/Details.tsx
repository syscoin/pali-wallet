import React, { useState, useEffect } from 'react';
import { Layout, Icon, Button } from 'components/index';
import { useLocation } from 'react-router-dom';
import { getController } from 'utils/browser';
import { useStore } from 'hooks/index';

import { AssetDetails } from './AssetDetails';
import { TransactionDetails } from './TransactionDetails';

export const DetailsView = () => {
  const controller = getController();

  const {
    activeNetwork,
    networks,
    activeAccount: { transactions },
  } = useStore();
  const isSyscoinChain = Boolean(networks.syscoin[activeNetwork.chainId]);

  const {
    state: { assetGuid, tx, assetType, type },
  }: any = useLocation();

  const [transactionDetails, setTransactionDetails] = useState<any>(null);
  const [hash, setHash] = useState<string>('');

  const isSysNetwork = activeNetwork.currency === 'sys';

  const isAsset = assetGuid && !tx;

  useEffect(() => {
    const getTransactionData = async () => {
      if (assetGuid) {
        const assetData = await controller.utils.getAsset(
          activeNetwork.url,
          assetGuid
        );

        const description =
          assetData.pubData && assetData.pubData.desc
            ? atob(String(assetData.pubData.desc))
            : '';

        setTransactionDetails(
          Object.assign(assetData, isSysNetwork && { description })
        );

        return;
      }

      const txData = await controller.utils.getRawTransaction(
        activeNetwork.url,
        tx.txid
      );

      if (isSyscoinChain) {
        setTransactionDetails(txData);

        return;
      }

      setTransactionDetails(transactions);
    };

    getTransactionData();
  }, [tx || assetGuid]);

  const openSysExplorer = () => {
    window.open(
      `${activeNetwork.url}/${isAsset ? 'asset' : 'tx'}/${
        isAsset ? transactionDetails.assetGuid : transactionDetails.txid
      }`
    );
  };

  const openEthExplorer = () => {
    const { label } = activeNetwork;

    const explorer = label.includes('Ethereum')
      ? 'https://etherscan.io'
      : `https://${label.toLowerCase()}.etherscan.io`;

    window.open(`${explorer}/tx/${hash}`);
  };

  return (
    <Layout title={`${assetGuid ? 'ASSET DETAILS' : 'TRANSACTION DETAILS'}`}>
      {transactionDetails ? (
        <>
          <ul className="scrollbar-styled mt-4 w-full h-96 text-sm overflow-auto md:h-full">
            {isAsset ? (
              <AssetDetails
                assetType={assetType}
                assetData={transactionDetails}
              />
            ) : (
              <TransactionDetails
                transactionType={type}
                transactionDetails={transactionDetails}
                setTransactionHash={setHash}
                txAddress={tx}
              />
            )}
          </ul>

          <div className="fixed bottom-0 left-0 right-0 flex gap-x-6 items-center justify-between mx-auto p-4 w-full text-xs bg-bkg-3 md:max-w-2xl">
            <p>
              Would you like to go to view {isAsset ? 'asset' : 'transaction'}{' '}
              on {isSyscoinChain ? 'SYS Block' : 'Etherscan'} Explorer?
            </p>

            <Button
              type="button"
              onClick={isSyscoinChain ? openSysExplorer : openEthExplorer}
              className="inline-flex justify-center px-6 py-1 hover:text-brand-royalblue text-brand-white text-sm font-medium hover:bg-button-popuphover bg-transparent border border-brand-white rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
            >
              Go
            </Button>
          </div>
        </>
      ) : (
        <Icon name="loading" className="absolute left-1/2 top-1/2 w-3" />
      )}
    </Layout>
  );
};
