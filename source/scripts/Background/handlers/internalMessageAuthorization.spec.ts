import {
  isPrivilegedInternalMessage,
  isTrustedExtensionPageSender,
} from './internalMessageAuthorization';

const runtime = {
  getURL: (path = '') => `chrome-extension://pali-extension/${path}`,
  id: 'pali-extension',
} as Pick<typeof chrome.runtime, 'getURL' | 'id'>;

describe('internal message authorization', () => {
  it('trusts messages sent by an extension page', () => {
    expect(
      isTrustedExtensionPageSender(
        {
          id: runtime.id,
          url: runtime.getURL('external.html'),
        },
        runtime
      )
    ).toBe(true);
  });

  it('rejects content-script messages even though they share the extension id', () => {
    expect(
      isTrustedExtensionPageSender(
        {
          id: runtime.id,
          tab: { id: 1 } as chrome.tabs.Tab,
          url: 'https://malicious.example/',
        },
        runtime
      )
    ).toBe(false);
  });

  it('rejects extension-origin URLs from a different extension id', () => {
    expect(
      isTrustedExtensionPageSender(
        {
          id: 'different-extension',
          url: runtime.getURL('app.html'),
        },
        runtime
      )
    ).toBe(false);
  });

  it.each([
    'PALI_SLH_DSA_SETUP_PROGRESS',
    'changeNetwork',
    'getCurrentState',
    'lock_wallet',
    'startPolling',
  ])('marks %s as privileged', (type) => {
    expect(isPrivilegedInternalMessage(type)).toBe(true);
  });

  it('does not classify public provider requests as privileged', () => {
    expect(isPrivilegedInternalMessage('METHOD_REQUEST')).toBe(false);
  });
});
