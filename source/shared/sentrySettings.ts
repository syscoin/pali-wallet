import {
  normalizeSentryServiceUrl,
  SENTRY_NETWORKS,
  validateSentryFeeLimit,
  type SentryNetwork,
} from './sentryNetworks.ts';

export type SentryServiceSettings = Readonly<{
  maxFeeSatoshis: string;
  serviceUrl: string;
}>;

const PREFIX = 'sentry-settings-v1:';
function invalid(): never {
  throw new Error('Invalid Sentry service settings');
}

export function sentrySettingsStorageKey(
  vaultId: string,
  network: SentryNetwork
): string {
  if (
    !/^[a-f0-9]{64}$/.test(vaultId) ||
    !Object.hasOwn(SENTRY_NETWORKS, network)
  )
    invalid();
  return `${PREFIX}${vaultId}:${network}`;
}

export function parseSentrySettingsStorageKey(
  key: string
): Readonly<{ network: SentryNetwork; vaultId: string }> | null {
  const matched = /^sentry-settings-v1:([a-f0-9]{64}):(mainnet|testnet)$/.exec(
    key
  );
  return matched
    ? Object.freeze({
        vaultId: matched[1]!,
        network: matched[2] as SentryNetwork,
      })
    : null;
}

export function normalizeSentryServiceSettings(
  value: unknown
): SentryServiceSettings {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalid();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    !keys.includes('serviceUrl') ||
    !keys.includes('maxFeeSatoshis')
  )
    invalid();
  const service = Object.getOwnPropertyDescriptor(value, 'serviceUrl');
  const fee = Object.getOwnPropertyDescriptor(value, 'maxFeeSatoshis');
  if (
    !service?.enumerable ||
    !('value' in service) ||
    typeof service.value !== 'string' ||
    service.value.length > 2048 ||
    !fee?.enumerable ||
    !('value' in fee) ||
    typeof fee.value !== 'string'
  )
    invalid();
  return Object.freeze({
    serviceUrl: normalizeSentryServiceUrl(service.value),
    maxFeeSatoshis: validateSentryFeeLimit(fee.value),
  });
}

export function readSentryServiceSettings(
  value: unknown,
  network: SentryNetwork
): SentryServiceSettings {
  if (!Object.hasOwn(SENTRY_NETWORKS, network)) invalid();
  if (value === undefined)
    return Object.freeze({
      serviceUrl: SENTRY_NETWORKS[network].defaultServiceUrl,
      maxFeeSatoshis: '100000',
    });
  return normalizeSentryServiceSettings(value);
}
