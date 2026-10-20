const mockFetchList = jest.fn<Promise<any>, [string]>();
jest.mock('axios', () => ({
  __esModule: true,
  default: { create: () => ({ get: mockFetchList }) },
}));

import { blacklistService } from './blacklistService';

beforeAll(async () => {
  mockFetchList.mockImplementation(async (url) => {
    if (url.endsWith('urls-darklist.json')) {
      return {
        data: [
          { id: 'HTTPS://MEW-LISTED.synthetic.invalid.:8443/path?x=1#part' },
          { id: 'listed.synthetic.invalid' },
          { id: 'https://bücher.synthetic.invalid:8443/path' },
          { id: '' },
          { id: null },
          { id: 42 },
          null,
        ],
      };
    }
    if (url.endsWith('config.json')) {
      return {
        data: {
          blacklist: [
            'https://meta-listed.synthetic.invalid:9443/entry',
            'ftp://bad-scheme.synthetic.invalid',
            {},
            null,
          ],
          whitelist: [
            'HTTPS://ALLOWED.LISTED.synthetic.invalid.:9443/safe',
            'https://user:pass@listed.synthetic.invalid',
            'https://',
            null,
          ],
          fuzzylist: ['safewallet.synthetic.invalid', {}, null],
        },
      };
    }
    if (url.endsWith('domains.json')) {
      return {
        data: [
          'sniffer-listed.synthetic.invalid.:8443',
          'not a hostname',
          null,
        ],
      };
    }
    return { data: [] };
  });
  await blacklistService.initialize();
  expect(mockFetchList).toHaveBeenCalledTimes(5);
});

it.each([
  'https://mew-listed.synthetic.invalid',
  'http://mew-listed.synthetic.invalid:8080/path',
  'https://www.MEW-LISTED.synthetic.invalid.:8443/',
  'mew-listed.synthetic.invalid:8443',
  'https://sub.mew-listed.synthetic.invalid:8443',
  'https://meta-listed.synthetic.invalid.',
  'https://sniffer-listed.synthetic.invalid:9443',
  'https://bücher.synthetic.invalid.',
  'https://xn--bcher-kva.synthetic.invalid:8443',
  'https://metmask.com',
  'https://metmask.com.:8443',
])('matches the canonical listed domain in %s', async (url) => {
  await expect(blacklistService.checkUrl(url)).resolves.toMatchObject({
    isBlacklisted: true,
  });
});

it.each([
  'https://mew-listed.synthetic.invalid.attacker.invalid:8443',
  'https://notmew-listed.synthetic.invalid:8443',
  'https://ordinary.synthetic.invalid:8443',
  'http://ordinary.synthetic.invalid:8080',
  'https://127.0.0.1:8443',
  'http://[::1]:8080',
])('does not broaden the domain match to %s', async (url) => {
  await expect(blacklistService.checkUrl(url)).resolves.toEqual({
    isBlacklisted: false,
    severity: 'low',
  });
});

it.each([
  'https://allowed.listed.synthetic.invalid',
  'https://allowed.listed.synthetic.invalid.:8443/path',
])('preserves exact whitelist precedence for %s', async (url) => {
  await expect(blacklistService.checkUrl(url)).resolves.toEqual({
    isBlacklisted: false,
    severity: 'low',
  });
});

it('does not inherit a whitelist entry into its subdomains', async () => {
  await expect(
    blacklistService.checkUrl(
      'https://child.allowed.listed.synthetic.invalid:8443'
    )
  ).resolves.toMatchObject({ isBlacklisted: true, severity: 'high' });
});

it('preserves fuzzy matching after hostname normalization', async () => {
  await expect(
    blacklistService.checkUrl('https://safewallet.synthetic.invalid:8443')
  ).resolves.toMatchObject({ isBlacklisted: false });
  await expect(
    blacklistService.checkUrl('https://safewa1let.synthetic.invalid.:8443')
  ).resolves.toMatchObject({ isBlacklisted: true });
});

it.each([
  '',
  ' ',
  'not a hostname',
  'https://',
  'ftp://listed.synthetic.invalid',
  'javascript:alert(1)',
  'https://user:pass@listed.synthetic.invalid',
  null,
  undefined,
  {},
  42,
])(
  'handles malformed input %j without treating it as a domain',
  async (url) => {
    await expect(blacklistService.checkUrl(url as string)).resolves.toEqual({
      isBlacklisted: false,
      severity: 'low',
    });
  }
);

it('ignores malformed feed entries without skipping later sources or widening whitelist', async () => {
  await expect(
    blacklistService.checkUrl('https://listed.synthetic.invalid')
  ).resolves.toMatchObject({ isBlacklisted: true });
  await expect(
    blacklistService.checkUrl('https://sniffer-listed.synthetic.invalid')
  ).resolves.toMatchObject({ isBlacklisted: true });
  expect(blacklistService.getStatus().urlCount).toBeGreaterThan(9);
});
