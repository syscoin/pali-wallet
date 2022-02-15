import React from 'react';
import { useController } from 'hooks/index';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

export const MintTokenConfirm = () => {
  const controller = useController();
  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction('mintAsset');

  return (
    <TxConfirmLayout
      sign={false}
      signAndSend={false}
      title="TOKEN MINT"
      callback={controller.wallet.account.confirmMintSPT}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="mintAsset"
    />
  );
};

export const MintToken = () => (
  <TxLayout
    confirmRoute="/transaction/asset/issue/confirm"
    temporaryTransactionAsString="mintAsset"
    layoutTitle="Mint token"
  />
);
