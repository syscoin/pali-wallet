// @ts-nocheck
// Read files in as strings
import paliProvider from './paliProvider.txt';
import providerManager from './providerManager.txt';

declare global {
  interface Window {
    SUPPORTED_WALLET_METHODS: any;
    pali: Readonly<any>;
    providerManager: Readonly<any>;
  }
}

export const { SUPPORTED_WALLET_METHODS } = window;

export { providerManager, paliProvider };
