import { PaliInpageProvider } from './paliProvider';
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Read files in as strings
declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    SUPPORTED_WALLET_METHODS: any;
    ethereum: Readonly<any>;
    pali: Readonly<any>;
  }
}

window.pali = new PaliInpageProvider('syscoin');
window.ethereum = new PaliInpageProvider('ethereum');
// window.beterraba = new PaliInpageProvider('ethereum');

export const { SUPPORTED_WALLET_METHODS } = window;
