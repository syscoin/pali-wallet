import { NativeBalanceCacheSaveScheduler } from './nativeBalanceCacheSaveScheduler';

describe('NativeBalanceCacheSaveScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('coalesces cache-save bursts without sharing another debounce timer', () => {
    const scheduler = new NativeBalanceCacheSaveScheduler(2000);
    const save = jest.fn();

    scheduler.schedule(save);
    jest.advanceTimersByTime(1000);
    scheduler.schedule(save);
    jest.advanceTimersByTime(1999);

    expect(save).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('cancels a redundant cache save absorbed by a wallet save', () => {
    const scheduler = new NativeBalanceCacheSaveScheduler(2000);
    const save = jest.fn();

    scheduler.schedule(save);
    scheduler.cancel();
    jest.advanceTimersByTime(2000);

    expect(save).not.toHaveBeenCalled();
  });
});
