import React from 'react';
import { useController } from 'hooks/index';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

export const CreateTokenConfirm = () => {
  const controller = useController();
  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction('newAsset');

  return (
    <TxConfirmLayout
      sign={false}
      signAndSend={false}
      title="TOKEN CREATION"
      callback={controller.wallet.account.confirmSPTCreation}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="newAsset"
    />
  );
};

export const Create = () => (
  <div>
    <TxLayout
      confirmRoute="/transaction/create/confirm"
      temporaryTransactionAsString="newAsset"
      layoutTitle="Create token"
    />
  </div>
);
