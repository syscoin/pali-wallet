import type { WalletHttpFetch } from './httpPolicy.ts';

/** Web/test fallback. Metro selects http.native.ts for native bundles. */
export const walletFetch: WalletHttpFetch = (url, init) => fetch(url, init);
