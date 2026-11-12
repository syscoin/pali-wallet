// TypeScript and unsupported resolvers fail closed; Metro selects .native/.web.
export { openNativeWalletStorage, canResetNativeWalletStorage, resetNativeWalletStorage } from './native.web.ts';
