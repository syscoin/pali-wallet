// Default network configurations for frontend use
// Matches the structure from sysweb3-keyring but avoids importing it in frontend
import { INetwork, INetworkType } from 'types/network';

export const getSyscoinUTXOMainnetNetwork = (): INetwork => ({
  chainId: 57,
  slip44: 57,
  label: 'Syscoin Mainnet',
  currency: 'sys',
  url: 'https://blockbook.syscoin.org/',
  explorer: 'https://blockbook.syscoin.org/',
  default: true,
  kind: INetworkType.Syscoin,
});

export const getSyscoinUTXOTestnetNetwork = (): INetwork => ({
  chainId: 5700,
  slip44: 1,
  label: 'Syscoin Testnet',
  currency: 'tsys',
  url: 'https://blockbook-dev.syscoin.org/',
  explorer: 'https://blockbook-dev.syscoin.org/',
  default: false,
  kind: INetworkType.Syscoin,
});

export const getBitcoinMainnetNetwork = (): INetwork => ({
  chainId: 0,
  slip44: 0,
  label: 'Bitcoin',
  currency: 'btc',
  url: 'https://btc1.trezor.io/',
  explorer: 'https://btc1.trezor.io/',
  default: false,
  kind: INetworkType.Syscoin,
});

// Return object mapping chainId to network (matches sysweb3-keyring structure)
export const getDefaultUTXONetworks = (): { [chainId: number]: INetwork } => ({
  57: getSyscoinUTXOMainnetNetwork(),
  5700: getSyscoinUTXOTestnetNetwork(),
  0: getBitcoinMainnetNetwork(),
});
