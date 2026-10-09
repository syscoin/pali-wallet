import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';

import {
  checkControllerStatus,
  getControllerStatus,
  refreshControllerStatus,
  resetControllerAutoLockForRoute,
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
};
const message = (type: string) => {
  const calls = jest.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  calls[calls.length - 1][0](
    { type },
    {} as chrome.runtime.MessageSender,
    jest.fn()
  );
};

describe('shared controller status', () => {
  let disposers: Array<() => void>;
  beforeEach(() => {
    jest.useFakeTimers();
    disposers = [];
    jest.mocked(controllerEmitter).mockReset();
  });
  afterEach(() => {
    disposers.forEach((dispose) => dispose());
    jest.useRealTimers();
  });

  it('shares one listener and one in-flight check across consumers and state bursts', async () => {
    const check = deferred<boolean>();
    jest.mocked(controllerEmitter).mockReturnValue(check.promise);
    const addListener = jest.spyOn(chrome.runtime.onMessage, 'addListener');
    const before = addListener.mock.calls.length;
    for (let i = 0; i < 12; i += 1) {
      disposers.push(subscribeControllerStatus(jest.fn()));
    }
    for (let i = 0; i < 20; i += 1) message('CONTROLLER_STATE_CHANGE');
    expect(addListener.mock.calls.length - before).toBe(1);
    expect(controllerEmitter).toHaveBeenCalledTimes(1);
    check.resolve(true);
    await flush();
    expect(getControllerStatus()).toEqual({
      connectionUnavailable: false,
      isLoading: false,
      isUnlocked: true,
    });
    jest.advanceTimersByTime(29999);
    expect(controllerEmitter).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(controllerEmitter).toHaveBeenCalledTimes(2);
    addListener.mockRestore();
  });

  it('does not let an older successful check undo an explicit logout', async () => {
    const check = deferred<boolean>();
    jest.mocked(controllerEmitter).mockReturnValue(check.promise);
    disposers.push(subscribeControllerStatus(jest.fn()));
    message('logout');
    check.resolve(true);
    await flush();
    expect(getControllerStatus()).toEqual({
      connectionUnavailable: false,
      isLoading: false,
      isUnlocked: false,
    });
  });

  it('does not accumulate overlapping polls when the worker is slow', async () => {
    jest
      .mocked(controllerEmitter)
      .mockReturnValue(new Promise(() => undefined));
    disposers.push(subscribeControllerStatus(jest.fn()));
    jest.advanceTimersByTime(60000);
    expect(controllerEmitter).toHaveBeenCalledTimes(1);
  });

  it('refreshes after unlock without reusing or accepting a pre-unlock read', async () => {
    const beforeUnlock = deferred<boolean>();
    const afterUnlock = deferred<boolean>();
    jest
      .mocked(controllerEmitter)
      .mockReturnValueOnce(beforeUnlock.promise)
      .mockReturnValueOnce(afterUnlock.promise);
    disposers.push(subscribeControllerStatus(jest.fn()));
    const refresh = refreshControllerStatus();
    expect(controllerEmitter).toHaveBeenCalledTimes(2);
    expect(getControllerStatus().isLoading).toBe(true);
    afterUnlock.resolve(true);
    expect(await refresh).toBe(true);
    expect(getControllerStatus().isUnlocked).toBe(true);
    beforeUnlock.resolve(false);
    await flush();
    expect(getControllerStatus()).toEqual({
      connectionUnavailable: false,
      isLoading: false,
      isUnlocked: true,
    });
  });

  it('does not confirm an unlock from cached state when its fresh read fails', async () => {
    jest.mocked(controllerEmitter).mockResolvedValueOnce(true);
    disposers.push(subscribeControllerStatus(jest.fn()));
    await flush();
    jest.mocked(controllerEmitter).mockRejectedValueOnce(new Error('Offline'));
    expect(await refreshControllerStatus()).toBe(false);
    expect(getControllerStatus().isUnlocked).toBe(true);
    expect(getControllerStatus().connectionUnavailable).toBe(true);
  });

  it('does not confirm an unlock after a concurrent logout', async () => {
    jest.mocked(controllerEmitter).mockResolvedValueOnce(false);
    disposers.push(subscribeControllerStatus(jest.fn()));
    await flush();
    const check = deferred<boolean>();
    jest.mocked(controllerEmitter).mockReturnValueOnce(check.promise);
    const refresh = refreshControllerStatus();
    message('logout');
    check.resolve(true);
    expect(await refresh).toBe(false);
    expect(getControllerStatus().isUnlocked).toBe(false);
  });

  it('retains cached lock state but marks a failed read unavailable and retries after two seconds', async () => {
    jest.mocked(controllerEmitter).mockResolvedValueOnce(true);
    disposers.push(subscribeControllerStatus(jest.fn()));
    await flush();
    expect(getControllerStatus().isUnlocked).toBe(true);

    jest
      .mocked(controllerEmitter)
      .mockRejectedValueOnce(new Error('Worker unavailable'));
    await checkControllerStatus();
    expect(getControllerStatus()).toEqual({
      connectionUnavailable: true,
      isLoading: false,
      isUnlocked: true,
    });
    expect(controllerEmitter).toHaveBeenLastCalledWith(
      ['wallet', 'isUnlocked'],
      [],
      1800,
      false
    );

    jest.mocked(controllerEmitter).mockResolvedValueOnce(true);
    const attempts = jest.mocked(controllerEmitter).mock.calls.length;
    jest.advanceTimersByTime(1999);
    expect(controllerEmitter).toHaveBeenCalledTimes(attempts);
    jest.advanceTimersByTime(1);
    await flush();
    expect(controllerEmitter).toHaveBeenCalledTimes(attempts + 1);
    expect(getControllerStatus().connectionUnavailable).toBe(false);
  });

  it('does not treat a missing status response as an authoritative lock or recovery', async () => {
    jest.mocked(controllerEmitter).mockResolvedValueOnce(true);
    disposers.push(subscribeControllerStatus(jest.fn()));
    await flush();
    jest.mocked(controllerEmitter).mockResolvedValueOnce(undefined);
    await checkControllerStatus();
    expect(getControllerStatus().isUnlocked).toBe(true);
    expect(getControllerStatus().connectionUnavailable).toBe(true);
  });

  it('coalesces route activity reported by several mounted components', async () => {
    jest.mocked(controllerEmitter).mockResolvedValue(undefined);
    for (let i = 0; i < 12; i += 1) resetControllerAutoLockForRoute('/route-a');
    expect(controllerEmitter).toHaveBeenCalledTimes(1);
    await flush();
    resetControllerAutoLockForRoute('/route-b');
    expect(controllerEmitter).toHaveBeenCalledTimes(2);
  });
});
