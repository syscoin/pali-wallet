import React from 'react';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmCreateNFT
export const CreateAndIssueNFTConfirm = () => (
  <TxConfirmLayout title="NFT CREATION" txName="newNFT" />
);

export const CreateAndIssueNFT = () => (
  <TxLayout
    confirmRoute="/tx/asset/nft/issue/confirm"
    txName="newNFT"
    title="Create NFT"
  />
);
