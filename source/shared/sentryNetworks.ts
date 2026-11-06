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

export type SentryNetwork = keyof typeof SENTRY_NETWORKS;

/** Only trusted wallet settings may choose a service origin. */
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
