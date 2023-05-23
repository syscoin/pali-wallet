import { PaliInpageProviderEth } from './paliProviderEthereum';
import { shimWeb3 } from './shimWeb3';
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

// Handler for window.ethereum (trigger whenever window.ethereum is read)
Object.defineProperty(window, 'ethereum', {
  get: function() {
    if (window.pali) {
      if ('SCRIPT' !== window.pali.nodeName) {
        if (window.pali.isBitcoinBased()) {
          window.paliAlert.set('WARNING! Pali connected to UTXO network');
          window.paliAlert.show();
          return false;
        } else {
          window.paliAlert.hide();
          return proxiedProvider; // Work as normal
        }
      } else {
        // Pali is still loading...
      }
    }
  }
});

shimWeb3(proxiedProvider);

export const { SUPPORTED_WALLET_METHODS } = window;
