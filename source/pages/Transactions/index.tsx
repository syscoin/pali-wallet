import React from 'react';

import { TxConfirmLayout, TxLayout } from 'components/Layout';

//* CreateToken
export const Create = () => <TxLayout txType="CreateToken" />;

//* CreateAndIssueNFT
export const CreateAndIssueNFT = () => <TxLayout txType="CreateNFT" />;

//* MintNFT
export const MintNFT = () => <TxLayout txType="MintNFT" />;

//* SignAndSend
export const SignAndSend = () => (
  <TxConfirmLayout
    sign
    signAndSend
    txType="SignAndSend"
    title="Signature Request"
  />
);

//* SignPSBT
export const SignPSBT = () => (
  <TxConfirmLayout sign txType="Sign" title="Signature Request" />
);

//* TransferOwnership
export const TransferOwnership = () => <TxLayout txType="TransferToken" />;

//* UpdateAsset
export const UpdateAsset = () => <TxLayout txType="UpdateToken" />;

//* MintToken
export const MintToken = () => <TxLayout txType="MintToken" />;
