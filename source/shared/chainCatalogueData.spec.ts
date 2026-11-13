import {
  getBundledEvmChainMetadata,
  parseEvmChainCatalogue,
  withBundledEvmChainSuggestions,
} from './chainCatalogueData';

const base = {
  name: 'Example Testnet',
  chainId: 12345,
  networkId: 987,
  nativeCurrency: { name: 'Example', symbol: 'EX', decimals: 18 },
};

it('bundles Gateway for explicit addition and pins its identity over conflicting remote rows', () => {
  const local = withBundledEvmChainSuggestions();
  expect(local).toEqual([
    expect.objectContaining({
      chainId: 57570,
      coingeckoId: 'syscoin',
      apiUrl: 'https://explorer-gw.syscoin.org/api',
      name: 'Syscoin Gateway',
      isTestnet: false,
      nativeCurrency: { name: 'Syscoin', symbol: 'SYS', decimals: 18 },
      rpc: [{ url: 'https://rpc-gw.syscoin.org' }],
      explorers: [
        { name: 'Syscoin Gateway', url: 'https://explorer-gw.syscoin.org' },
      ],
    }),
  ]);
  const remote = parseEvmChainCatalogue([
    { ...base, chainId: 57570, rpc: [{ url: 'https://wrong.invalid' }] },
    { ...base, rpc: [{ url: 'https://example.invalid' }] },
  ]);
  expect(withBundledEvmChainSuggestions(remote)).toEqual([local[0], remote[1]]);
  expect(withBundledEvmChainSuggestions()[0]).not.toBe(local[0]);
});

it('returns trusted native metadata only for the exact bundled chain and RPC', () => {
  expect(
    getBundledEvmChainMetadata(57570, 'https://rpc-gw.syscoin.org')
  ).toEqual({
    coingeckoId: 'syscoin',
    apiUrl: 'https://explorer-gw.syscoin.org/api',
  });
  expect(
    getBundledEvmChainMetadata(57570, 'https://other.invalid')
  ).toBeUndefined();
  expect(
    getBundledEvmChainMetadata(5757, 'https://rpc-gw.syscoin.org')
  ).toBeUndefined();
  expect(
    getBundledEvmChainMetadata(57570, 'https://rpc-gw.syscoin.org/?token=x')
  ).toBeUndefined();
});

it('projects shared ChainList metadata without carrying unknown fields into wallet UI', () => {
  const rows = parseEvmChainCatalogue([
    {
      ...base,
      chain: 'arbitrary',
      icon: 'example',
      shortName: 'ex',
      isTestnet: true,
      explorers: [{ name: 'ExampleScan', url: 'https://explorer.example' }],
      rpc: [
        {
          url: 'https://rpc.example',
          tracking: 'none',
          isOpenSource: true,
          trackingDetails: 'ignored',
        },
        null,
        { url: 'x'.repeat(2049) },
      ],
      other: 'ignored',
      coingeckoId: 'attacker-chosen',
      apiUrl: 'https://untrusted.invalid/api',
      coingeckoPlatformId: 'another-platform',
    },
    null,
    { ...base, chainId: '12345' },
    { ...base, name: 'Example\u202e' },
    { ...base, nativeCurrency: null },
  ]);

  expect(rows).toEqual([
    expect.objectContaining({
      ...base,
      chain: 'ethereum',
      icon: 'example',
      shortName: 'ex',
      isTestnet: true,
      explorers: [{ name: 'ExampleScan', url: 'https://explorer.example' }],
      rpc: [
        { url: 'https://rpc.example', tracking: 'none', isOpenSource: true },
      ],
    }),
  ]);
  expect(rows[0]).not.toHaveProperty('other');
  expect(rows[0]).not.toHaveProperty('coingeckoId');
  expect(rows[0]).not.toHaveProperty('coingeckoPlatformId');
  expect(rows[0]).not.toHaveProperty('apiUrl');
});

it('keeps chain metadata available for icons without any RPC and bounds remote rows', () => {
  const rpc = Array.from({ length: 257 }, () => ({
    url: 'https://rpc.example',
  }));
  expect(parseEvmChainCatalogue([{ ...base, rpc }])[0]!.rpc).toHaveLength(256);
  expect(parseEvmChainCatalogue([{ ...base, rpc: [] }])[0]!.rpc).toEqual([]);
  expect(() => parseEvmChainCatalogue(Array(8193).fill(null))).toThrow(
    'Invalid ChainList data'
  );
  expect(() => parseEvmChainCatalogue({})).toThrow('Invalid ChainList data');
});
