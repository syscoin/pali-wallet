import { fetch as expoFetch } from 'expo/fetch';
import { createNativeHttpFetch } from './httpPolicy.ts';

/** Native-owned transport; never install a global fetch replacement. */
export const walletFetch = createNativeHttpFetch(expoFetch);
