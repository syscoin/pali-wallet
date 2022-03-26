import React from 'react';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmAssetTransfer
export const MintNFTConfirm = () => (
  <TxConfirmLayout title="MINT NFT" txType="mintNFT" />
);

export const MintNFT = () => (
  <TxLayout
    confirmRoute="/external/tx/asset/nft/mint/confirm"
    txType="mintNFT"
    title="Mint NFT"
  />
);
