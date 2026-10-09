import {
  APPROVAL_CLIENT_READY,
  APPROVAL_REGISTER,
  connectApprovalClient,
} from './approvalClient';

describe('approval document connection', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(global, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(
    global,
    'navigator'
  );
  const originalChannel = global.MessageChannel;
  let reply: (value: any) => void;
  let worker: { postMessage: jest.Mock } | undefined;
  let channels: any[];
  const registered = {
    status: 'registered',
    approvalId: 'approval',
    challenge: 'challenge',
  };
  const ready = {
    eventName: APPROVAL_CLIENT_READY,
    approvalId: 'approval',
    status: 'ready',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        location: {
          href: `chrome-extension://pali/external.html?data=${encodeURIComponent(
            JSON.stringify({ approvalId: 'approval' })
          )}`,
        },
      },
    });
    worker = { postMessage: jest.fn() };
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          get controller() {
            return worker;
          },
        },
      },
    });
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
      (_message, callback) => {
        reply = callback;
      }
    );
    channels = [];
    (global as any).MessageChannel = jest.fn(() => {
      const port1 = {
        onmessage: null as any,
        start: jest.fn(),
        close: jest.fn(),
      };
      const port2 = {
        postMessage: (data: any) => port1.onmessage?.({ data }),
        close: jest.fn(),
      };
      const channel = { port1, port2 };
      channels.push(channel);
      return channel;
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    if (originalWindow) Object.defineProperty(global, 'window', originalWindow);
    else delete (global as any).window;
    if (originalNavigator)
      Object.defineProperty(global, 'navigator', originalNavigator);
    else delete (global as any).navigator;
    global.MessageChannel = originalChannel;
  });

  it('does not block standalone external and hardware flows', async () => {
    window.location.href =
      'chrome-extension://pali/external.html?route=hardware';
    await expect(connectApprovalClient()).resolves.toBeUndefined();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    'chrome-extension://pali/external.html?data=malformed',
    `chrome-extension://pali/external/tx/ethSign?data=${encodeURIComponent(
      JSON.stringify({ approvalId: 'approval' })
    )}`,
  ])(
    'fails closed for malformed or already-routed reloads: %s',
    async (url) => {
      window.location.href = url;
      await expect(connectApprovalClient()).rejects.toThrow(/approval/);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    }
  );

  it('registers the document then waits for the matching private-channel ACK', async () => {
    const pending = connectApprovalClient();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: APPROVAL_REGISTER, approvalId: 'approval' },
      expect.any(Function)
    );
    reply(registered);
    expect(worker!.postMessage).toHaveBeenCalledWith(
      {
        eventName: APPROVAL_CLIENT_READY,
        approvalId: 'approval',
        challenge: 'challenge',
      },
      [channels[0].port2]
    );
    channels[0].port2.postMessage({ ...ready, approvalId: 'wrong' });
    channels[0].port2.postMessage({ ...ready, eventName: 'wrong' });
    expect(channels[0].port1.close).not.toHaveBeenCalled();
    channels[0].port2.postMessage(ready);
    await expect(pending).resolves.toBeUndefined();
    expect(channels[0].port1.close).toHaveBeenCalledTimes(1);
    expect(channels[0].port2.close).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('waits for an initially missing worker controller within the deadline', async () => {
    worker = undefined;
    const pending = connectApprovalClient();
    reply(registered);
    await jest.advanceTimersByTimeAsync(500);
    expect(channels).toHaveLength(0);
    worker = {
      postMessage: jest.fn((_data, ports) => ports[0].postMessage(ready)),
    };
    await jest.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports missing registration within the default 1.8-second deadline', async () => {
    const pending = connectApprovalClient();
    const rejected = expect(pending).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(1800);
    await rejected;
    reply(registered);
    expect(worker!.postMessage).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds a missing ACK and closes both ports', async () => {
    const pending = connectApprovalClient();
    const rejected = expect(pending).rejects.toThrow('timed out');
    reply(registered);
    await jest.advanceTimersByTimeAsync(1800);
    await rejected;
    channels[0].port2.postMessage(ready);
    expect(channels[0].port1.close).toHaveBeenCalledTimes(1);
    expect(channels[0].port2.close).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('accepts a valid late ACK with a separate hard deadline', async () => {
    const pending = connectApprovalClient(undefined, 10000);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    reply(registered);
    await jest.advanceTimersByTimeAsync(2700);
    expect(settled).toBe(false);
    channels[0].port2.postMessage(ready);
    await expect(pending).resolves.toBeUndefined();
  });

  it.each(['registration', 'ack'] as const)(
    'discards late replies after cancellation during %s',
    async (phase) => {
      const abort = new AbortController();
      const pending = connectApprovalClient(abort.signal);
      const rejected = expect(pending).rejects.toThrow('cancelled');
      if (phase === 'ack') reply(registered);
      abort.abort();
      await rejected;
      if (phase === 'registration') reply(registered);
      else channels[0].port2.postMessage(ready);
      expect(jest.getTimerCount()).toBe(0);
      if (phase === 'ack')
        expect(channels[0].port1.close).toHaveBeenCalledTimes(1);
      else expect(channels).toHaveLength(0);
    }
  );

  it('keeps a timed-out attempt from completing a later retry', async () => {
    const first = connectApprovalClient();
    const rejected = expect(first).rejects.toThrow('timed out');
    reply(registered);
    await jest.advanceTimersByTimeAsync(1800);
    await rejected;
    const second = connectApprovalClient();
    let settled = false;
    void second.then(() => {
      settled = true;
    });
    reply(registered);
    channels[0].port2.postMessage(ready);
    await Promise.resolve();
    expect(settled).toBe(false);
    channels[1].port2.postMessage(ready);
    await expect(second).resolves.toBeUndefined();
  });

  it('does not post a binding request when registration is unavailable', async () => {
    const pending = connectApprovalClient();
    reply({ status: 'unavailable', approvalId: 'approval' });
    await expect(pending).rejects.toThrow('no longer available');
    expect(worker!.postMessage).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds retries if posting to the worker fails', async () => {
    worker!.postMessage.mockImplementation(() => {
      throw new Error('Worker stopped');
    });
    const pending = connectApprovalClient();
    const rejected = expect(pending).rejects.toThrow('timed out');
    reply(registered);
    await jest.advanceTimersByTimeAsync(1800);
    await rejected;
    expect(
      channels.every((channel) => channel.port1.close.mock.calls.length === 1)
    ).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
