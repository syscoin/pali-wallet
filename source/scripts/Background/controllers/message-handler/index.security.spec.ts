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

  it.each([
    'eth_getLogs',
    'eth_getProof',
    'web3_clientVersion',
    'net_listening',
    'net_peerCount',
    'personal_ecRecover',
  ])(
    'attaches a real document lifetime to nonpopup public %s before method admission',
    async (method) => {
      let received:
        | { sender: chrome.runtime.MessageSender; signal: AbortSignal }
        | undefined;
      let release!: (value: unknown) => void;
      methodRequestMock.mockImplementationOnce((_host, _data, context) => {
        received = context;
        return new Promise((resolve) => {
          release = resolve;
        });
      });
      const sender: chrome.runtime.MessageSender = {
        tab: {
          id: 17,
          index: 0,
          pinned: false,
          highlighted: true,
          windowId: 1,
          active: true,
          incognito: false,
          selected: true,
          discarded: false,
          autoDiscardable: true,
          groupId: -1,
        },
        url: 'https://example.com/page',
        origin: 'https://example.com',
        documentId: 'public-read-document',
      };
      const config = getMethodConfig(method)!;
      expect(config.hasPopup).toBe(false);
      expect(config.requiresConnection).toBe(false);
      const reply = onMessage(
        { type: 'METHOD_REQUEST', data: { method, params: [] } },
        sender
      );
      expect(received?.sender).toBe(sender);
      expect(received?.signal).toBeInstanceOf(AbortSignal);
      expect(received?.signal.aborted).toBe(false);
      const onUpdated = jest.mocked(chrome.tabs.onUpdated.addListener).mock
        .calls[0]![0]!;
      onUpdated(17, { status: 'loading' }, {} as chrome.tabs.Tab);
      expect(received?.signal.aborted).toBe(true);
      release(null);
      await reply;
      expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalledWith(
        onUpdated
      );
    }
  );

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
