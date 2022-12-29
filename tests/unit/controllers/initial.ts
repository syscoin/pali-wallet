// todo: remove explorer from state
export const defaultNetworks = {
  syscoin: {
    57: {
      chainId: 57,
      label: 'Syscoin Mainnet',
      url: 'https://blockbook.elint.services/',
    },
    5700: {
      chainId: 5700,
      label: 'Syscoin Testnet',
      url: 'https://blockbook-dev.elint.services/',
    },
  },
  ethereum: {
    137: {
      chainId: 137,
      label: 'Polygon Mainnet',
      url: 'https://polygon-rpc.com',
    },
    80001: {
      chainId: 80001,
      label: 'Polygon Mumbai Testnet',
      url: 'https://rpc-mumbai.maticvigil.com',
    },
    57: {
      chainId: 57,
      label: 'Syscoin Mainnet',
      url: 'https://rpc.syscoin.org',
    },
    5700: {
      chainId: 5700,
      label: 'Syscoin Tanenbaum',
      url: 'https://rpc.tanenbaum.io',
    },
  },
};
