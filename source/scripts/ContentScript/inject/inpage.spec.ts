/** @jest-environment jsdom */

jest.mock('uuid', () => ({ v4: () => 'fixture-provider-uuid' }));
jest.mock('./shimWeb3', () => ({ shimWeb3: jest.fn() }));
jest.mock('./utils', () => ({ announceProvider: jest.fn() }));
jest.mock('./paliProviderEthereum', () => ({
  PaliInpageProviderEth: jest.fn().mockImplementation(() => ({
    wallet: 'pali-v2',
    request: jest.fn().mockResolvedValue('0x7a69'),
  })),
}));

const page = window as any;
const inject = () => {
  jest.isolateModules(() => require('./inpage'));
};

beforeEach(() => {
  jest.clearAllMocks();
  delete page.ethereum;
  delete page.paliProvider;
  delete page.__paliWalletInjected;
  delete page.__paliAnnouncementSetup;
  delete page.metamask;
  delete page._metamask_ethereum;
});

it('installs the same provider for first-use fallback and announcements', () => {
  inject();
  expect(page.ethereum).toBe(page.paliProvider.proxiedProvider);
  expect(page.paliProvider.uuid).toBe('fixture-provider-uuid');
});

it('restores the existing fallback after normal Ethereum removal and reinjection', async () => {
  inject();
  const provider = page.ethereum;
  const uuid = page.paliProvider.uuid;
  jest.isolateModules(() => require('./handleWindowProperties'));
  expect(page.ethereum).toBeUndefined();

  inject();

  expect(page.ethereum).toBe(provider);
  expect(page.ethereum).toBe(page.paliProvider.proxiedProvider);
  expect(page.paliProvider.uuid).toBe(uuid);
  await expect(page.ethereum.request({ method: 'eth_chainId' })).resolves.toBe(
    '0x7a69'
  );
});

it('does not overwrite another wallet fallback on reinjection', () => {
  inject();
  const provider = page.paliProvider.proxiedProvider;
  const other = { request: jest.fn(), isMetaMask: true };
  page.ethereum = other;

  inject();

  expect(page.ethereum).toBe(other);
  expect(page.paliProvider.proxiedProvider).toBe(provider);
});

it('does not synthesize a provider when the previous injection is unavailable', () => {
  page.__paliWalletInjected = true;

  inject();

  expect(page.ethereum).toBeUndefined();
  expect(page.paliProvider).toBeUndefined();
});
