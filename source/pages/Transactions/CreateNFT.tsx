import React from 'react';

import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmCreateNFT
export const CreateAndIssueNFTConfirm = () => (
  <TxConfirmLayout title="NFT CREATION" txType="newNFT" />
);

export const CreateAndIssueNFT = () => (
  <TxLayout
    confirmRoute="/tx/asset/nft/issue/confirm"
    txType="newNFT"
    title="Create NFT"
  />
);
