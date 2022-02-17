import React from 'react';
import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmSPTCreation
export const CreateTokenConfirm = () => (
  <TxConfirmLayout title="TOKEN CREATION" txName="newAsset" />
);

export const Create = () => (
  <TxLayout
    confirmRoute="/tx/create/confirm"
    txName="newAsset"
    title="Create token"
  />
);
