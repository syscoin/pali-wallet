import { normalizeDappWalletControl } from './dappWalletControl';

it.each(['0x1', '0x0a', '0xA'])(
  'normalizes a safe hexadecimal chain identity %s',
  (chainId) => {
    const result = normalizeDappWalletControl('wallet_switchEthereumChain', [
      { chainId },
    ]);
    expect(result.chainId).toBe(Number(chainId));
    expect(Object.isFrozen(result)).toBe(true);
  }
);
it.each(['', '1', '0x', '0x0', '0x20000000000000', 1])(
  'rejects invalid chain identity %s before a provider observes it',
  (chainId) => {
    expect(() =>
      normalizeDappWalletControl('wallet_switchEthereumChain', [{ chainId }])
    ).toThrow();
  }
);
it('keeps every proposed RPC in a detached snapshot without treating it as chain evidence', () => {
  const request = {
    chainId: '0xa',
    chainName: 'Claimed chain',
    rpcUrls: ['https://rpc.invalid', 'http://localhost:1234'],
    nativeCurrency: { name: 'Claimed currency', symbol: 'COIN', decimals: 18 },
  };
  const result = normalizeDappWalletControl('wallet_addEthereumChain', [
    request,
  ]);
  request.rpcUrls[0] = 'https://replacement.invalid';
  request.nativeCurrency.symbol = 'OTHER';
  expect(result.rpcUrls[0]).toBe('https://rpc.invalid');
  expect(result.nativeCurrency?.symbol).toBe('COIN');
});
it.each(
  [[], ['javascript:alert(1)'], ['data:text/plain,x'], ['invalid']].map(
    (rpcUrls) => ({ rpcUrls })
  )
)('rejects malformed RPC proposal $rpcUrls', ({ rpcUrls }) => {
  expect(() =>
    normalizeDappWalletControl('wallet_addEthereumChain', [
      { chainId: '0x1', rpcUrls },
    ])
  ).toThrow();
});
it('retains ERC721 collection identity without inventing a token ID or trusting an image', () => {
  expect(
    normalizeDappWalletControl('wallet_watchAsset', {
      type: 'ERC721',
      options: { address: `0x${'ab'.repeat(20)}`, image: 'javascript:bad' },
    })
  ).toEqual({
    method: 'wallet_watchAsset',
    type: 'ERC721',
    address: `0x${'ab'.repeat(20)}`,
  });
});
it('normalizes ERC1155 identifiers without numeric rounding', () => {
  const result = normalizeDappWalletControl('wallet_watchAsset', [
    {
      type: 'ERC1155',
      options: {
        address: `0x${'ab'.repeat(20)}`,
        tokenId: '0xffffffffffffffff',
      },
    },
  ]);
  expect(result.tokenId).toBe('18446744073709551615');
});
it.each([undefined, -1, Number.MAX_SAFE_INTEGER + 1, 'bad'])(
  'rejects ambiguous ERC1155 identifiers %s',
  (tokenId) => {
    expect(() =>
      normalizeDappWalletControl('wallet_watchAsset', [
        {
          type: 'ERC1155',
          options: { address: `0x${'ab'.repeat(20)}`, tokenId },
        },
      ])
    ).toThrow();
  }
);
