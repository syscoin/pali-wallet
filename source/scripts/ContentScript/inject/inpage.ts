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
    paliWalletAnnounced?: boolean;
  }
}

// Create or get existing ethereum provider
let ethereumProvider: PaliInpageProviderEth;
let proxiedProvider: any;

// Guard against duplicate injections
if ((window as any).__paliWalletInjected) {
  console.log('[Pali] Script already injected, exiting');
  // Get the existing provider instances
  ethereumProvider = (window as any).paliProvider?.ethereumProvider;
  proxiedProvider = (window as any).paliProvider?.proxiedProvider;
} else {
  (window as any).__paliWalletInjected = true;
  console.log('[Pali] Creating new provider instance');

  ethereumProvider = new PaliInpageProviderEth();
  // Create a more comprehensive proxy that properly forwards all operations
  proxiedProvider = new Proxy(ethereumProvider, {
    // some common libraries, e.g. web3@1.x, mess with our API
    deleteProperty: () => true,
    get: (target, prop, receiver) => {
      // Forward all property access to the target
      const value = Reflect.get(target, prop, receiver);
      // Bind functions to maintain correct 'this' context
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
    set: (target, prop, value) => Reflect.set(target, prop, value),
    has: (target, prop) => Reflect.has(target, prop),
  });

  // Store for reuse with initialization flag
  (window as any).paliProvider = {
    ethereumProvider,
    proxiedProvider,
    initialized: true,
  };

  // Check if MetaMask or another wallet is already present
  const existingEthereum = window.ethereum;
  const isMetaMaskPresent =
    existingEthereum &&
    (existingEthereum.isMetaMask || existingEthereum._metamask);

  if (isMetaMaskPresent) {
    console.log('[Pali] MetaMask detected, using EIP-6963 for coexistence');

    // Store reference to MetaMask for potential fallback
    // eslint-disable-next-line camelcase
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

  shimWeb3(proxiedProvider);
} // End of provider creation else block

// Set up EIP-6963 announcements immediately (outside the provider setup block)
// This ensures announcements happen even if provider setup was skipped
if (!(window as any).__paliAnnouncementSetup) {
  (window as any).__paliAnnouncementSetup = true;

  // Generate a consistent UUID for this page session
  const providerUUID = uuidv4();
  // UUID generated for EIP-6963

  // Store UUID globally
  if ((window as any).paliProvider) {
    (window as any).paliProvider.uuid = providerUUID;
  }

  // Listen for EIP-6963 requests FIRST (before any announcements)
  window.addEventListener('eip6963:requestProvider', () => {
    console.log('[Pali] Received eip6963:requestProvider event');
    announceProvider(proxiedProvider, providerUUID);
  });

  // Announce immediately - this is critical for dapps that check early
  console.log('[Pali] Announcing provider immediately');
  announceProvider(proxiedProvider, providerUUID);

  // Also announce when DOM is ready as a backup
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Announce on DOMContentLoaded as backup
      announceProvider(proxiedProvider, providerUUID);
    });
  }

  // And on load event as another backup
  window.addEventListener('load', () => {
    // Announce on load as final backup
    announceProvider(proxiedProvider, providerUUID);
  });
}

export const { SUPPORTED_WALLET_METHODS } = window;
