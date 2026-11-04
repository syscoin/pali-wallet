// TypeScript/unsupported-host fallback. Metro chooses the explicit .native/.web
// sibling. Importing this fallback never installs browser or Node cryptography.
export { createNativeWalletCrypto, disposeWalletCrypto, qualifyWalletCrypto } from './native.web.ts';
