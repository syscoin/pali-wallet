import React from 'react';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmAssetTransfer
export const TransferOwnershipConfirm = () => (
  <TxConfirmLayout title="TRANSFER ASSET" txName="transferAsset" />
);

export const TransferOwnership = () => (
  <TxLayout
    confirmRoute="/tx/asset/transfer/confirm"
    temporaryTransactionAsString="transferAsset"
    layoutTitle="Transfer Asset"
  />
);
