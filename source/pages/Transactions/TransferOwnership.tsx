import React from 'react';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmAssetTransfer
export const TransferOwnershipConfirm = () => (
  <TxConfirmLayout title="TRANSFER ASSET" txType="transferAsset" />
);

export const TransferOwnership = () => (
  <TxLayout
    confirmRoute="/tx/asset/transfer/confirm"
    txType="transferAsset"
    title="Transfer Asset"
  />
);
