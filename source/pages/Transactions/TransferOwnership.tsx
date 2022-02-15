import React from 'react';
import { useController } from 'hooks/index';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

export const TransferOwnershipConfirm = () => {
  const controller = useController();
  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction('transferAsset');

  return (
    <TxConfirmLayout
      sign={false}
      signAndSend={false}
      title="TRANSFER ASSET"
      callback={controller.wallet.account.confirmAssetTransfer}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="transferAsset"
    />
  );
};

export const TransferOwnership = () => (
  <div>
    <TxLayout
      confirmRoute="/transaction/asset/transfer/confirm"
      temporaryTransactionAsString="transferAsset"
      layoutTitle="Transfer Asset"
    />
  </div>
);
