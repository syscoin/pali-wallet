import { buildExplorerUrl } from './strings';

it.each([
  ['https://explorer.invalid', 'https://explorer.invalid/tx/'],
  ['https://explorer.invalid/', 'https://explorer.invalid/tx/'],
  ['https://explorer.invalid/prefix', 'https://explorer.invalid/prefix/tx/'],
  ['https://explorer.invalid/prefix/', 'https://explorer.invalid/prefix/tx/'],
])('appends a resource to %s', (base, expected) => {
  expect(buildExplorerUrl(base, 'tx', '0x123')).toBe(expected + '0x123');
});

it('preserves encoded base paths, queries and ordinary fragments', () => {
  expect(
    buildExplorerUrl(
      'https://explorer.invalid/public%20chain/?view=a%2Fb#overview',
      'address',
      '0x123'
    )
  ).toBe(
    'https://explorer.invalid/public%20chain/address/0x123?view=a%2Fb#overview'
  );
});

it('appends inside a hash route without mixing inner and outer queries', () => {
  expect(
    buildExplorerUrl(
      'https://explorer.invalid/base?outer=a%2Fb#/public/?inner=x%2Fy#section',
      'token',
      '0x123'
    )
  ).toBe(
    'https://explorer.invalid/base?outer=a%2Fb#/public/token/0x123?inner=x%2Fy#section'
  );
});

it.each(['address', 'tx', 'token', 'asset', 'xpub'])(
  'encodes the raw %s identifier as one path segment',
  (resource) => {
    expect(
      buildExplorerUrl('https://explorer.invalid/', resource, 'a/b?c#d %2F')
    ).toBe(`https://explorer.invalid/${resource}/a%2Fb%3Fc%23d%20%252F`);
  }
);

const previousDetailsUrl = (
  explorer: string,
  resource: string,
  identifier: string
) => {
  const url = new URL(explorer);
  const route = url.hash.startsWith('#/')
    ? new URL(url.hash.slice(1), url)
    : url;
  route.pathname = `${route.pathname.replace(
    /\/?$/,
    '/'
  )}${resource}/${identifier}`;
  if (route !== url) url.hash = route.pathname + route.search + route.hash;
  return url.href;
};

describe.each([
  'https://explorer.invalid/',
  'https://explorer.invalid/public/',
  'https://explorer.invalid/public/?view=a%2Fb',
  'https://explorer.invalid/app?outer=1#/public/?inner=2',
])('preserves the previous Details URL for %s', (base) => {
  it.each([
    ['EVM transaction', 'tx', '0x' + 'ab'.repeat(32)],
    ['UTXO transaction', 'tx', 'ab'.repeat(32)],
    ['EVM contract', 'address', '0x' + 'ab'.repeat(20)],
    ['UTXO asset', 'asset', '123456789'],
  ])('keeps the %s identifier bytes', (_, resource, identifier) => {
    expect(buildExplorerUrl(base, resource, identifier)).toBe(
      previousDetailsUrl(base, resource, identifier)
    );
  });
});
