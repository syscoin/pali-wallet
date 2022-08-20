// @ts-nocheck
// Read files in as strings
import inject from './inject.txt';

declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    SUPPORTED_WALLET_METHODS: any;
    pali: Readonly<any>;
  }
}

export const { SUPPORTED_WALLET_METHODS } = window;

export { inject };
