/** @jest-environment jsdom */

export {};

let mockUuid = 0;
jest.mock('uuid', () => ({ v4: () => `provider-${++mockUuid}` }));
jest.mock('./shimWeb3', () => ({ shimWeb3: jest.fn() }));
jest.mock('./utils', () => ({ announceProvider: jest.fn() }));
jest.mock('./paliProviderEthereum', () => ({
  PaliInpageProviderEth: jest.fn().mockImplementation(() => ({
    wallet:
      process.env.PALI_EXTENSION_CHANNEL === 'canary'
        ? 'pali-canary:pali-v2'
        : 'pali-v2',
    request: jest.fn(),
  })),
}));
jest.mock('./paliProviderSyscoin', () => ({
  PaliInpageProviderSys: jest.fn().mockImplementation(() => ({
    channel: process.env.PALI_EXTENSION_CHANNEL,
  })),
}));
const page = window as any;
const original = process.env.PALI_EXTENSION_CHANNEL;
const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];

beforeEach(() => {
  jest.resetModules();
  const add = window.addEventListener.bind(window);
  jest
    .spyOn(window, 'addEventListener')
    .mockImplementation((type, listener, options) => {
      if (listener) listeners.push([type, listener]);
      add(type, listener, options);
    });
  for (const key of Object.keys(page))
    if (
      key.startsWith('pali-canary:') ||
      [
        'paliProvider',
        '__paliWalletInjected',
        '__paliAnnouncementSetup',
        'ethereum',
        'pali',
        'paliCanary',
        'metamask',
        '_metamask_ethereum',
      ].includes(key)
    )
      delete page[key];
});
afterEach(() => {
  for (const [type, listener] of listeners.splice(0))
    window.removeEventListener(type, listener);
  jest.restoreAllMocks();
  if (original === undefined) delete process.env.PALI_EXTENSION_CHANNEL;
  else process.env.PALI_EXTENSION_CHANNEL = original;
});
function load(channel: 'stable' | 'canary', module = './inpage') {
  process.env.PALI_EXTENSION_CHANNEL = channel;
  jest.isolateModules(() => require(module));
}

it.each([
  ['stable', 'canary'],
  ['canary', 'stable'],
] as const)(
  'keeps both providers after %s then %s injection',
  (first, second) => {
    load(first);
    const fallback = page.ethereum;
    load(second);
    expect(page.ethereum).toBe(fallback);
    expect(page.paliProvider.proxiedProvider).not.toBe(
      page['pali-canary:paliProvider'].proxiedProvider
    );
    expect(page.paliProvider.uuid).not.toBe(
      page['pali-canary:paliProvider'].uuid
    );
    const states = [page.paliProvider, page['pali-canary:paliProvider']];
    load('stable');
    load('canary');
    expect(page.paliProvider).toBe(states[0]);
    expect(page['pali-canary:paliProvider']).toBe(states[1]);
    load(second, './handleWindowProperties');
    expect(page.ethereum).toBe(fallback);
    load(first, './handleWindowProperties');
    expect(page.ethereum).toBeUndefined();
  }
);

it.each([
  ['stable', 'canary'],
  ['canary', 'stable'],
] as const)(
  'keeps the stable Syscoin API and explicit Canary API (%s first)',
  (first, second) => {
    load(first, './pali');
    load(second, './pali');
    expect(page.pali.channel).toBe('stable');
    expect(page.paliCanary.channel).toBe('canary');
    expect(page.pali).not.toBe(page.paliCanary);
  }
);

it('provides the legacy Syscoin convenience API with Canary alone', () => {
  load('canary', './pali');
  expect(page.pali).toBe(page.paliCanary);
});
