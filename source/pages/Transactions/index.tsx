import React from 'react';

import Decrypt_ from './Decrypt';
import EncryptPubKey_ from './EncryptPubKey';
import Sign_ from './Sign';
import EthSign_ from './SignEth';
import Transaction from './Transaction';
export const SendToken = () => <Transaction type="Send" />;

//* Sign
export const Sign = () => <Sign_ send />;
export const EthSign = () => <EthSign_ />;
export const SignAndSend = () => <Sign_ />;

//* PubKey for encryption
export const EncryptPubKey = () => <EncryptPubKey_ />;

//* Decrypt
export const Decrypt = () => <Decrypt_ />;
