import React from 'react';
import { useController } from 'hooks/index';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

export const CreateAndIssueNFTConfirm = () => {
  const controller = useController();
  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction('newNFT');

  return (
    <TxConfirmLayout
      sign={false}
      signAndSend={false}
      title="NFT CREATION"
      callback={controller.wallet.account.confirmCreateNFT}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="newNFT"
    />
  );
};

export const CreateAndIssueNFT = () => (
  <TxLayout
    confirmRoute="/transaction/asset/nft/issue/confirm"
    temporaryTransactionAsString="newNFT"
    layoutTitle="Create NFT"
  />
);
