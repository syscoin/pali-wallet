import { PROVIDER_WALLET_ID } from '../providerChannel';

if (window.ethereum && window.ethereum.wallet === PROVIDER_WALLET_ID)
  delete window.ethereum;
export {};
