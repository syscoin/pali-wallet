import {
  requestWalletState,
  WALLET_BOOTSTRAP_TIMEOUT_MS,
  WALLET_FEEDBACK_TIMEOUT_MS,
} from './requestWalletState';

describe('authoritative wallet startup', () => {
  const originalChrome = global.chrome;
  const state = { vault: {}, vaultGlobal: {} };
  let reply: (value?: any) => void;
  let runtime: { lastError?: { message: string }; sendMessage: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    runtime = {
      sendMessage: jest.fn((_message, callback) => {
        reply = callback;
      }),
    };
    global.chrome = { runtime } as unknown as typeof chrome;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.chrome = originalChrome;
  });

  it('returns the authoritative state without falling back to storage', async () => {
    const result = requestWalletState();
    reply(state);
    await expect(result).resolves.toBe(state);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('has a hard cap when a worker never responds', async () => {
    const result = requestWalletState();
    const rejected = expect(result).rejects.toThrow('taking longer');
    jest.advanceTimersByTime(WALLET_BOOTSTRAP_TIMEOUT_MS);
    await rejected;
    // A late worker callback must not turn a failed attempt into a success.
    reply(state);
    await expect(result).rejects.toThrow('taking longer');
  });

  it.each([undefined, null, {}, { vault: {} }])(
    'rejects incomplete state %p instead of showing an empty wallet',
    async (value) => {
      const result = requestWalletState();
      reply(value);
      const rejected = expect(result).rejects.toThrow('taking longer');
      jest.advanceTimersByTime(WALLET_BOOTSTRAP_TIMEOUT_MS);
      await rejected;
    }
  );

  it('retries a starting worker within the original deadline', async () => {
    const result = requestWalletState();
    runtime.lastError = { message: 'disconnected' };
    reply();
    delete runtime.lastError;
    jest.advanceTimersByTime(100);
    expect(runtime.sendMessage).toHaveBeenCalledTimes(2);
    reply(state);
    await expect(result).resolves.toBe(state);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([0, 2000])(
    'accepts a valid late reply with page age %ims',
    async (pageAge) => {
      jest.advanceTimersByTime(pageAge);
      const result = requestWalletState();
      let settled = false;
      void result.finally(() => {
        settled = true;
      });
      jest.advanceTimersByTime(WALLET_FEEDBACK_TIMEOUT_MS + 100);
      await Promise.resolve();
      expect(settled).toBe(false);
      reply(state);
      await expect(result).resolves.toBe(state);
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  it('cancels a superseded attempt without accepting its late response', async () => {
    const controller = new AbortController();
    const result = requestWalletState(undefined, controller.signal);
    const rejected = expect(result).rejects.toThrow('cancelled');
    controller.abort();
    await rejected;
    reply(state);
    expect(jest.getTimerCount()).toBe(0);
  });
});
