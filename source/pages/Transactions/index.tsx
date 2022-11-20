import React from 'react';

import Sign_ from './Sign';
import EthSign_ from './SignEth';
import Transaction from './Transaction';
export const SendToken = () => <Transaction type="Send" />;

//* Token
export const CreateToken = () => <Transaction type="CreateToken" />;
export const MintToken = () => <Transaction type="MintToken" />;
export const TransferToken = () => <Transaction type="TransferToken" />;
export const UpdateToken = () => <Transaction type="UpdateToken" />;

//* NFT
export const CreateNFT = () => <Transaction type="CreateNft" />;
export const MintNFT = () => <Transaction type="MintNft" />;

//* Sign
export const Sign = () => <Sign_ />;
export const EthSign = () => <EthSign_ />;
export const SignAndSend = () => <Sign_ send />;
