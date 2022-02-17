import React from 'react';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmAssetTransfer
export const MintNFTConfirm = () => (
  <TxConfirmLayout title="MINT NFT" txName="mintNFT" />
);

export const MintNFT = () => (
  <TxLayout
    confirmRoute="/tx/asset/nft/mint/confirm"
    txName="mintNFT"
    title="Mint NFT"
  />
);
