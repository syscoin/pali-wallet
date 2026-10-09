const createPopupMock = jest.fn();
jest.mock('scripts/Background', () => ({
  getController: () => ({ createPopup: createPopupMock }),
}));

import { popupPromise } from './popup-promise';
import { MethodRoute } from './types';

describe('approval popup boundary', () => {
  let messageListener: (event: any) => void;
  const getURL = (path: string) => `chrome-extension://pali/${path}`;

  beforeEach(() => {
    jest.clearAllMocks();
    createPopupMock.mockResolvedValue({ id: 9 });
    (crypto as any).randomUUID = jest.fn(() => 'random-approval-id');
    (chrome.runtime as any).getURL = getURL;
    (chrome.runtime as any).id = 'pali';
    (chrome.runtime as any).getContexts = jest.fn((_query, callback) =>
      callback([])
    );
    (chrome.storage.local.get as jest.Mock).mockImplementation(
      (_keys, callback) => callback({})
    );
    (chrome.storage.local.set as jest.Mock).mockImplementation(
      (_data, callback) => callback?.()
    );
    (chrome.storage.local.remove as jest.Mock).mockImplementation(
      (_keys, callback) => callback?.()
    );
    (chrome as any).windows = {
      remove: jest.fn((_id, callback) => callback()),
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
    };
    (self as any).addEventListener = jest.fn((_type, listener) => {
      messageListener = listener;
    });
    (self as any).removeEventListener = jest.fn();
  });

  afterEach(() => jest.useRealTimers());

  const begin = async (
    signal?: AbortSignal,
    sender?: chrome.runtime.MessageSender
  ) => {
    const pending = popupPromise({
      host: 'https://site.test',
      eventName: 'personal_sign',
      route: MethodRoute.EthSign,
      data: { message: '#keep #all-hashes' },
      signal,
      sender,
    });
    await new Promise(setImmediate);
    return { pending };
  };

  it('allows a dapp approval while an ordinary main wallet tab is open', async () => {
    (chrome.runtime.getContexts as jest.Mock).mockImplementation(
      (_filter, reply) =>
        reply([
          {
            contextType: 'TAB',
            documentOrigin: 'chrome-extension://pali',
            documentUrl: getURL('app.html'),
          },
        ])
    );
    const abort = new AbortController();
    const { pending } = await begin(abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    expect(createPopupMock).toHaveBeenCalledTimes(1);
    abort.abort();
    await rejected;
  });

  it('does not open a second approval when another external wallet view is active', async () => {
    (chrome.runtime.getContexts as jest.Mock).mockImplementation(
      (_filter, reply) =>
        reply([
          {
            contextType: 'TAB',
            documentUrl: `${getURL('external.html')}?route=hardware`,
          },
        ])
    );
    await expect(
      popupPromise({
        host: 'https://site.test',
        eventName: 'personal_sign',
        route: MethodRoute.EthSign,
      })
    ).rejects.toMatchObject({ code: 4100 });
    expect(createPopupMock).not.toHaveBeenCalled();
  });

  it('fails closed within two seconds when window detection stalls', async () => {
    jest.useFakeTimers();
    const log = jest.spyOn(console, 'error').mockImplementation();
    (chrome.runtime.getContexts as jest.Mock).mockImplementation(
      () => undefined
    );
    const pending = popupPromise({
      host: 'https://site.test',
      eventName: 'personal_sign',
      route: MethodRoute.EthSign,
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: 4100 });
    await jest.advanceTimersByTimeAsync(2000);
    await rejected;
    expect(createPopupMock).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('preserves signing data and ignores approval messages from another view', async () => {
    const { pending } = await begin();
    const popupData = createPopupMock.mock.calls[0][1];
    expect(popupData.message).toBe('#keep #all-hashes');
    const response = {
      data: {
        eventName: 'personal_sign.https://site.test',
        detail: JSON.stringify('signed'),
      },
    };
    messageListener({ ...response, source: { url: getURL('app.html') } });
    messageListener({
      ...response,
      source: {
        url: `${getURL('external.html')}?data=${encodeURIComponent(
          JSON.stringify({ approvalId: 'wrong' })
        )}`,
      },
    });
    expect(self.removeEventListener).not.toHaveBeenCalled();
    messageListener({
      ...response,
      source: {
        url: `${getURL('external.html')}?data=${encodeURIComponent(
          JSON.stringify(popupData)
        )}`,
      },
    });
    await expect(pending).resolves.toBe('signed');
    expect(self.removeEventListener).toHaveBeenCalled();
  });

  it('rejects a result when the originating iframe document has disappeared', async () => {
    (chrome as any).tabs = {
      sendMessage: jest.fn().mockResolvedValue({ documentActive: true }),
    };
    const sender = {
      tab: { id: 7 },
      frameId: 3,
      documentId: 'original-document',
    } as chrome.runtime.MessageSender;
    const { pending } = await begin(undefined, sender);
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    (chrome.tabs.sendMessage as jest.Mock).mockRejectedValue(
      new Error('Document removed')
    );
    messageListener({
      data: {
        eventName: 'personal_sign.https://site.test',
        detail: JSON.stringify('signed'),
      },
      source: {
        url: `${getURL('external.html')}?data=${encodeURIComponent(
          JSON.stringify(createPopupMock.mock.calls[0][1])
        )}`,
      },
    });
    await rejected;
    expect(chrome.windows.remove).toHaveBeenCalledWith(9, expect.any(Function));
  });

  it('closes and rejects an approval when its requesting page goes away', async () => {
    const abort = new AbortController();
    const { pending } = await begin(abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    abort.abort();
    await rejected;
    expect(chrome.windows.remove).toHaveBeenCalledWith(9, expect.any(Function));
    expect(self.removeEventListener).toHaveBeenCalled();
  });
});
