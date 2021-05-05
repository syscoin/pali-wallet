export const sys = require('syscoinjs-lib');
export const STORE_PORT = 'SYSCOIN';
export const backendURl = 'https://blockbook.elint.services/';
export const SYS_NETWORK: {
  [networkId: string]: {
    id: string;
    label: string;
    beUrl: string;
    lbUrl: string;
  };
} = {
  main: {
    id: 'main',
    label: 'Main Network',
    beUrl: 'https://block-explorer.constellationnetwork.io',
    lbUrl: 'http://lb.constellationnetwork.io:9000',
  },
  ceres: {
    id: 'ceres',
    label: 'Test Network',
    beUrl: 'https://api-be.exchanges.constellationnetwork.io',
    lbUrl: 'http://lb.exchanges.constellationnetwork.io:9000',
  },
  testnet: {
    id: 'testnet',
    label: 'TestNet',
    beUrl: 'https://blockbook-dev.elint.services/',
    lbUrl: 'nao tem :('
  }
};

export const ASSET_PRICE_API = 'https://blockbook-dev.elint.services/api/v2/tickers/';
export const SYS_EXPLORER_SEARCH = 'https://blockbook-dev.elint.services/'; // ok

export const PRICE_SYS_ID = 'syscoin';
export const PRICE_BTC_ID = 'bitcoin';
export const PRICE_ETH_ID = 'ethereum';

export const DEFAULT_CURRENCY = {
  id: 'usd',
  symbol: '$',
  name: 'USD',
};
