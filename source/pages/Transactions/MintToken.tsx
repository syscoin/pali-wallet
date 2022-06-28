import React from 'react';

import { TxConfirmLayout, TxLayout } from 'components/Layout';

// confirmMintSPT
export const MintTokenConfirm = () => (
  <TxConfirmLayout title="TOKEN MINT" txType="mintAsset" />
);

export const MintToken = () => (
  <TxLayout
    confirmRoute="/external/tx/asset/issue/confirm"
    txType="mintAsset"
    title="Mint token"
  />
);
