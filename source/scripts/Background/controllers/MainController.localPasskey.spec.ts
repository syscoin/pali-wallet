import { webcrypto } from 'crypto';

import { getController } from '..';
import { createLocalPasskeyResponseFixture } from '../../../../tests/helpers/localPasskeyResponse';
import { walletPersistenceGate } from 'state/paliStorage';
import { AsyncMutex } from 'utils/asyncMutex';
import { clearNavigationState } from 'utils/navigationState';
import { chromeStorage } from 'utils/storageAPI';

import { createBrowserKeyringHost } from './browserKeyringHost';
import MainController from './MainController';
import type {
  LocalPasskeyController,
  LocalPasskeyStep,
} from '../../../wallet/localPasskeyTypes';

jest.unmock('syscoinjs-lib');
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'),
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/signers'),
  createKeyringHost: jest.requireActual(
    '@sidhujag/sysweb3-keyring/cjs/software.js'
  ).createKeyringHost,
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn(async () => undefined),
  clearTransactionNavigationState: jest.fn(async () => undefined),
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('./storageManager', () => ({
  StorageManager: {
    getInstance: () => ({ ensureInitialized: async () => undefined }),
  },
}));

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Public local passkey fixture 1!';
const ORIGIN = `chrome-extension://${'a'.repeat(32)}`;
let mockState: any;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalGetURL = Object.getOwnPropertyDescriptor(
  chrome.runtime,
  'getURL'
);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  walletPersistenceGate.blocked = false;
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  Object.defineProperty(chrome.runtime, 'getURL', {
    configurable: true,
    value: jest.fn((path: string) => `${ORIGIN}/${path}`),
  });
  jest.mocked(getController).mockReturnValue({
    dapp: { handleStateChange: jest.fn(async () => undefined) },
  } as any);
  jest.mocked(clearNavigationState).mockClear();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  if (originalGetURL)
    Object.defineProperty(chrome.runtime, 'getURL', originalGetURL);
  else Reflect.deleteProperty(chrome.runtime, 'getURL');
});

async function fixture() {
  const sdk = jest.requireActual('@sidhujag/sysweb3-keyring/cjs/software');
  const records: Record<string, unknown> = {};
  jest
    .spyOn(chrome.storage.local, 'get')
    .mockImplementation((async (keys: string[]) =>
      Object.fromEntries(
        keys.map((key) => [key, structuredClone(records[key])])
      )) as any);
  jest.spyOn(chrome.storage.local, 'set').mockImplementation((async (
    items: Record<string, unknown>
  ) => {
    Object.assign(records, structuredClone(items));
  }) as any);
  jest
    .spyOn(chromeStorage, 'getItem')
    .mockImplementation(async (key) => structuredClone(records[key]));
  jest
    .spyOn(chromeStorage, 'setItem')
    .mockImplementation(async (key, value) => {
      records[key] = structuredClone(value);
    });
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        slip44: 60,
        currency: 'ETH',
        url: 'https://offline.invalid',
      },
      accounts: {
        HDAccount: {},
        Imported: {},
        Ledger: {},
        Trezor: {},
        SmartAccount: {},
      },
    },
    vaultGlobal: { activeSlip44: 60, advancedSettings: { autolock: 0 } },
  };
  const wallet: any = Object.create(MainController.prototype);
  const host = createBrowserKeyringHost(chrome.storage.local, {
    readCredential: (pair) => wallet.localPasskeySdkPort.readCredential(pair),
    writeCredential: (value, guard) =>
      wallet.localPasskeySdkPort.writeCredential(value, guard),
  });
  const instances: any[] = [];
  const createRing = () => {
    let owned: any;
    const ring = new sdk.SoftwareKeyring(host, {
      captureEvmSubmission: null,
      receiveDeviceUnlock: (value: unknown) => {
        owned = value;
      },
    });
    ring.setVaultStateGetter(() => mockState.vault);
    instances.push(ring);
    wallet.localPasskeyControls?.set(ring, owned);
    return { ring, controls: owned };
  };
  const createdRing = createRing(),
    keyring = createdRing.ring,
    controls = createdRing.controls;
  let activeKeyring = keyring;
  await keyring.initializeSession(PHRASE, PASSWORD);
  mockState.vault.accounts.HDAccount[0] = await keyring.createFirstAccount();
  Object.assign(wallet, {
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    authenticationMutex: new AsyncMutex(),
    localPasskeyControls: new WeakMap([[keyring, controls]]),
    keyrings: new Map([[60, keyring]]),
    createKeyringOnDemand: () => createRing().ring,
    failedUnlockAttempts: 0,
    lastFailedUnlockTime: 0,
    rateLimitInitialized: false,
    RATE_LIMIT_STORAGE_KEY: 'pali_rate_limit_state',
    MAX_FAILED_ATTEMPTS: 10,
    LOCKOUT_DURATION: 300000,
    getActiveKeyring: () => activeKeyring,
    getWalletSetupStatus: () => false,
    prepareWalletRecoveryAccess: async () => undefined,
    setFiat: async () => undefined,
    getLatestUpdateForCurrentAccount: async () => undefined,
  });
  const authenticator = await createLocalPasskeyResponseFixture(ORIGIN);
  const controllers: LocalPasskeyController[] = [];
  const open = () => {
    const lifetime = new AbortController();
    const controller = wallet.createLocalPasskeyController({
      signal: lifetime.signal,
      assertCurrent() {
        if (lifetime.signal.aborted) throw Error('retired document');
      },
    });
    controllers.push(controller);
    return { controller, lifetime };
  };
  const finish = async (
    controller: LocalPasskeyController,
    initial: LocalPasskeyStep
  ) => {
    let step = initial;
    while (step.kind !== 'complete')
      step = await controller.complete(
        step.operationId,
        step.ceremonyId,
        await authenticator.respond(step)
      );
    return step;
  };
  return {
    wallet,
    keyring,
    controls,
    records,
    open,
    finish,
    authenticator,
    createRing,
    select(ring: any) {
      activeKeyring = ring;
    },
    async close() {
      await Promise.all(controllers.map((controller) => controller.dispose()));
      await Promise.all(instances.map((ring) => ring.lockWallet()));
    },
  };
}

test('actual SDK passkey enrollment and resume reuse unlock completion and preserve the extension session', async () => {
  const f = await fixture();
  try {
    const first = f.open().controller;
    const enrollment = await first.beginEnrollment(PASSWORD);
    mockState.vault.accounts.HDAccount[0] = {
      ...mockState.vault.accounts.HDAccount[0],
      balances: { ethereum: { balance: 12 } },
    };
    expect((await f.finish(first, enrollment)).success).toBe(true);
    expect(await first.status()).toEqual({ enabled: true });
    expect(JSON.stringify(f.records)).not.toContain(PHRASE);
    expect(JSON.stringify(f.records)).not.toContain(PASSWORD);
    await first.dispose();
    expect(f.keyring.isUnlocked()).toBe(true);
    await f.keyring.lockWallet();
    f.wallet.advanceWalletSession();
    const unlock = jest.spyOn(f.keyring, 'unlock');
    const second = f.open().controller;
    expect((await f.finish(second, await second.beginUnlock())).success).toBe(
      true
    );
    expect(f.keyring.isUnlocked()).toBe(true);
    expect(unlock).not.toHaveBeenCalled();
    expect(clearNavigationState).toHaveBeenCalledTimes(1);
    expect(getController().dapp.handleStateChange).toHaveBeenCalledTimes(1);
    await second.dispose();
    expect(f.keyring.isUnlocked()).toBe(true);
    const disable = f.open().controller;
    await disable.disable(PASSWORD);
    expect(await disable.status()).toEqual({ enabled: false });
    expect(f.keyring.isUnlocked()).toBe(true);
  } finally {
    await f.close();
  }
});

test('a stale account, vault pair or document cannot install a resumed session', async () => {
  const f = await fixture();
  try {
    const enrolled = f.open().controller;
    expect(
      (await f.finish(enrolled, await enrolled.beginEnrollment(PASSWORD)))
        .success
    ).toBe(true);
    await enrolled.dispose();
    await f.keyring.lockWallet();
    f.wallet.advanceWalletSession();
    const { controller, lifetime } = f.open();
    const prompt = await controller.beginUnlock();
    if (prompt.kind === 'complete') throw Error('Missing real assertion');
    lifetime.abort();
    await expect(
      controller.complete(
        prompt.operationId,
        prompt.ceremonyId,
        await f.authenticator.respond(prompt)
      )
    ).rejects.toThrow();
    expect(f.keyring.isUnlocked()).toBe(false);
    const original = mockState.vault.accounts.HDAccount[0];
    const account = f.open().controller;
    const accountPrompt = await account.beginUnlock();
    if (accountPrompt.kind === 'complete')
      throw Error('Missing real assertion');
    mockState.vault.accounts.HDAccount[0] = {
      ...original,
      address: '0x2222222222222222222222222222222222222222',
    };
    await expect(
      account.complete(
        accountPrompt.operationId,
        accountPrompt.ceremonyId,
        await f.authenticator.respond(accountPrompt)
      )
    ).rejects.toThrow();
    expect(f.keyring.isUnlocked()).toBe(false);
    mockState.vault.accounts.HDAccount[0] = original;
    const changed = f.open().controller;
    const next = await changed.beginUnlock();
    if (next.kind === 'complete') throw Error('Missing real assertion');
    f.records['sysweb3-vault'] = 'replacement ciphertext';
    await expect(
      changed.complete(
        next.operationId,
        next.ceremonyId,
        await f.authenticator.respond(next)
      )
    ).rejects.toThrow();
    expect(f.keyring.isUnlocked()).toBe(false);
  } finally {
    await f.close();
  }
});

test('a definitive bad password is accounted once but cancelled ceremonies never unlock', async () => {
  const f = await fixture();
  try {
    const entered = deferred(),
      release = deferred();
    f.wallet.localPasskeyControls.set(f.keyring, {
      ...f.controls,
      async issue(password: string, guard: () => void) {
        const result = await f.controls.issue(password, guard);
        entered.resolve();
        await release.promise;
        return result;
      },
    });
    const controller = f.open().controller;
    const failed = controller.beginEnrollment('wrong password');
    const rejected = expect(failed).rejects.toThrow();
    await entered.promise;
    const cancelled = controller.cancel();
    release.resolve();
    await cancelled;
    await rejected;
    expect(f.records.pali_rate_limit_state).toMatchObject({
      failedAttempts: 1,
    });
    expect(f.authenticator.requests).toBe(0);
    expect(await f.open().controller.status()).toEqual({ enabled: false });
  } finally {
    await f.close();
  }
});

test('returning through the real SDK uses a fresh recipient and never revives retired passkey controls', async () => {
  const f = await fixture();
  try {
    const enrollment = f.open().controller;
    expect(
      (await f.finish(enrollment, await enrollment.beginEnrollment(PASSWORD)))
        .success
    ).toBe(true);
    await enrollment.dispose();
    const middle = f.createRing().ring;
    (
      await f.keyring.prepareSessionTransfer(middle, () => undefined)
    ).transfer();
    f.select(middle);
    f.wallet.advanceWalletSession();
    await expect(f.controls.issue(PASSWORD, () => undefined)).rejects.toThrow(
      'Device unlock session changed'
    );
    const target = await f.wallet.createFreshTransferTarget(
      60,
      () => undefined
    );
    expect(target).not.toBe(f.keyring);
    (await middle.prepareSessionTransfer(target, () => undefined)).transfer();
    f.select(target);
    f.wallet.advanceWalletSession();
    await target.lockWallet();
    const returned = f.open().controller;
    expect(
      (await f.finish(returned, await returned.beginUnlock())).success
    ).toBe(true);
    expect(target.isUnlocked()).toBe(true);
    await expect(f.controls.resume(() => undefined)).rejects.toThrow(
      'Device unlock session changed'
    );
  } finally {
    await f.close();
  }
});

test('an unsupported browser origin leaves ordinary password unlock available', async () => {
  const f = await fixture();
  try {
    await f.keyring.lockWallet();
    jest
      .mocked(chrome.runtime.getURL)
      .mockImplementation((path) => `moz-extension://public-fixture/${path}`);
    expect(() => f.open()).toThrow('LOCAL_PASSKEY_UNAVAILABLE');
    await expect(f.wallet.unlockFromController(PASSWORD)).resolves.toBe(true);
    expect(f.keyring.isUnlocked()).toBe(true);
  } finally {
    await f.close();
  }
});

test('one document cannot overlap another SDK credential operation and disposal releases the queue', async () => {
  const f = await fixture();
  try {
    const first = f.open().controller,
      second = f.open().controller;
    const oldPrompt = await first.beginEnrollment(PASSWORD);
    expect(oldPrompt.kind).toBe('create');
    let delivered = false;
    const queued = second.beginEnrollment(PASSWORD).then((value) => {
      delivered = true;
      return value;
    });
    for (let index = 0; index < 10; index++) await Promise.resolve();
    expect(delivered).toBe(false);
    await first.dispose();
    expect((await f.finish(second, await queued)).success).toBe(true);
    expect(await second.status()).toEqual({ enabled: true });
    expect(f.keyring.isUnlocked()).toBe(true);
  } finally {
    await f.close();
  }
});
