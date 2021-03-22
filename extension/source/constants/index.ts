export const STORE_PORT = 'STARGAZER';

export const DAG_NETWORK: {
  [networkId: string]: {
    id: string;
    label: string;
    beUrl: string;
    lbUrl: string;
  };
} = {
  main: {
    id: 'main',
    label: 'Main Constellation Network',
    beUrl: 'https://block-explorer.constellationnetwork.io',
    lbUrl: 'http://lb.constellationnetwork.io:9000',
  },
  ceres: {
    id: 'ceres',
    label: 'Ceres Test Network',
    beUrl: 'https://api-be.exchanges.constellationnetwork.io',
    lbUrl: 'http://lb.exchanges.constellationnetwork.io:9000',
  },
};

export const ASSET_PRICE_API = 'https://api.coingecko.com/api/v3/simple/price';
export const DAG_EXPLORER_SEARCH = 'https://www.dagexplorer.io/search?term=';

export const PRICE_DAG_ID = 'constellation-labs';
export const PRICE_BTC_ID = 'bitcoin';
export const PRICE_ETH_ID = 'ethereum';

export const DEFAULT_CURRENCY = {
  id: 'usd',
  symbol: '$',
  name: 'USD',
};
