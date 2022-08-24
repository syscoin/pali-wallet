import React from 'react';

import Sign_ from './Sign';
import Transaction from './Transaction';

export const SendToken = () => <Transaction type="Send" />;

//* Token
export const CreateToken = () => <Transaction type="CreateToken" />;
export const MintToken = () => <Transaction type="MintToken" />;
export const TransferToken = () => <Transaction type="TransferToken" />;
export const UpdateToken = () => <Transaction type="UpdateToken" />;

//* NFT
export const CreateNFT = () => <Transaction type="CreateNFT" />;
export const MintNFT = () => <Transaction type="MintNFT" />;

//* Sign
export const Sign = () => <Sign_ />;
export const SignAndSend = () => <Sign_ send />;
