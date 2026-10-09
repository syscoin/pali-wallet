import { isTrustedSigningWorkerSender } from './messageAuthorization';

const runtime = {
  id: 'pali',
  getURL: (path: string) => `chrome-extension://pali/${path}`,
};

describe('offscreen signing worker authorization', () => {
  it('accepts only the background worker URL from this extension', () => {
    expect(
      isTrustedSigningWorkerSender(
        { id: 'pali', url: runtime.getURL('js/background.bundle.js') },
        runtime
      )
    ).toBe(true);
    for (const sender of [
      { id: 'pali', url: 'https://malicious.example' },
      { id: 'pali', url: runtime.getURL('app.html') },
      { id: 'other', url: runtime.getURL('js/background.bundle.js') },
      {
        id: 'pali',
        url: runtime.getURL('js/background.bundle.js'),
        tab: { id: 1 } as chrome.tabs.Tab,
      },
      { id: 'pali' },
    ]) {
      expect(isTrustedSigningWorkerSender(sender, runtime)).toBe(false);
    }
  });
});
