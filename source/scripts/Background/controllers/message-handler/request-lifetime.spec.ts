import {
  createRequestLifetime,
  isRequestDocumentLive,
} from './request-lifetime';

describe('request document lifetime', () => {
  const sender = {
    tab: { id: 7 },
    frameId: 3,
    documentId: 'document-123',
  } as chrome.runtime.MessageSender;
  beforeEach(() => {
    (chrome as any).tabs = {
      sendMessage: jest.fn(),
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    };
  });
  afterEach(() => jest.useRealTimers());

  it('targets the originating document rather than a newly navigated frame', async () => {
    (chrome.tabs.sendMessage as jest.Mock).mockResolvedValue({
      documentActive: true,
    });
    await expect(isRequestDocumentLive(sender)).resolves.toBe(true);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      { type: 'PALI_PROVIDER_DOCUMENT_CHECK' },
      { documentId: 'document-123', frameId: 3 }
    );
    (chrome.tabs.sendMessage as jest.Mock).mockRejectedValue(
      new Error('No matching document')
    );
    await expect(isRequestDocumentLive(sender)).resolves.toBe(false);
  });

  it('bounds a nonresponsive document check', async () => {
    jest.useFakeTimers();
    (chrome.tabs.sendMessage as jest.Mock).mockReturnValue(
      new Promise(() => undefined)
    );
    const result = isRequestDocumentLive(sender);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts on tab removal and removes lifecycle listeners when finished', () => {
    const lifetime = createRequestLifetime(sender);
    const removed = (chrome.tabs.onRemoved.addListener as jest.Mock).mock
      .calls[0][0];
    removed(99);
    expect(lifetime.signal.aborted).toBe(false);
    removed(7);
    expect(lifetime.signal.aborted).toBe(true);
    lifetime.dispose();
    expect(chrome.tabs.onRemoved.removeListener).toHaveBeenCalledWith(removed);
  });
});
