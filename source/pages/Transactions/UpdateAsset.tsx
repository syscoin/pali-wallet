import React from 'react';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmUpdateAsset
export const UpdateAssetConfirm = () => (
  <TxConfirmLayout title="UPDATE ASSET" txName="updateAsset" />
);

export const UpdateAsset = () => (
  <TxLayout
    confirmRoute="/tx/asset/update/confirm"
    txName="updateAsset"
    title="Update Asset"
  />
);
