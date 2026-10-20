/** @jest-environment jsdom */

export {};

let mockInitialReply: (response: { isInjected: boolean }) => void;
jest.mock('./backgroundMessaging', () => ({
  sendToBackground: jest.fn((message, callback) => {
    if (message.action === 'isInjected') mockInitialReply = callback;
  }),
}));
jest.mock('./inject/paliProviderEthereum', () => ({
  PaliInpageProviderEth: jest.fn().mockImplementation(() => ({
    wallet: 'pali-v2',
    request: jest.fn().mockResolvedValue('0x7a69'),
  })),
}));
jest.mock('./inject/shimWeb3', () => ({ shimWeb3: jest.fn() }));
jest.mock('./inject/utils', () => ({ announceProvider: jest.fn() }));

const page = window as any;
let receive: (...args: any[]) => unknown;
let emittedScripts: string[];

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  emittedScripts = [];
  for (const key of [
    '__paliContentScriptInitialized',
    '__paliWalletInjected',
    '__paliAnnouncementSetup',
    'paliProvider',
    'ethereum',
    'metamask',
    '_metamask_ethereum',
  ])
    delete page[key];
  window.history.replaceState(null, '', '/supported.html');
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  Object.assign(chrome.runtime, {
    id: 'fixture',
    getURL: (file: string) => `chrome-extension://fixture/${file}`,
    onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
  });
  jest.spyOn(console, 'log').mockImplementation();
  const insert = document.head.insertBefore.bind(document.head);
  jest
    .spyOn(document.head, 'insertBefore')
    .mockImplementation((node, sibling) => {
      const result = insert(node, sibling);
      const id = (node as HTMLScriptElement).id;
      if (id === 'inpage' || id === 'removeProperty') {
        emittedScripts.push(id);
        // Execute the actual entry sources: jsdom cannot load extension scripts.
        // Only the provider transport and browser delivery timing are synthetic.
        jest.isolateModules(() => {
          require(id === 'inpage'
            ? './inject/inpage'
            : './inject/handleWindowProperties');
        });
      }
      return result;
    });
  require('./index');
  receive = (chrome.runtime.onMessage.addListener as jest.Mock).mock
    .calls[0][0];
});

afterEach(() => {
  window.dispatchEvent(new Event('beforeunload'));
  jest.restoreAllMocks();
});

const notify = (enabled: boolean) => {
  const method = enabled ? 'pali_addProperty' : 'pali_removeProperty';
  receive(
    { id: method, data: { method, params: { type: method } } },
    {},
    jest.fn()
  );
};

it.each([true, false])(
  'applies ordinary initialization with enabled=%s',
  (enabled) => {
    mockInitialReply({ isInjected: enabled });
    expect(Boolean(page.ethereum)).toBe(enabled);
    expect(emittedScripts).toEqual([enabled ? 'inpage' : 'removeProperty']);
  }
);

it.each([true, false])(
  'applies enabled=%s notifications after initialization',
  (enabled) => {
    mockInitialReply({ isInjected: !enabled });
    notify(enabled);
    expect(Boolean(page.ethereum)).toBe(enabled);
    expect(emittedScripts).toEqual([
      enabled ? 'removeProperty' : 'inpage',
      enabled ? 'inpage' : 'removeProperty',
    ]);
  }
);

it.each([true, false])(
  'does not let an older initial reply undo an applied enabled=%s notification',
  (enabled) => {
    // The initial reply captured an older preference. Its transport callback
    // arrives after the separate live notification has already been applied.
    notify(enabled);
    expect(Boolean(page.ethereum)).toBe(enabled);
    mockInitialReply({ isInjected: !enabled });
    expect(Boolean(page.ethereum)).toBe(enabled);
    expect(emittedScripts).toEqual([enabled ? 'inpage' : 'removeProperty']);
  }
);

it.each([true, false])(
  'keeps a matching late enabled=%s reply from repeating injection',
  (enabled) => {
    notify(enabled);
    mockInitialReply({ isInjected: enabled });
    expect(Boolean(page.ethereum)).toBe(enabled);
    expect(emittedScripts).toEqual([enabled ? 'inpage' : 'removeProperty']);
  }
);

it.each([true, false])(
  'keeps applying subsequent notifications after retiring initialization (enabled=%s)',
  (enabled) => {
    notify(enabled);
    mockInitialReply({ isInjected: !enabled });
    notify(!enabled);
    expect(Boolean(page.ethereum)).toBe(!enabled);
    expect(emittedScripts).toEqual([
      enabled ? 'inpage' : 'removeProperty',
      enabled ? 'removeProperty' : 'inpage',
    ]);
  }
);

it('does not retire initialization for an unrelated notification', () => {
  receive(
    {
      id: 'pali_chainChanged',
      data: { method: 'pali_chainChanged', params: {} },
    },
    {},
    jest.fn()
  );
  mockInitialReply({ isInjected: true });
  expect(Boolean(page.ethereum)).toBe(true);
});

it.each(['/unsupported.pdf', '/unsupported.xml'])(
  'does not treat a rejected notification on %s as an applied preference',
  (pathname) => {
    window.history.replaceState(null, '', pathname);
    notify(true);
    expect(emittedScripts).toEqual([]);
    window.history.replaceState(null, '', '/supported.html');
    mockInitialReply({ isInjected: true });
    expect(Boolean(page.ethereum)).toBe(true);
  }
);

it('does not apply or retire initialization for a notification in an iframe', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(global, 'window')!;
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  try {
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: iframe.contentWindow,
    });
    notify(true);
    expect(emittedScripts).toEqual([]);
  } finally {
    Object.defineProperty(global, 'window', originalWindow);
    iframe.remove();
  }
  mockInitialReply({ isInjected: true });
  expect(Boolean(page.ethereum)).toBe(true);
});
