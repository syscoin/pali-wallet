import { sendToBackground } from './backgroundMessaging';

describe('background request delivery retries', () => {
  const originalChrome = global.chrome;
  let sendMessage: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    sendMessage = jest.fn();
    global.chrome = { runtime: { sendMessage } } as any;
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    global.chrome = originalChrome;
  });

  const failWith = (message: string) => {
    sendMessage.mockImplementationOnce((_request, respond) => {
      (chrome.runtime as any).lastError = { message };
      respond();
      delete chrome.runtime.lastError;
    });
  };

  it('retries an undelivered request and returns its eventual response', async () => {
    failWith('Could not establish connection. Receiving end does not exist.');
    sendMessage.mockImplementationOnce((_request, respond) => respond('sent'));
    const response = jest.fn();
    const pending = sendToBackground(
      { type: 'METHOD_REQUEST', data: { method: 'eth_sendTransaction' } },
      response
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(100);
    await pending;
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(response).toHaveBeenCalledWith('sent');
  });

  it.each([
    'The message port closed before a response was received.',
    'Extension context invalidated.',
    'A listener indicated an asynchronous response, but the message channel closed before a response was received.',
  ])(
    'does not replay a transaction after an ambiguous failure: %s',
    async (message) => {
      failWith(message);
      const response = jest.fn();
      await sendToBackground(
        { type: 'METHOD_REQUEST', data: { method: 'eth_sendTransaction' } },
        response
      );
      await jest.advanceTimersByTimeAsync(5000);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(response).toHaveBeenCalledWith({
        error: {
          code: -32603,
          message: expect.stringContaining(
            'check wallet activity before retrying'
          ),
        },
      });
    }
  );
});
