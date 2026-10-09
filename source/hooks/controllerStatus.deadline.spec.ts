// Use the real emitter: a mocked promise would hide its internal retry delays.
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';

import {
  checkControllerStatus,
  getControllerStatus,
  subscribeControllerStatus,
} from './controllerStatus';

describe('controller status transport deadline', () => {
  const originalChrome = global.chrome;
  let sendMessage: jest.Mock;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
    sendMessage = jest.fn();
    global.chrome = {
      runtime: {
        id: 'pali',
        sendMessage,
        onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
      },
    } as any;
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
    global.chrome = originalChrome;
  });

  const missingReceiver = () => {
    sendMessage.mockImplementationOnce((_request, reply) => {
      (chrome.runtime as any).lastError = {
        message:
          'Could not establish connection. Receiving end does not exist.',
      };
      reply();
      delete chrome.runtime.lastError;
    });
  };

  it('does not retry a missing receiver when retryConnection is false', async () => {
    missingReceiver();
    await expect(
      controllerEmitter(['wallet', 'isUnlocked'], [], 1800, false)
    ).rejects.toThrow('Receiving end does not exist');
    await jest.advanceTimersByTimeAsync(8000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('marks cached unlocked state unavailable at 1.8 seconds when its read hangs', async () => {
    sendMessage.mockImplementationOnce((_request, reply) => reply(true));
    dispose = subscribeControllerStatus(jest.fn());
    await checkControllerStatus();
    expect(getControllerStatus().isUnlocked).toBe(true);
    expect(getControllerStatus().connectionUnavailable).toBe(false);

    sendMessage.mockImplementationOnce(() => undefined);
    const check = checkControllerStatus();
    await jest.advanceTimersByTimeAsync(1799);
    expect(getControllerStatus().connectionUnavailable).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await check;
    expect(getControllerStatus()).toMatchObject({
      isUnlocked: true,
      isLoading: false,
      connectionUnavailable: true,
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('lets the shared poller own recovery after a missing receiver', async () => {
    missingReceiver();
    dispose = subscribeControllerStatus(jest.fn());
    await checkControllerStatus();
    expect(getControllerStatus().connectionUnavailable).toBe(true);
    await jest.advanceTimersByTimeAsync(1999);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    sendMessage.mockImplementationOnce((_request, reply) => reply(true));
    await jest.advanceTimersByTimeAsync(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(getControllerStatus().connectionUnavailable).toBe(false);
  });

  it('preserves the default connection-retry behavior for other callers', async () => {
    missingReceiver();
    sendMessage.mockImplementationOnce((_request, reply) => reply(true));
    const request = controllerEmitter(['wallet', 'isUnlocked'], [], 1800);
    await jest.advanceTimersByTimeAsync(499);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });
});
