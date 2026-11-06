const methodRequestMock = jest.fn();
jest.mock('./requests', () => ({
  methodRequest: (...args: any[]) => methodRequestMock(...args),
  enable: jest.fn(),
  isUnlocked: jest.fn(),
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: {} }) },
}));

import { onMessage } from './index';
import { getMethodConfig } from './method-registry';
import { isUnlocked } from './requests';

describe('runtime provider request boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    methodRequestMock.mockResolvedValue(['account']);
    (chrome as any).tabs = {
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
      sendMessage: jest.fn(),
    };
  });

  it('uses complete origin identities and replies through the originating channel', async () => {
    const request = {
      id: 'request',
      type: 'METHOD_REQUEST',
      data: { method: 'eth_accounts' },
    };
    for (const origin of [
      'https://example.com',
      'http://example.com',
      'https://example.com:8443',
    ]) {
      const sender = {
        tab: { id: 1 },
        frameId: 2,
        url: `${origin}/page`,
        origin,
      } as chrome.runtime.MessageSender;
      await expect(onMessage(request, sender)).resolves.toEqual(['account']);
      expect(methodRequestMock).toHaveBeenLastCalledWith(
        origin,
        request.data,
        expect.objectContaining({ sender })
      );
    }
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it.each(['file:///tmp/site.html', 'about:blank', 'data:text/html,hello'])(
    'rejects opaque or local origin %s',
    async (url) => {
      await expect(
        onMessage(
          { type: 'METHOD_REQUEST', data: { method: 'eth_accounts' } },
          { url, tab: { id: 1 } } as any
        )
      ).resolves.toMatchObject({ error: { code: 4100 } });
      expect(methodRequestMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    undefined,
    'null',
    'https://example.com',
    'http://example.com:8443',
  ])(
    'rejects a provider request when the browser reports origin %s',
    async (origin) => {
      const sender = {
        url: 'https://example.com:8443/frame',
        origin,
        tab: { id: 1 },
        frameId: 2,
        documentId: 'requesting-frame',
      } as chrome.runtime.MessageSender;
      await expect(
        onMessage(
          { type: 'METHOD_REQUEST', data: { method: 'eth_accounts' } },
          sender
        )
      ).resolves.toMatchObject({ error: { code: 4100 } });
      expect(methodRequestMock).not.toHaveBeenCalled();
      expect(chrome.tabs.onRemoved.addListener).not.toHaveBeenCalled();
    }
  );

  it('preserves the public unlock query for an attested requesting tab only', async () => {
    jest.mocked(isUnlocked).mockReturnValue(true);
    const sender = {
      url: 'https://example.com/page',
      origin: 'https://example.com',
    };
    const request = { type: 'IS_UNLOCKED' };
    await expect(onMessage(request, sender)).resolves.toMatchObject({
      error: { code: 4100 },
    });
    expect(isUnlocked).not.toHaveBeenCalled();
    await expect(
      onMessage(request, {
        ...sender,
        tab: { id: 1 },
      } as chrome.runtime.MessageSender)
    ).resolves.toBe(true);
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'rejects inherited method key %s',
    (method) => {
      expect(getMethodConfig(method)).toBeUndefined();
    }
  );
});
