import { INetworkType } from '../types/network';

import {
  orderChainRpcs,
  rankChainSuggestions,
  type ChainInfo,
} from './chainCatalogue';

function chain(
  chainId: number,
  name: string,
  symbol: string,
  overrides?: Partial<ChainInfo>
): ChainInfo {
  return {
    chain: INetworkType.Ethereum,
    chainId,
    name,
    nativeCurrency: { decimals: 18, name: symbol, symbol },
    networkId: chainId,
    rpc: [{ url: 'https://rpc.example' }],
    ...overrides,
  };
}

it('ranks cumulative text and UTXO alias matches and omits networks without an RPC', () => {
  const exactSymbol = chain(1, 'First chain', 'SYS');
  const exactName = chain(2, 'Sys', 'NATIVE');
  const cumulative = chain(57, 'Syscoin', 'SYS', {
    chain: INetworkType.Syscoin,
    coinLabel: 'Syscoin',
    coinShortcut: 'SYS',
  });
  const nameContains = chain(3, 'A Sys chain', 'NATIVE');
  const shortcutContains = chain(4, 'Another chain', 'NATIVE', {
    coinShortcut: 'XSYS',
  });
  const noEndpoint = chain(5, 'Sys', 'SYS', { rpc: [] });

  expect(
    rankChainSuggestions(
      [
        exactSymbol,
        exactName,
        cumulative,
        nameContains,
        shortcutContains,
        noEndpoint,
      ],
      '  sYs  '
    ).map(({ chainId }) => chainId)
  ).toEqual([57, 2, 1, 3]);
});

it('keeps exact numeric IDs above prefixes and retains the first six stable matches', () => {
  const prefixMatches = Array.from({ length: 8 }, (_, index) =>
    chain(5700 + index, 'Chain', 'NATIVE')
  );
  const catalogue = [
    ...prefixMatches,
    chain(157, 'Other chain', 'NATIVE'),
    chain(57, 'Exact chain', 'NATIVE'),
  ];
  const matchedIds = (query: string) =>
    rankChainSuggestions(catalogue, query).map(({ chainId }) => chainId);

  expect(matchedIds('57')).toEqual([57, 5700, 5701, 5702, 5703, 5704]);
  expect(matchedIds(' 57 ')).toEqual([]);
  expect(matchedIds('5')).toEqual([]);
  expect(rankChainSuggestions([chain(1, 'İstanbul', 'IST')], 'İ')).toEqual([]);
  expect(catalogue.slice(0, 8)).toEqual(prefixMatches);
});

it('orders RPCs by tracking and open-source preference without changing input order', () => {
  const other = { url: 'https://other.example' };
  const open = { url: 'https://open.example', isOpenSource: true };
  const noTracking = { url: 'https://private.example', tracking: 'none' };
  const first = {
    url: 'https://first.example',
    tracking: 'none',
    isOpenSource: true,
  };
  const second = { ...first, url: 'https://second.example' };
  const rpcs = Object.freeze([other, first, open, second, noTracking]);

  expect(orderChainRpcs(rpcs)).toEqual([
    first,
    second,
    noTracking,
    open,
    other,
  ]);
  expect(rpcs).toEqual([other, first, open, second, noTracking]);
});
