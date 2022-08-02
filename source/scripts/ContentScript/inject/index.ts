// @ts-nocheck
// Read files in as strings
import pali from './pali.txt';

declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    SUPPORTED_WALLET_METHODS: any;
    pali: Readonly<any>;
  }
}

export const { SUPPORTED_WALLET_METHODS } = window;

export { pali };
