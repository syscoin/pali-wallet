/** Registering optional code must not opt a user into network or note work. */
describe('privacy module evaluation', () => {
  const originalChrome = global.chrome;
  afterEach(() => {
    global.chrome = originalChrome;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('evaluates the actual optional modules without RPC, public downloads, custody reads or offscreen work', async () => {
    jest.resetModules();
    jest.useFakeTimers();
    const transport = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected startup fetch'));
    const read = jest.spyOn(chrome.storage.local, 'get');
    const write = jest.spyOn(chrome.storage.local, 'set');
    const message = jest.spyOn(chrome.runtime, 'sendMessage');
    const connect = jest.fn();
    const offscreen = jest.fn();
    global.chrome = {
      ...chrome,
      runtime: { ...chrome.runtime, onConnect: { addListener: connect } },
      offscreen: { createDocument: offscreen },
    } as unknown as typeof chrome;
    const keys = jest.spyOn(globalThis.crypto, 'getRandomValues');
    // Evaluate real module dependency graphs. None of their exported operations
    // is called; the normal worker registration only needs these definitions.
    jest.isolateModules(() => {
      require('./controllers/privacyTransactions');
      require('./controllers/privacyWithdrawals');
      require('utils/privacy/relayers');
      require('utils/privacy/withdrawal');
      require('utils/privacy/prover');
    });
    await Promise.resolve();
    expect(transport).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(offscreen).not.toHaveBeenCalled();
    expect(keys).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
