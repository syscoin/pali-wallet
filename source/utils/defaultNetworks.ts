// Default network configurations for frontend use
// Matches the structure from sysweb3-keyring but avoids importing it in frontend
import type { INetwork, INetworkType } from '../types/network.ts';

const utxoKind = 'syscoin' as INetworkType.Syscoin;

type DefaultUtxoNetwork = INetwork & {
  kind: INetworkType.Syscoin;
  utxoBackendChain: 'main' | 'test';
};

export const getSyscoinUTXOMainnetNetwork = (): DefaultUtxoNetwork => ({
  utxoBackendChain: 'main',
  chainId: 57,
  slip44: 57,
  label: 'Syscoin Mainnet',
  currency: 'sys',
  url: 'https://blockbook.syscoin.org/',
  explorer: 'https://explorer-blockbook.syscoin.org/',
  default: true,
  kind: utxoKind,
});

export const getSyscoinUTXOTestnetNetwork = (): DefaultUtxoNetwork => ({
  utxoBackendChain: 'test',
  chainId: 5700,
  slip44: 1,
  label: 'Syscoin Testnet',
  currency: 'tsys',
  url: 'https://blockbook-dev.syscoin.org/',
  explorer: 'https://explorer-blockbook-dev.syscoin.org/',
  default: false,
  kind: utxoKind,
});

export const getBitcoinMainnetNetwork = (): DefaultUtxoNetwork => ({
  utxoBackendChain: 'main',
  chainId: 0,
  slip44: 0,
  label: 'Bitcoin',
  currency: 'btc',
  url: 'https://btc1.trezor.io/',
  explorer: 'https://btc1.trezor.io/',
  default: false,
  kind: utxoKind,
});

// Return object mapping chainId to network (matches sysweb3-keyring structure)
export const getDefaultUTXONetworks = (): Record<
  number,
  DefaultUtxoNetwork
> => ({
  57: getSyscoinUTXOMainnetNetwork(),
  5700: getSyscoinUTXOTestnetNetwork(),
  0: getBitcoinMainnetNetwork(),
});
