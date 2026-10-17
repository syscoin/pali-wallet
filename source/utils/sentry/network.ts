import { INetworkType } from 'types/network';

import type { SentryNetwork } from './types';

export const SENTRY_NETWORKS = {
  mainnet: {
    chainId: 57,
    genesisHash:
      '0000022642db0346b6e01c2a397471f4f12e65d4f4251ec96c1f85367a61a7ab',
    defaultServiceUrl: 'https://sysnode.info',
    encoding: { bech32Hrp: 'sys', pubKeyHash: 0x3f, scriptHash: 0x05 },
  },
  testnet: {
    chainId: 5700,
    genesisHash:
      '0000066e1a6b9cfeac8295dce0cc8d9170690a74bc4878cf8a0b412554f5c222',
    defaultServiceUrl: '',
    encoding: { bech32Hrp: 'tsys', pubKeyHash: 0x41, scriptHash: 0xc4 },
  },
} as const;

export const getSentryNetwork = (network: {
  chainId: number;
  kind?: string;
}): SentryNetwork => {
  if (network.kind !== INetworkType.Syscoin)
    throw new Error('Sentry operations require a Syscoin UTXO network');
  if (network.chainId === SENTRY_NETWORKS.mainnet.chainId) return 'mainnet';
  if (network.chainId === SENTRY_NETWORKS.testnet.chainId) return 'testnet';
  throw new Error('This Syscoin network does not support Sentry management');
};

/** Only trusted extension settings can call this; sites cannot provide a URL. */
export const normalizeSentryServiceUrl = (value: string): string => {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    throw new Error('Use an HTTPS service origin or a local loopback origin');
  return url.origin;
};

export const validateSentryFeeLimit = (value: string): string => {
  if (!/^[1-9]\d{0,7}$/.test(value) || Number(value) > 10000000)
    throw new Error('Maximum fee must be between 1 and 10000000 satoshis');
  return value;
};
