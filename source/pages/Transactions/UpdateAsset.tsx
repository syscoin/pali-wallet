import React from 'react';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmUpdateAsset
export const UpdateAssetConfirm = () => (
  <TxConfirmLayout title="UPDATE ASSET" txType="updateAsset" />
);

export const UpdateAsset = () => (
  <TxLayout
    confirmRoute="/tx/asset/update/confirm"
    txType="updateAsset"
    title="Update Asset"
  />
);
