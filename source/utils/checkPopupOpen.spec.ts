import { checkIfPopupIsOpen } from './checkPopupOpen';

describe('popup runtime origin detection', () => {
  const originalChrome = global.chrome;
  let contexts: any[];

  beforeEach(() => {
    contexts = [];
    global.chrome = {
      runtime: {
        id: 'manifest-id',
        getURL: (path: string) => `moz-extension://internal-uuid${path}`,
        getContexts: jest.fn((_filter, reply) => reply(contexts)),
      },
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    global.chrome = originalChrome;
  });

  it('accepts the Firefox popup host from the runtime URL, not its ID', async () => {
    contexts = [
      { contextType: 'POPUP', documentOrigin: 'moz-extension://internal-uuid' },
    ];
    await expect(checkIfPopupIsOpen()).resolves.toBe(true);
  });

  it('rejects unrelated opaque extension origins and non-popup pages', async () => {
    contexts = [
      { contextType: 'POPUP', documentOrigin: 'moz-extension://other-uuid' },
      {
        contextType: 'POPUP',
        documentOrigin: 'chrome-extension://internal-uuid',
      },
      {
        contextType: 'TAB',
        documentUrl: 'moz-extension://internal-uuid/app.html',
      },
    ];
    await expect(checkIfPopupIsOpen()).resolves.toBe(false);
  });

  it('continues detecting Chrome popups', async () => {
    chrome.runtime.getURL = (path) => `chrome-extension://manifest-id${path}`;
    contexts = [
      {
        contextType: 'POPUP',
        documentUrl: 'chrome-extension://manifest-id/app.html',
      },
    ];
    await expect(checkIfPopupIsOpen()).resolves.toBe(true);
  });
});
