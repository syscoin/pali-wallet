import { AuthViewLayout } from 'containers/common/Layout';
import { useController } from 'hooks/index';
import React, { useState, useEffect } from 'react';
import { Icon } from 'components/Icon';
import { AssetDetails } from './AssetDetails';
import { TransactionDetails } from './TransactionDetails';

export const DetailsView = ({ location }) => {
  const controller = useController();

  const [transactionDetails, setTransactionDetails] = useState<any>(null);

  useEffect(() => {
    const getTransactionData = async () => {
      if (location.state.assetGuid) {
        const assetData = await controller.wallet.account.getDataAsset(location.state.assetGuid);

        const description = assetData.pubData && assetData.pubData.desc
        ? atob(String(assetData.pubData.desc))
        : '';

        setTransactionDetails(Object.assign(assetData, { description }));

        return;
      }

      const txData = await controller.wallet.account.getTransactionData(location.state.tx.txid);

      setTransactionDetails(txData);
    };

    getTransactionData();
  }, [location.state.tx || location.state.assetGuid]);

  return (
    <AuthViewLayout
      title={`${location.state.assetGuid ?
        'ASSET DETAILS' :
        'TRANSACTION DETAILS'
        }`
      }
    >
      {transactionDetails ? (
        <ul className="scrollbar-styled text-sm overflow-auto px-4 mt-4 h-96 w-full">
          {location.state.assetGuid ? (
            <AssetDetails
              assetType={location.state.assetType}
              assetData={transactionDetails}
            />
          ) : (
            <TransactionDetails
              transactionType={location.state.type}
              transactionDetails={transactionDetails}
            />
          )}
        </ul>
      ) : (
        <Icon
          name="loading"
          className="w-3 absolute top-1/2 left-1/2"
        />
      )}
    </AuthViewLayout >
  )
}