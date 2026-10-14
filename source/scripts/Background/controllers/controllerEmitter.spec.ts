import { controllerEmitter } from './controllerEmitter';

describe('controller submission timeout', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not cancel or retry the background send after its local timer expires', async () => {
    jest.useFakeTimers();
    (chrome.runtime as any).id = 'pali';
    let complete!: (response: unknown) => void;
    const send = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((
      _message: unknown,
      callback: (response: unknown) => void
    ) => {
      complete = callback;
    }) as any);
    const pending = controllerEmitter(
      ['wallet', 'sendAndSaveEthTransaction'],
      [{}]
    );
    const rejected = expect(pending).rejects.toThrow(
      'Network request timed out'
    );
    await jest.advanceTimersByTimeAsync(10_000);
    await rejected;
    complete({ hash: `0x${'ab'.repeat(32)}` });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    await expect(pending).rejects.toThrow('Network request timed out');
  });
});
