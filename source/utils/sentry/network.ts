import { SENTRY_NETWORKS } from '../../shared/sentryNetworks';
import { INetworkType } from 'types/network';

import type { SentryNetwork } from './types';

export {
  normalizeSentryServiceUrl,
  SENTRY_NETWORKS,
} from '../../shared/sentryNetworks';

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

export const validateSentryFeeLimit = (value: string): string => {
  if (!/^[1-9]\d{0,7}$/.test(value) || Number(value) > 10000000)
    throw new Error('Maximum fee must be between 1 and 10000000 satoshis');
  return value;
};
