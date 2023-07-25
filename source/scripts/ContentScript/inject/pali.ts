import { PaliInpageProviderSys } from './paliProviderSyscoin';

// Read files in as strings
declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    pali: Readonly<any>;
  }
}

window.pali = new PaliInpageProviderSys();
