import React from 'react';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmMintSPT
export const MintTokenConfirm = () => (
  <TxConfirmLayout title="TOKEN MINT" txName="mintAsset" />
);

export const MintToken = () => (
  <TxLayout
    confirmRoute="/tx/asset/issue/confirm"
    temporaryTransactionAsString="mintAsset"
    layoutTitle="Mint token"
  />
);
