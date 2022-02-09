import { useController } from 'hooks/index';
import React, { useState, useEffect } from 'react';
import { AuthViewLayout, Icon } from 'components/index';
import { useLocation } from 'react-router-dom';

import { AssetDetails } from './AssetDetails';
import { TransactionDetails } from './TransactionDetails';

export const DetailsView = () => {
  const controller = useController();

  const { state }: any = useLocation();

  const [transactionDetails, setTransactionDetails] = useState<any>(null);

  useEffect(() => {
    const getTransactionData = async () => {
      if (state.assetGuid) {
        const assetData = await controller.wallet.account.getDataAsset(
          state.assetGuid
        );

        const description =
          assetData.pubData && assetData.pubData.desc
            ? atob(String(assetData.pubData.desc))
            : '';

        setTransactionDetails(Object.assign(assetData, { description }));

        return;
      }

      const txData = await controller.wallet.account.getTransactionInfoByTxId(
        state.tx.txid
      );

      setTransactionDetails(txData);
    };

    getTransactionData();
  }, [state.tx || state.assetGuid]);

  return (
    <AuthViewLayout
      title={`${state.assetGuid ? 'ASSET DETAILS' : 'TRANSACTION DETAILS'}`}
    >
      {transactionDetails ? (
        <ul className="scrollbar-styled mt-4 px-4 w-full h-96 text-sm overflow-auto">
          {state.assetGuid ? (
            <AssetDetails
              assetType={state.assetType}
              assetData={transactionDetails}
            />
          ) : (
            <TransactionDetails
              transactionType={state.type}
              transactionDetails={transactionDetails}
            />
          )}
        </ul>
      ) : (
        <Icon name="loading" className="absolute left-1/2 top-1/2 w-3" />
      )}
    </AuthViewLayout>
  );
};
