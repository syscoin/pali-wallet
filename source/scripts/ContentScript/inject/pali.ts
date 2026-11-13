import { SYS_PROVIDER_KEY } from '../providerChannel';

import { PaliInpageProviderSys } from './paliProviderSyscoin';

// Read files in as strings
declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    pali: Readonly<PaliInpageProviderSys>;
  }
}

const provider = new PaliInpageProviderSys();
(window as any)[SYS_PROVIDER_KEY] = provider;
// Keep the legacy convenience API when Canary is the only installed wallet.
if (!window.pali) window.pali = provider;
