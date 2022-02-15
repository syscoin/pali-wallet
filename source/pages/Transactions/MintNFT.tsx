import React from 'react';
import { useController } from 'hooks/index';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

export const MintNFTConfirm = () => {
  const controller = useController();
  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction('mintNFT');

  return (
    <TxConfirmLayout
      sign={false}
      signAndSend={false}
      title="MINT NFT"
      callback={controller.wallet.account.confirmAssetTransfer}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="mintNFT"
    />
  );
};

export const MintNFT = () => (
  <div>
    <TxLayout
      confirmRoute="/transaction/asset/nft/mint/confirm"
      temporaryTransactionAsString="mintNFT"
      layoutTitle="Mint NFT"
    />
  </div>
);
