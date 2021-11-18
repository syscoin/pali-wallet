export const sys = require('syscoinjs-lib');

export const STORE_PORT = 'SYSCOIN';

export const SYS_NETWORK: {
  [networkId: string]: {
    beUrl: string,
    id: string,
    label: string,
  },
} = {
  main: {
    id: 'main',
    label: 'Main Network',
    beUrl: 'https://blockbook.elint.services/',
  },
  testnet: {
    id: 'testnet',
    label: 'Test Network',
    beUrl: 'https://blockbook-dev.elint.services/',
  },
};

export const ASSET_PRICE_API =
  'https://blockbook.elint.services/api/v2/tickers/';
export const SYS_EXPLORER_SEARCH = 'https://blockbook-dev.elint.services/';

export const PRICE_SYS_ID = 'syscoin';
export const PRICE_BTC_ID = 'bitcoin';
export const PRICE_ETH_ID = 'ethereum';

export const DEFAULT_CURRENCY = {
  id: 'usd',
  symbol: '$',
  name: 'USD',
};

export function changeBackgroundLinear(e: any) {
  if(e.target.tagName == 'BUTTON') {
    e.target.style.background = 'linear-gradient(to right top, #ff3e91, #da53b2, #ab66c3, #7971c5, #4d76b8)';
  }
}
export function changeBackground(e: any) {
  if(e.target.tagName == 'BUTTON') {
    e.target.style.background = '#122036';
  }
}