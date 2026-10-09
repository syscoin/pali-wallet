jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));

import { AsyncMutex } from 'utils/asyncMutex';

import MainController from './MainController';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('wallet authentication session boundaries', () => {
  let wallet: any;
  let keyring: any;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    keyring = {
      isUnlocked: jest.fn().mockReturnValue(true),
      lockWallet: jest.fn().mockResolvedValue(undefined),
      unlock: jest.fn().mockResolvedValue({ canLogin: true }),
      getSeed: jest.fn().mockResolvedValue('test seed'),
      getPrivateKeyByAccountId: jest.fn().mockResolvedValue('test private key'),
    };
    // Exercise the real methods without constructing RPC/hardware clients.
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 0;
    wallet.authenticationMutex = new AsyncMutex();
    wallet.getActiveKeyring = jest.fn(() => keyring);
    wallet.checkRateLimit = jest.fn().mockResolvedValue(0);
    wallet.resetRateLimit = jest.fn().mockResolvedValue(undefined);
    wallet.recordFailedAttempt = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => errorSpy.mockRestore());

  it('does not allow the old skip-rate-limit argument to bypass lockout', async () => {
    wallet.checkRateLimit.mockResolvedValue(120);
    await expect(wallet.unlock('wrong password', true)).rejects.toThrow(
      'Too many failed attempts'
    );
    expect(keyring.unlock).not.toHaveBeenCalled();
  });

  it('counts a failed unlock exactly once', async () => {
    keyring.unlock.mockResolvedValue({ canLogin: false });
    await expect(wallet.unlock('wrong password')).resolves.toEqual({
      canLogin: false,
    });
    expect(wallet.recordFailedAttempt).toHaveBeenCalledTimes(1);
  });

  it('does not spend password attempts on an operational unlock failure', async () => {
    // Error text is not an authentication verdict from the keyring.
    const error = new Error('Invalid password');
    keyring.unlock.mockRejectedValueOnce(error);
    await expect(wallet.unlock('correct password')).rejects.toBe(error);
    expect(wallet.recordFailedAttempt).not.toHaveBeenCalled();

    await expect(wallet.unlock('correct password')).resolves.toEqual({
      canLogin: true,
    });
    expect(wallet.recordFailedAttempt).not.toHaveBeenCalled();
    expect(wallet.resetRateLimit).toHaveBeenCalledTimes(1);
  });

  it('clears a session created by an unlock that completed after a lock', async () => {
    const result = deferred<{ canLogin: boolean }>();
    keyring.unlock.mockReturnValue(result.promise);
    const started = deferred<void>();
    keyring.unlock.mockImplementation(() => {
      started.resolve();
      return result.promise;
    });
    const unlocking = wallet.unlock('password');
    const rejected = expect(unlocking).rejects.toThrow(
      'Wallet session changed'
    );
    await started.promise;
    wallet.walletSessionGeneration += 1;
    result.resolve({ canLogin: true });
    await rejected;
    expect(keyring.lockWallet).toHaveBeenCalledTimes(1);
    expect(wallet.resetRateLimit).not.toHaveBeenCalled();
  });

  it.each(['getSeed', 'getPrivateKeyByAccountId'])(
    'does not return a delayed %s result after locking',
    async (method) => {
      const result = deferred<string>();
      const started = deferred<void>();
      keyring[method].mockImplementation(() => {
        started.resolve();
        return result.promise;
      });
      const request =
        method === 'getSeed'
          ? wallet.getSeed('password')
          : wallet.getPrivateKeyByAccountId(0, 'HDAccount', 'password');
      const rejected = expect(request).rejects.toThrow(
        'Wallet session changed'
      );
      await started.promise;
      wallet.walletSessionGeneration += 1;
      result.resolve('sensitive result');
      await rejected;
    }
  );

  it('serializes password attempts so pending requests cannot exceed the attempt limit', async () => {
    const first = deferred<string>();
    const started = deferred<void>();
    keyring.getSeed.mockImplementation(() => {
      started.resolve();
      return first.promise;
    });
    const request = wallet.getSeed('password');
    await started.promise;
    wallet.checkRateLimit.mockResolvedValue(120);
    const blocked = wallet.getSeed('another password');
    const rejected = expect(blocked).rejects.toThrow(
      'Too many failed attempts'
    );
    first.resolve('test seed');
    await request;
    await rejected;
    expect(keyring.getSeed).toHaveBeenCalledTimes(1);
  });
});
