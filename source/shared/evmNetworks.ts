/** Pure built-in EVM registrations shared by extension and native hosts.
 * No browser state, SDK imports, transport or signing authority lives here. */
// Chain identifiers shared with native registrations.
export const CHAIN_IDS = {
  SYSCOIN_MAINNET: 57,
  SYSCOIN_TESTNET: 5700,
  BASE_MAINNET: 8453,
  ARBITRUM_ONE: 42161,
  SYSCOIN_NEVM_TESTNET: 5700,
  ZKSYS_TANENBAUM_TESTNET: 57057,
  ROLLUX_MAINNET: 570,
  ROLLUX_TESTNET: 57000,
  ETHEREUM_MAINNET: 1,
} as const;

const definitions = [
  {
    id: 'syscoin-nevm',
    name: 'Syscoin NEVM',
    color: '#42B6E8',
    testnet: false,
    network: {
      chainId: CHAIN_IDS.SYSCOIN_MAINNET,
      url: 'https://rpc.syscoin.org',
      label: 'Syscoin NEVM',
      default: true,
      currency: 'sys',
      kind: 'ethereum',
      slip44: 60,
      apiUrl: 'https://explorer.syscoin.org/api',
      explorer: 'https://explorer.syscoin.org',
      coingeckoId: 'syscoin',
      coingeckoPlatformId: 'syscoin-nevm',
    },
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    color: '#8B9EEC',
    testnet: false,
    network: {
      chainId: CHAIN_IDS.ETHEREUM_MAINNET,
      url: 'https://ethereum-rpc.publicnode.com',
      label: 'Ethereum Mainnet',
      default: true,
      currency: 'eth',
      kind: 'ethereum',
      slip44: 60,
      explorer: 'https://etherscan.io',
      apiUrl: 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api',
      coingeckoId: 'ethereum',
      coingeckoPlatformId: 'ethereum',
    },
  },
  {
    id: 'base',
    name: 'Base',
    color: '#477CFF',
    testnet: false,
    network: {
      chainId: CHAIN_IDS.BASE_MAINNET,
      currency: 'eth',
      default: true,
      label: 'Base',
      url: 'https://mainnet.base.org',
      explorer: 'https://basescan.org',
      kind: 'ethereum',
      slip44: 60,
      coingeckoId: 'ethereum',
      coingeckoPlatformId: 'base',
    },
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum One',
    color: '#7EC7F0',
    testnet: false,
    network: {
      chainId: CHAIN_IDS.ARBITRUM_ONE,
      currency: 'eth',
      default: true,
      label: 'Arbitrum One',
      url: 'https://arb1.arbitrum.io/rpc',
      explorer: 'https://arbiscan.io',
      kind: 'ethereum',
      slip44: 60,
      coingeckoId: 'ethereum',
      coingeckoPlatformId: 'arbitrum-one',
    },
  },
  {
    id: 'rollux',
    name: 'Rollux',
    color: '#E7B95C',
    testnet: false,
    network: {
      chainId: CHAIN_IDS.ROLLUX_MAINNET,
      currency: 'sys',
      default: true,
      label: 'Rollux',
      url: 'https://rpc.rollux.com',
      apiUrl: 'https://explorer.rollux.com/api',
      explorer: 'https://explorer.rollux.com',
      kind: 'ethereum',
      slip44: 60,
      coingeckoId: 'syscoin',
      coingeckoPlatformId: 'rollux',
    },
  },
  {
    id: 'syscoin-nevm-testnet',
    name: 'Syscoin NEVM Testnet',
    color: '#42B6E8',
    testnet: true,
    network: {
      chainId: CHAIN_IDS.SYSCOIN_NEVM_TESTNET,
      url: 'https://rpc.tanenbaum.io',
      label: 'Syscoin NEVM Testnet',
      default: false,
      currency: 'tsys',
      kind: 'ethereum',
      slip44: 60,
      apiUrl: 'https://explorer.tanenbaum.io/api',
      explorer: 'https://explorer.tanenbaum.io/',
      coingeckoId: 'syscoin',
    },
  },
  {
    id: 'zksys-testnet',
    name: 'zkTanenbaum Testnet',
    color: '#42B6E8',
    testnet: true,
    network: {
      chainId: CHAIN_IDS.ZKSYS_TANENBAUM_TESTNET,
      url: 'https://rpc-zk.tanenbaum.io',
      label: 'zkTanenbaum',
      default: true,
      currency: 'tsys',
      kind: 'ethereum',
      slip44: 60,
      apiUrl: 'https://explorer-zk.tanenbaum.io/api',
      explorer: 'https://explorer-zk.tanenbaum.io',
      coingeckoId: 'syscoin',
    },
  },
] as const;
export type EvmNetworkId = (typeof definitions)[number]['id'];
export type EvmNetworkDefinition = Readonly<{
  color: string;
  id: EvmNetworkId;
  name: string;
  network: Readonly<{
    apiUrl?: string;
    chainId: number;
    coingeckoId: string;
    coingeckoPlatformId?: string;
    currency: string;
    default: boolean;
    explorer: string;
    kind: 'ethereum';
    label: string;
    slip44: 60;
    url: string;
  }>;
  testnet: boolean;
}>;
export const EVM_NETWORK_DEFINITIONS: readonly EvmNetworkDefinition[] =
  Object.freeze(
    definitions.map((definition) =>
      Object.freeze({
        ...definition,
        network: Object.freeze({ ...definition.network }),
      })
    )
  );

/** Public explorer data belongs to the exact registered RPC context. */
export function findRegisteredEvmNetwork({
  id,
  rpcUrl,
  chainId,
}: {
  chainId: string;
  id: string;
  rpcUrl: string;
}): EvmNetworkDefinition | undefined {
  return EVM_NETWORK_DEFINITIONS.find(
    (item) =>
      item.id === id &&
      item.network.url === rpcUrl &&
      String(item.network.chainId) === chainId
  );
}

/** Extension callers retain their existing mutable registration object shape. */
export function createExtensionEvmNetworks() {
  return Object.fromEntries(
    EVM_NETWORK_DEFINITIONS.map(({ network }) => [
      network.chainId,
      { ...network },
    ])
  );
}
