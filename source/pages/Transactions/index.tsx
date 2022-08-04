import React from 'react';

import { TxConfirmLayout, TxLayout } from 'components/Layout';

//* CreateToken
export const CreateTokenConfirm = () => (
  <TxConfirmLayout title="TOKEN CREATION" txType="newAsset" />
);

export const Create = () => <TxLayout txType="newAsset" title="Create token" />;

//* CreateAndIssueNFT
export const CreateAndIssueNFTConfirm = () => (
  <TxConfirmLayout title="NFT CREATION" txType="newNFT" />
);

export const CreateAndIssueNFT = () => (
  <TxLayout txType="newNFT" title="Create NFT" />
);

//* confirmAssetTransfer
export const MintNFTConfirm = () => (
  <TxConfirmLayout title="MINT NFT" txType="mintNFT" />
);

export const MintNFT = () => <TxLayout txType="mintNFT" title="Mint NFT" />;

//* SignAndSend
export const SignAndSend = () => (
  <TxConfirmLayout
    sign
    signAndSend
    title="SIGNATURE REQUEST"
    txType="signAndSendPSBT"
  />
);

//* SignPSBT
export const SignPSBT = () => (
  <TxConfirmLayout sign title="SIGNATURE REQUEST" txType="signPSBT" />
);

//* TransferOwnership
export const TransferOwnershipConfirm = () => (
  <TxConfirmLayout title="TRANSFER ASSET" txType="transferAsset" />
);

export const TransferOwnership = () => (
  <TxLayout txType="transferAsset" title="Transfer Asset" />
);

//* UpdateAsset
export const UpdateAssetConfirm = () => (
  <TxConfirmLayout title="UPDATE ASSET" txType="updateAsset" />
);

export const UpdateAsset = () => (
  <TxLayout txType="updateAsset" title="Update Asset" />
);

//* MintToken
export const MintTokenConfirm = () => (
  <TxConfirmLayout title="TOKEN MINT" txType="mintAsset" />
);

export const MintToken = () => (
  <TxLayout txType="mintAsset" title="Mint Token" />
);
