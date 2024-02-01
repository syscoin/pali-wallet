/* eslint-disable import/no-extraneous-dependencies */
import { v4 as uuidv4 } from 'uuid';

import { PaliInpageProviderEth } from './paliProviderEthereum';
import { shimWeb3 } from './shimWeb3';
import { announceProvider } from './utils';
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Read files in as strings
declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    SUPPORTED_WALLET_METHODS: Readonly<any>;
    ethereum: Readonly<any>;
  }
}
const ethereumProvider = new PaliInpageProviderEth();
const proxiedProvider = new Proxy(ethereumProvider, {
  // some common libraries, e.g. web3@1.x, mess with our API
  deleteProperty: () => true,
});
window.ethereum = proxiedProvider;

window.addEventListener('eip6963:requestProvider', () => {
  announceProvider(proxiedProvider, uuidv4());
});

announceProvider(proxiedProvider, uuidv4());
shimWeb3(proxiedProvider);

export const { SUPPORTED_WALLET_METHODS } = window;
