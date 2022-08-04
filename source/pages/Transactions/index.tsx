import React from 'react';

import { TxLayout, TxSign } from 'components/Layout';

//* CreateToken
export const Create = () => <TxLayout txType="CreateToken" />;

//* CreateAndIssueNFT
export const CreateAndIssueNFT = () => <TxLayout txType="CreateNFT" />;

//* MintNFT
export const MintNFT = () => <TxLayout txType="MintNFT" />;

//* SignAndSend
export const SignAndSend = () => <TxSign send />;

//* SignPSBT
export const SignPSBT = () => <TxSign />;

//* TransferOwnership
export const TransferOwnership = () => <TxLayout txType="TransferToken" />;

//* UpdateAsset
export const UpdateAsset = () => <TxLayout txType="UpdateToken" />;

//* MintToken
export const MintToken = () => <TxLayout txType="MintToken" />;
