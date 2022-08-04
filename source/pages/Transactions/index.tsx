import React from 'react';

import Sign from './Sign';
import Transaction from './Transaction';

//* CreateToken
export const Create = () => <Transaction type="CreateToken" />;

//* CreateAndIssueNFT
export const CreateAndIssueNFT = () => <Transaction type="CreateNFT" />;

//* MintNFT
export const MintNFT = () => <Transaction type="MintNFT" />;

//* SignAndSend
export const SignAndSend = () => <Sign send />;

//* SignPSBT
export const SignPSBT = () => <Sign />;

//* TransferOwnership
export const TransferOwnership = () => <Transaction type="TransferToken" />;

//* UpdateAsset
export const UpdateAsset = () => <Transaction type="UpdateToken" />;

//* MintToken
export const MintToken = () => <Transaction type="MintToken" />;
