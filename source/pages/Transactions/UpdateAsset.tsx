import React from 'react';
import { useController } from 'hooks/index';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

export const UpdateAssetConfirm = () => {
  const controller = useController();
  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction('updateAsset');

  return (
    <TxConfirmLayout
      sign={false}
      signAndSend={false}
      title="UPDATE ASSET"
      callback={controller.wallet.account.confirmUpdateAsset}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="updateAsset"
    />
  );
};

export const UpdateAsset = () => (
  <div>
    <TxLayout
      confirmRoute="/transaction/asset/update/confirm"
      temporaryTransactionAsString="updateAsset"
      layoutTitle="Update Asset"
      // id={id}
    />
  </div>
);
