import React from 'react';

import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmSPTCreation
export const CreateTokenConfirm = () => (
  <TxConfirmLayout title="TOKEN CREATION" txType="newAsset" />
);

export const Create = () => (
  <TxLayout
    confirmRoute="/external/tx/create/confirm"
    txType="newAsset"
    title="Create token"
  />
);
