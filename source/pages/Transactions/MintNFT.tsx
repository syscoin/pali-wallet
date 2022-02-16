import React from 'react';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmAssetTransfer
export const MintNFTConfirm = () => (
  <TxConfirmLayout title="MINT NFT" txName="mintNFT" />
);

export const MintNFT = () => (
  <TxLayout
    confirmRoute="/transaction/asset/nft/mint/confirm"
    temporaryTransactionAsString="mintNFT"
    layoutTitle="Mint NFT"
  />
);
