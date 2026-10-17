const mockStorage = new Map<string, any>();
let mockGeneration = 1;
const mockGet = jest.fn(async (key: string) => ({
  [key]: mockStorage.get(key),
}));
const mockSet = jest.fn(async (values: Record<string, unknown>) => {
  Object.entries(values).forEach(([key, value]) => mockStorage.set(key, value));
});

jest.mock('scripts/Background/controllers/message-handler', () => ({
  onMessage: jest.fn(),
}));
jest.mock('scripts/Background/handlers/handleLogout', () => ({
  handleLogout: jest.fn(),
}));
jest.mock('scripts/Background/utils/startPolling', () => ({
  startPolling: jest.fn(),
}));
jest.mock('./handlePaliUpdates', () => ({ checkForUpdates: jest.fn() }));
jest.mock('state/store', () => ({ getState: () => ({ vaultGlobal: {} }) }));
jest.mock('state/vaultCache', () => ({}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: async (key: string) => (await mockGet(key))[key] ?? null,
    setItem: async (key: string, value: unknown) => mockSet({ [key]: value }),
    removeItem: async (key: string) => mockStorage.delete(key),
  },
}));
jest.mock('utils/slhDsa/signer', () => ({
  getSLHDSASessionGeneration: () => mockGeneration,
  assertSLHDSASessionGeneration: (generation: number) => {
    if (generation !== mockGeneration)
      throw new Error('wallet session changed');
  },
  provisionRuntimeSLHDSAStateFromSetupSecret: jest.fn(async () => ({
    keyId: 'public-fixture-key',
    pkRoot: 'public-root',
    pkSeed: 'public-seed',
    signatureLimit: 128,
  })),
}));

import {
  getSLHDSASmartAccountSetupStatus,
  provisionSLHDSASmartAccountValidator,
  startSLHDSASmartAccountValidatorSetup,
} from 'utils/slhDsa/smartAccountSetup';

import { handleListeners, resetListenersFlag } from './handleListeners';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const secret = {
  derivationLabel: 'synthetic',
  setupSecretHex: 'synthetic-not-a-key',
};

describe('SLH setup progress message lifetime', () => {
  let listener: (...args: any[]) => any;
  const originalChrome = global.chrome;
  beforeEach(() => {
    mockGeneration += 1;
    mockStorage.clear();
    jest.clearAllMocks();
    mockGet.mockImplementation(async (key) => ({
      [key]: mockStorage.get(key),
    }));
    mockSet.mockImplementation(async (values) => {
      Object.entries(values).forEach(([key, value]) =>
        mockStorage.set(key, value)
      );
    });
    global.chrome = {
      alarms: {
        onAlarm: { addListener: jest.fn(), removeListener: jest.fn() },
      },
      storage: { local: { get: mockGet, set: mockSet } },
      runtime: {
        id: 'pali-extension',
        getURL: (path = '') => `chrome-extension://pali-extension/${path}`,
        onMessage: {
          addListener: (value: typeof listener) => {
            listener = value;
          },
          removeListener: jest.fn(),
        },
        onConnect: { addListener: jest.fn() },
      },
    } as unknown as typeof chrome;
    resetListenersFlag();
    handleListeners({} as any);
  });
  afterEach(() => {
    global.chrome = originalChrome;
  });
  const progress = (accountId: number, setupJobId?: string, completed = 10) =>
    new Promise<any>((resolve) => {
      listener(
        {
          accountId,
          setupJobId,
          progress: { completed, total: 100, level: 0, phase: 'xmss-cache' },
          type: 'PALI_SLH_DSA_SETUP_PROGRESS',
        },
        {
          id: 'pali-extension',
          url: 'chrome-extension://pali-extension/offscreen.html',
        },
        resolve
      );
    });
  const pendingJob = async (accountId: number) => {
    const held = deferred<typeof secret>();
    const args = {
      accountId,
      accountIndex: 0,
      getSetupSecret: () => held.promise,
    };
    const status = await startSLHDSASmartAccountValidatorSetup(args);
    return {
      release: () => held.resolve(secret),
      status: status as typeof status & { setupJobId?: string },
      finish: async () => {
        held.resolve(secret);
        await provisionSLHDSASmartAccountValidator(args);
      },
    };
  };

  it('ignores progress with an obsolete job identity for the same account', async () => {
    const job = await pendingJob(601);
    try {
      await progress(601, 'obsolete-job');
      expect(
        (await getSLHDSASmartAccountSetupStatus({ accountId: 601 }))?.progress
      ).toBeUndefined();
    } finally {
      await job.finish();
    }
  });

  it('does not let a delayed progress read resurrect a completed setup', async () => {
    const job = await pendingJob(602);
    const readStarted = deferred<void>();
    const held = deferred<void>();
    mockGet.mockImplementationOnce(async (key) => {
      const snapshot = mockStorage.get(key);
      readStarted.resolve();
      await held.promise;
      return { [key]: snapshot };
    });
    const pending = progress(602, job.status.setupJobId);
    await readStarted.promise;
    const finishing = job.finish();
    await new Promise(setImmediate);
    held.resolve();
    await Promise.all([pending, finishing]);
    expect(
      (await getSLHDSASmartAccountSetupStatus({ accountId: 602 }))?.status
    ).toBe('ready');
  });

  it('accepts current progress without regressing a later observation', async () => {
    const job = await pendingJob(603);
    try {
      await progress(603, job.status.setupJobId, 60);
      await progress(603, job.status.setupJobId, 10);
      expect(
        (await getSLHDSASmartAccountSetupStatus({ accountId: 603 }))?.progress
          ?.completed
      ).toBe(60);
    } finally {
      await job.finish();
    }
  });

  it('ignores missing identity and malformed progress, then preserves the terminal state', async () => {
    const job = await pendingJob(604);
    await progress(604);
    await progress(604, job.status.setupJobId, -1);
    await progress(604, job.status.setupJobId, 101);
    await progress(604, job.status.setupJobId, 0.5);
    expect(
      (await getSLHDSASmartAccountSetupStatus({ accountId: 604 }))?.progress
    ).toBeUndefined();
    await job.finish();
    await progress(604, job.status.setupJobId);
    expect(
      (await getSLHDSASmartAccountSetupStatus({ accountId: 604 }))?.status
    ).toBe('ready');
  });

  it('rechecks the session after a delayed progress read before writing', async () => {
    const job = await pendingJob(605);
    const readStarted = deferred<void>();
    const held = deferred<void>();
    mockGet.mockImplementationOnce(async (key) => {
      const snapshot = mockStorage.get(key);
      readStarted.resolve();
      await held.promise;
      return { [key]: snapshot };
    });
    const pending = progress(605, job.status.setupJobId);
    await readStarted.promise;
    mockGeneration += 1;
    mockSet.mockClear();
    held.resolve();
    await pending;
    expect(mockSet).not.toHaveBeenCalled();
    job.release();
    await new Promise(setImmediate);
  });

  it('orders a replacement setup after an already-dispatched old progress write', async () => {
    const old = await pendingJob(606);
    const writing = deferred<void>();
    const held = deferred<void>();
    mockSet.mockImplementationOnce(async (values) => {
      writing.resolve();
      await held.promise;
      Object.entries(values).forEach(([key, value]) =>
        mockStorage.set(key, value)
      );
    });
    const pending = progress(606, old.status.setupJobId);
    await writing.promise;
    mockGeneration += 1;
    const replacement = pendingJob(606);
    await new Promise(setImmediate);
    expect(mockSet).toHaveBeenCalledTimes(2); // initial status and pending old progress only
    held.resolve();
    await pending;
    const current = await replacement;
    expect(current.status.setupJobId).not.toBe(old.status.setupJobId);
    expect(
      (await getSLHDSASmartAccountSetupStatus({ accountId: 606 }))?.progress
    ).toBeUndefined();
    old.release();
    await current.finish();
    await progress(606, old.status.setupJobId);
    expect(
      (await getSLHDSASmartAccountSetupStatus({ accountId: 606 }))?.status
    ).toBe('ready');
  });
});
