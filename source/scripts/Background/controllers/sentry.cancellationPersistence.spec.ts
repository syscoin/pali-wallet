import { webcrypto } from 'crypto';

import { walletPersistenceGate } from 'state/paliStorage';
import { walletPersistenceMutex } from 'utils/asyncMutex';
import { getSentryCollateralReservations } from 'utils/sentry/collateral';
import { listSentryKeys, loadSentryKey } from 'utils/sentry/keyStore';
import { SENTRY_NETWORKS } from 'utils/sentry/network';
import { runSentryCrypto } from 'utils/sentry/workerClient';

import { SentryController, SentryWalletScope } from './sentry';

jest.unmock('syscoinjs-lib');

// This public transaction was built and reviewed by installed sentry 0.1.2.
// Keep the ESM SDK/worker boundary synthetic; the controller, collateral
// registry, persistence mutex and callback-based Chrome adapter are real.
jest.mock(
  '@sidhujag/sysweb3-sentry',
  () => ({
    validateSentryManagementRequest: (value: unknown) => value,
    inspectSentryManagementOperation: () => ({
      operation: 'register',
      collateral: {
        txid: 'dd08aab52fd536450b0b90ce888f4ebe9cfb3dd7630204fb86a4f886811a6f93',
        vout: 0,
      },
      inputTxids: [
        '69abe16cfc966de344fba86ff444631e875e66335781688b92eb2b5aad5221c7',
      ],
    }),
    sentryKeyId: () => '751e76e8199196d454941c45d1b3a323f1433bd6',
  }),
  { virtual: true }
);
jest.mock('utils/sentry/keyStore', () => ({
  ...jest.requireActual('utils/sentry/keyStore'),
  listSentryKeys: jest.fn(),
  loadSentryKey: jest.fn(),
}));
jest.mock('utils/sentry/workerClient', () => ({
  runSentryCrypto: jest.fn(),
}));

const request = {
  version: 1 as const,
  operation: 'register' as const,
  chain: {
    genesisHash: SENTRY_NETWORKS.mainnet.genesisHash,
    era: 'legacy-v3' as const,
  },
  transactionHex:
    '5000000001c72152ad5a2beb928b68815733665e871e6344f46fa8fb44e36d96fc6ce1ab690000000000feffffff02b88201000000000016001422222222222222222222222222222222222222220000000000000000fd13016a4d0f01020000000000936f1a8186f8a486fb040263d73dfb9cbe4e8f88ce900b0b4536d52fb5aa08dd0000000000000000000000000000ffff0102030420b13333333333333333333333333333333333333333bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb4444444444444444444444444444444444444444000016001433333333333333333333333333333333333333337de5ddc17389a3324d6cb59caba03e38629de5ce05419d315ab9b924cc93a75341000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
};
const fundingTransaction =
  '020000000105050505050505050505050505050505050505050505050505050505050505050000000000ffffffff01a086010000000000160014222222222222222222222222222222222222222200000000';
const collateralTransaction =
  '020000000104040404040404040404040404040404040404040404040404040404040404040000000000ffffffff0100e8764817000000160014751e76e8199196d454941c45d1b3a323f1433bd600000000';
const reservation = {
  txid: 'dd08aab52fd536450b0b90ce888f4ebe9cfb3dd7630204fb86a4f886811a6f93',
  vout: 0,
  pendingRegistration: true as const,
};
const summary = {
  id: '41d783a1-b56b-43da-9b18-5f717c77fb38',
  network: 'mainnet',
  role: 'collateral',
  scheme: 'secp256k1',
  publicKey:
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  label: 'Synthetic collateral',
};
const signedResponse = {
  version: 1,
  operation: 'register',
  transactionHex: request.transactionHex,
  signedAuthorization: 'collateral',
  complete: true,
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const records = new Map<string, unknown>();
let scope: SentryWalletScope;
let controller: SentryController;
let getSeed: jest.Mock;
const originalFetch = global.fetch;
const originalCrypto = Object.getOwnPropertyDescriptor(global, 'crypto');

const collateralScope = () => ({
  walletIdentity: scope.rootPublicIdentity,
  genesisHash: request.chain.genesisHash,
});
const sign = (id: string) =>
  controller.sign({
    id,
    keyId: summary.id,
    password: 'synthetic-password',
    authorizationId: 'collateral',
  });
const signingCalls = () =>
  (runSentryCrypto as jest.Mock).mock.calls.filter(
    ([job]) => job.type === 'signManagement'
  );
const holdSeed = () => {
  const started = deferred<void>();
  const held = deferred<string>();
  getSeed.mockImplementationOnce(() => {
    started.resolve();
    return held.promise;
  });
  return {
    started: started.promise,
    release: () => held.resolve('synthetic-seed'),
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  records.clear();
  walletPersistenceGate.blocked = false;
  Object.defineProperty(global, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  (chrome.storage.local.get as jest.Mock).mockImplementation(
    (keys: string[], callback: (items: Record<string, unknown>) => void) => {
      callback(
        Object.fromEntries(
          keys
            .filter((key) => records.has(key))
            .map((key) => [key, records.get(key)])
        )
      );
    }
  );
  (chrome.storage.local.set as jest.Mock).mockImplementation(
    (items: Record<string, unknown>, callback: () => void) => {
      for (const [key, value] of Object.entries(items))
        records.set(key, JSON.parse(JSON.stringify(value)));
      callback();
    }
  );
  scope = {
    identity: 'synthetic-wallet-session',
    rootPublicIdentity: 'synthetic-root-public-identity',
    network: { kind: 'syscoin', chainId: 57, url: 'https://blockbook.test' },
  };
  getSeed = jest.fn().mockResolvedValue('synthetic-seed');
  controller = new SentryController({ captureScope: () => scope, getSeed });
  (listSentryKeys as jest.Mock).mockResolvedValue([summary]);
  (loadSentryKey as jest.Mock).mockResolvedValue({
    ...summary,
    secretKey: '11'.repeat(32),
  });
  (runSentryCrypto as jest.Mock).mockImplementation(
    async (job, assertCurrent) => {
      assertCurrent();
      if (job.type === 'reviewOperation')
        return {
          operation: 'register',
          chain: request.chain,
          feeSatoshis: '1000',
          outputs: [],
          fields: { collateral: `${reservation.txid}:0` },
          authorizations: [
            {
              id: 'collateral',
              role: 'collateral',
              scheme: 'secp256k1',
              keyIdentity: '751e76e8199196d454941c45d1b3a323f1433bd6',
              digest:
                'efc3251f422f3a170c40163d846dda17953edcf07613c00ca1c59dfd7c34ac3d',
              signed: false,
            },
          ],
        };
      if (job.type !== 'signManagement')
        throw new Error('Unexpected crypto job');
      expect(await getSentryCollateralReservations(collateralScope())).toEqual([
        reservation,
      ]);
      return signedResponse;
    }
  );
  global.fetch = jest.fn().mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('/context?')
            ? {
                chain: request.chain,
                registration: {
                  collateralTransactionHex: collateralTransaction,
                  collateralVout: 0,
                  requiredCollateralSatoshis: '100000000000',
                },
              }
            : { hex: fundingTransaction }
        )
      )
  );
});

afterAll(() => {
  global.fetch = originalFetch;
  if (originalCrypto) Object.defineProperty(global, 'crypto', originalCrypto);
});

it('persists approved registration protection before signing and exposes it after controller recreation', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  await expect(sign(id)).resolves.toEqual(signedResponse);
  expect(signingCalls()).toHaveLength(1);
  expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  controller = new SentryController({ captureScope: () => scope, getSeed });
  expect((await controller.getSettings()).collateral).toEqual([reservation]);
});

it('does not reserve or sign when cancellation wins while the password read is pending', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  const held = holdSeed();
  const signing = sign(id);
  await held.started;
  controller.cancel(id); // The normal popupPromise cleanup calls this method.
  held.release();
  await expect(signing).rejects.toThrow(/expired|cancelled/);
  expect({
    stored: await getSentryCollateralReservations(collateralScope()),
    signingJobs: signingCalls().length,
    writes: (chrome.storage.local.set as jest.Mock).mock.calls.length,
  }).toEqual({ stored: [], signingJobs: 0, writes: 0 });
});

it('stops before reservation and signing if cancelled during the fresh context read', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  const started = deferred<void>();
  const held = deferred<Response>();
  const ordinaryFetch = (global.fetch as jest.Mock).getMockImplementation()!;
  const response = await ordinaryFetch('https://sentry.test/context?');
  (global.fetch as jest.Mock).mockImplementationOnce(() => {
    started.resolve();
    return held.promise;
  });
  const signing = sign(id);
  await started.promise;
  controller.cancel(id);
  held.resolve(response);
  await expect(signing).rejects.toThrow(/expired|cancelled/);
  expect({
    stored: await getSentryCollateralReservations(collateralScope()),
    signingJobs: signingCalls().length,
    writes: (chrome.storage.local.set as jest.Mock).mock.calls.length,
  }).toEqual({ stored: [], signingJobs: 0, writes: 0 });
});

it('stops before reservation and signing if cancelled during the key read', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  const started = deferred<void>();
  const held = deferred<unknown>();
  (loadSentryKey as jest.Mock).mockImplementationOnce(() => {
    started.resolve();
    return held.promise;
  });
  const signing = sign(id);
  await started.promise;
  controller.cancel(id);
  held.resolve({ ...summary, secretKey: '11'.repeat(32) });
  await expect(signing).rejects.toThrow(/expired|cancelled/);
  expect({
    stored: await getSentryCollateralReservations(collateralScope()),
    signingJobs: signingCalls().length,
    writes: (chrome.storage.local.set as jest.Mock).mock.calls.length,
  }).toEqual({ stored: [], signingJobs: 0, writes: 0 });
});

it('does not admit a new native write after cancellation while waiting for the shared persistence lock', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  const lockEntered = deferred<void>();
  const lockHeld = deferred<void>();
  const locked = walletPersistenceMutex.runExclusive(() => {
    lockEntered.resolve();
    return lockHeld.promise;
  });
  await lockEntered.promise;
  const reservationRead = deferred<void>();
  const ordinaryGet = (
    chrome.storage.local.get as jest.Mock
  ).getMockImplementation()!;
  let collateralReads = 0;
  (chrome.storage.local.get as jest.Mock).mockImplementation(
    (keys, callback) => {
      ordinaryGet(keys, callback);
      if (keys.some((key: string) => key.startsWith('sentry-collateral-v1:'))) {
        collateralReads += 1;
        // First is fresh settings; second is the actual reservation admission.
        if (collateralReads === 2) reservationRead.resolve();
      }
    }
  );
  const signing = sign(id);
  try {
    await reservationRead.promise;
    controller.cancel(id);
  } finally {
    lockHeld.resolve();
    await locked;
  }
  await expect(signing).rejects.toThrow(/expired|cancelled/);
  expect({
    stored: await getSentryCollateralReservations(collateralScope()),
    signingJobs: signingCalls().length,
    writes: (chrome.storage.local.set as jest.Mock).mock.calls.length,
  }).toEqual({ stored: [], signingJobs: 0, writes: 0 });
});

it('refuses a pre-cancelled approval without reading the password or writing', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  controller.cancel(id);
  await expect(sign(id)).rejects.toThrow(/expired/);
  expect(getSeed).not.toHaveBeenCalled();
  expect(signingCalls()).toHaveLength(0);
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});

it('rejects a changed wallet scope before reserving or signing', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  const held = holdSeed();
  const signing = sign(id);
  await held.started;
  scope = { ...scope, identity: 'replacement-session' };
  held.release();
  await expect(signing).rejects.toThrow(/session changed/);
  expect(signingCalls()).toHaveLength(0);
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});

it('allows a fresh approved attempt to reuse existing protection without a duplicate write', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  await sign(id);
  const again = await controller.prepare(request, 'https://dapp.test');
  await expect(sign(again)).resolves.toEqual(signedResponse);
  expect(signingCalls()).toHaveLength(2);
  expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  expect(await getSentryCollateralReservations(collateralScope())).toEqual([
    reservation,
  ]);
});

it('retains a native write already admitted before cancellation and starts no later signing job', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  const entered = deferred<void>();
  const held = deferred<void>();
  const ordinarySet = (
    chrome.storage.local.set as jest.Mock
  ).getMockImplementation()!;
  (chrome.storage.local.set as jest.Mock).mockImplementationOnce(
    (items, callback) => {
      entered.resolve();
      void held.promise.then(() => ordinarySet(items, callback));
    }
  );
  const signing = sign(id);
  await entered.promise;
  controller.cancel(id);
  held.resolve();
  await expect(signing).rejects.toThrow(/expired|cancelled/);
  expect({
    stored: await getSentryCollateralReservations(collateralScope()),
    signingJobs: signingCalls().length,
    writes: (chrome.storage.local.set as jest.Mock).mock.calls.length,
  }).toEqual({ stored: [reservation], signingJobs: 0, writes: 1 });
});

it('retains already committed protection if cancellation occurs after crypto starts, without exposing a response', async () => {
  const id = await controller.prepare(request, 'https://dapp.test');
  const started = deferred<void>();
  const held = deferred<typeof signedResponse>();
  const ordinaryCrypto = (
    runSentryCrypto as jest.Mock
  ).getMockImplementation()!;
  (runSentryCrypto as jest.Mock).mockImplementation(
    async (job, assertCurrent) => {
      if (job.type !== 'signManagement')
        return ordinaryCrypto(job, assertCurrent);
      assertCurrent();
      expect(await getSentryCollateralReservations(collateralScope())).toEqual([
        reservation,
      ]);
      started.resolve();
      return held.promise;
    }
  );
  const signing = sign(id);
  await started.promise;
  controller.cancel(id);
  held.resolve(signedResponse);
  await expect(signing).rejects.toThrow(/expired|cancelled/);
  expect(await getSentryCollateralReservations(collateralScope())).toEqual([
    reservation,
  ]);
  expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
});
