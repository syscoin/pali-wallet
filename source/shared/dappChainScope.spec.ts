import {
  dappCaipChain,
  dappNamespace,
  normalizeDappModeRequest,
} from './dappChainScope';
it('projects the canonical CAIP family without replacing its full genesis authority', () => {
  expect(dappCaipChain({ kind: 'ethereum', chainId: 1 })).toBe('eip155:1');
  const genesisHash =
    '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
  expect(
    dappCaipChain({ kind: 'syscoin', chainId: 0, slip44: 0, genesisHash })
  ).toBe('bip122:000000000019d6689c085ae165831e93');
  expect(
    dappNamespace({ kind: 'syscoin', chainId: 0, slip44: 0, genesisHash })
  ).toBe('bip122');
  expect(() =>
    dappCaipChain({
      kind: 'syscoin',
      chainId: 0,
      slip44: 0,
      genesisHash: genesisHash.slice(0, 32),
    })
  ).toThrow();
});
it.each([
  ['sys_switchChain', 0, 'syscoin'],
  ['sys_changeUTXOEVM', '0x39', 'syscoin'],
  ['eth_changeUTXOEVM', '1', 'ethereum'],
])('normalizes the existing %s mode target', (method, chainId, kind) => {
  expect(normalizeDappModeRequest(method as string, [{ chainId }])).toEqual({
    method,
    kind,
    chainId: Number(chainId),
  });
});
it.each(['', -1, 1.1, 'no-chain', '0x20000000000000', null, undefined])(
  'refuses an invalid mode target %s',
  (chainId) => {
    expect(() =>
      normalizeDappModeRequest('sys_switchChain', [{ chainId }])
    ).toThrow();
  }
);
