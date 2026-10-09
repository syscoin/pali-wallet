import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';

import {
  checkControllerStatus,
  getControllerStatus,
  subscribeControllerStatus,
} from './controllerStatus';

jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const createPort = () => {
  const listeners = new Set<() => void>();
  return {
    onDisconnect: {
      addListener: jest.fn((listener: () => void) => listeners.add(listener)),
      removeListener: jest.fn((listener: () => void) =>
        listeners.delete(listener)
      ),
    },
    disconnect: jest.fn(),
    terminate: () => [...listeners].forEach((listener) => listener()),
  };
};

describe('controller status connection lifecycle', () => {
  const originalChrome = global.chrome;
  const originalWindow = Object.getOwnPropertyDescriptor(global, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(global, 'document');
  let disposers: Array<() => void>;
  let ports: Array<ReturnType<typeof createPort>>;
  let windowEvents: EventTarget;
  let documentEvents: EventTarget & { visibilityState: string };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(controllerEmitter).mockReset();
    disposers = [];
    ports = [];
    windowEvents = new EventTarget();
    documentEvents = Object.assign(new EventTarget(), {
      visibilityState: 'visible',
    });
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: windowEvents,
    });
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: documentEvents,
    });
    global.chrome = {
      runtime: {
        onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
        connect: jest.fn(() => {
          const port = createPort();
          ports.push(port);
          return port;
        }),
      },
    } as any;
  });

  afterEach(() => {
    disposers.forEach((dispose) => dispose());
    if (originalWindow) Object.defineProperty(global, 'window', originalWindow);
    else delete (global as any).window;
    if (originalDocument)
      Object.defineProperty(global, 'document', originalDocument);
    else delete (global as any).document;
    global.chrome = originalChrome;
    jest.useRealTimers();
  });

  const subscribe = () => {
    const dispose = subscribeControllerStatus(jest.fn());
    disposers.push(dispose);
    return dispose;
  };
  const visible = () => {
    documentEvents.visibilityState = 'visible';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
  };
  const hidden = () => {
    documentEvents.visibilityState = 'hidden';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
  };

  it('opens one separate lifetime port only after a valid status and closes it with the final consumer', async () => {
    const reply = deferred<boolean>();
    jest.mocked(controllerEmitter).mockReturnValueOnce(reply.promise);
    const first = subscribe();
    const second = subscribe();
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
    reply.resolve(true);
    await flush();
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.connect).toHaveBeenCalledWith({
      name: 'controller-status',
    });
    first();
    expect(ports[0].disconnect).not.toHaveBeenCalled();
    second();
    expect(ports[0].disconnect).toHaveBeenCalledTimes(1);
    expect(ports[0].onDisconnect.removeListener).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('immediately invalidates revealed-state trust and rejects a pre-disconnect reply', async () => {
    jest.mocked(controllerEmitter).mockResolvedValueOnce(true);
    subscribe();
    await flush();
    const stale = deferred<boolean>();
    jest.mocked(controllerEmitter).mockReturnValueOnce(stale.promise);
    const staleCheck = checkControllerStatus();
    ports[0].terminate();
    expect(getControllerStatus()).toEqual({
      connectionUnavailable: true,
      isLoading: false,
      isUnlocked: true,
    });
    stale.resolve(true);
    await staleCheck;
    expect(getControllerStatus().connectionUnavailable).toBe(true);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);

    jest.mocked(controllerEmitter).mockResolvedValueOnce(false);
    await jest.advanceTimersByTimeAsync(1999);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
    expect(getControllerStatus()).toEqual({
      connectionUnavailable: false,
      isLoading: false,
      isUnlocked: false,
    });
    ports[0].terminate();
    expect(getControllerStatus().connectionUnavailable).toBe(false);
  });

  it('keeps a failed recovery unavailable until the next successful read establishes a new port', async () => {
    jest.mocked(controllerEmitter).mockResolvedValueOnce(true);
    subscribe();
    await flush();
    ports[0].terminate();
    jest.mocked(controllerEmitter).mockRejectedValueOnce(new Error('Offline'));
    await jest.advanceTimersByTimeAsync(2000);
    expect(getControllerStatus().connectionUnavailable).toBe(true);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
    jest.mocked(controllerEmitter).mockResolvedValueOnce(true);
    await jest.advanceTimersByTimeAsync(2000);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
    expect(getControllerStatus().connectionUnavailable).toBe(false);
  });

  it('cannot reopen a port from a disposed read and reconnects after resubscription', async () => {
    const stale = deferred<boolean>();
    jest.mocked(controllerEmitter).mockReturnValueOnce(stale.promise);
    const dispose = subscribe();
    dispose();
    stale.resolve(true);
    await flush();
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
    jest.mocked(controllerEmitter).mockResolvedValueOnce(true);
    subscribe();
    await flush();
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
    expect(getControllerStatus().connectionUnavailable).toBe(false);
  });

  it('revalidates visible and focus activation together without accepting an older reply or entering full-app loading', async () => {
    jest.mocked(controllerEmitter).mockResolvedValueOnce(true);
    subscribe();
    await flush();
    const stale = deferred<boolean>();
    const resumed = deferred<boolean>();
    jest
      .mocked(controllerEmitter)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(resumed.promise);
    const oldCheck = checkControllerStatus();
    hidden();
    visible();
    windowEvents.dispatchEvent(new Event('focus'));
    await jest.advanceTimersByTimeAsync(200);
    windowEvents.dispatchEvent(new Event('focus'));
    expect(controllerEmitter).toHaveBeenCalledTimes(3);
    expect(getControllerStatus()).toMatchObject({
      connectionUnavailable: true,
      isLoading: false,
    });
    stale.resolve(true);
    await oldCheck;
    expect(getControllerStatus().connectionUnavailable).toBe(true);
    resumed.resolve(false);
    await flush();
    expect(getControllerStatus()).toEqual({
      connectionUnavailable: false,
      isLoading: false,
      isUnlocked: false,
    });
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
  });

  it('checks each focus return even without a visibility change and removes activation listeners on disposal', async () => {
    jest.mocked(controllerEmitter).mockResolvedValue(true);
    const dispose = subscribe();
    await flush();
    windowEvents.dispatchEvent(new Event('focus'));
    await flush();
    // The blur separates activations even if the next focus is within 100ms.
    windowEvents.dispatchEvent(new Event('blur'));
    windowEvents.dispatchEvent(new Event('focus'));
    await flush();
    expect(controllerEmitter).toHaveBeenCalledTimes(3);
    dispose();
    hidden();
    visible();
    windowEvents.dispatchEvent(new Event('focus'));
    expect(controllerEmitter).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('fails closed if the lifetime monitor cannot be established', async () => {
    jest.mocked(controllerEmitter).mockResolvedValue(true);
    jest.mocked(chrome.runtime.connect).mockImplementationOnce(() => {
      throw new Error('Extension context invalidated');
    });
    subscribe();
    await flush();
    expect(getControllerStatus().connectionUnavailable).toBe(true);
    await jest.advanceTimersByTimeAsync(2000);
    expect(getControllerStatus().connectionUnavailable).toBe(false);
    expect(ports).toHaveLength(1);
  });
});
