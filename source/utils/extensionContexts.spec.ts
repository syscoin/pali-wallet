import { hasExternalWalletPage } from './extensionContexts';
import { WALLET_BOOTSTRAP_TIMEOUT_MS } from './requestWalletState';

describe('live wallet window detection', () => {
  const originalChrome = global.chrome;
  let getContexts: jest.Mock;
  let tabsQuery: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    getContexts = jest.fn();
    tabsQuery = jest.fn();
    global.chrome = {
      runtime: { id: 'pali-id', getContexts },
      tabs: { query: tabsQuery },
    } as unknown as typeof chrome;
  });
  afterEach(() => {
    jest.useRealTimers();
    global.chrome = originalChrome;
  });

  it('ignores stale flags and the current main wallet page', async () => {
    getContexts.mockImplementation((_filter, reply) => {
      reply([{ documentUrl: 'chrome-extension://pali-id/app.html' }]);
    });
    await expect(hasExternalWalletPage()).resolves.toBe(false);
  });

  it('recognizes only this extension exact external page', async () => {
    getContexts.mockImplementationOnce((_filter, reply) => {
      reply([
        { documentUrl: 'https://example.com/external.html' },
        { documentUrl: 'chrome-extension://other-id/external.html' },
        { documentUrl: 'chrome-extension://pali-id/app.html?external.html' },
      ]);
    });
    await expect(hasExternalWalletPage()).resolves.toBe(false);
    getContexts.mockImplementationOnce((_filter, reply) => {
      reply([
        { documentUrl: 'chrome-extension://pali-id/external.html?route=sign' },
      ]);
    });
    await expect(hasExternalWalletPage()).resolves.toBe(true);
  });

  it('uses a bounded tabs fallback before Chrome 116', async () => {
    delete (chrome.runtime as any).getContexts;
    tabsQuery.mockImplementation((_filter, reply) => {
      reply([{ url: 'chrome-extension://pali-id/external.html' }]);
    });
    await expect(hasExternalWalletPage()).resolves.toBe(true);
    tabsQuery.mockImplementation(() => undefined);
    const pending = hasExternalWalletPage();
    const rejected = expect(pending).rejects.toThrow('timed out');
    jest.advanceTimersByTime(WALLET_BOOTSTRAP_TIMEOUT_MS);
    await rejected;
  });

  it('offers recovery instead of continuing when the query stalls', async () => {
    const pending = hasExternalWalletPage();
    const rejected = expect(pending).rejects.toThrow('timed out');
    jest.advanceTimersByTime(WALLET_BOOTSTRAP_TIMEOUT_MS);
    await rejected;
  });

  it('accepts a valid context reply after the feedback deadline', async () => {
    jest.advanceTimersByTime(2000);
    let reply: (contexts: unknown[]) => void;
    getContexts.mockImplementation((_filter, callback) => {
      reply = callback;
    });
    const pending = hasExternalWalletPage();
    jest.advanceTimersByTime(2000);
    reply([]);
    await expect(pending).resolves.toBe(false);
  });
});
