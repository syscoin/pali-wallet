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

// Check if MetaMask or another wallet is already present
const existingEthereum = window.ethereum;
const isMetaMaskPresent =
  existingEthereum &&
  (existingEthereum.isMetaMask || existingEthereum._metamask);

if (isMetaMaskPresent) {
  console.log('[Pali] MetaMask detected, using EIP-6963 for coexistence');

  // Store reference to MetaMask for potential fallback
  (window as any)._metamask_ethereum = existingEthereum;

  // For bridges that check wallet.ethereum specifically,
  // we still set window.ethereum but preserve MetaMask access
  window.ethereum = proxiedProvider;

  // Also preserve MetaMask under its own namespace
  (window as any).metamask = existingEthereum;
} else {
  console.log('[Pali] No MetaMask detected, setting as primary provider');
  window.ethereum = proxiedProvider;
}

// Always announce via EIP-6963 for modern dApps
window.addEventListener('eip6963:requestProvider', () => {
  announceProvider(proxiedProvider, uuidv4());
});

announceProvider(proxiedProvider, uuidv4());
shimWeb3(proxiedProvider);

export const { SUPPORTED_WALLET_METHODS } = window;
