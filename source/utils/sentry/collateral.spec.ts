import { webcrypto } from 'crypto';

import { chromeStorage } from 'utils/storageAPI';

import {
  getSentryCollateralReservations,
  releaseSentryCollateral,
  reserveSentryCollateral,
} from './collateral';

jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));
const records = new Map();
const scope = { walletIdentity: 'xpub-test', genesisHash: 'a1'.repeat(32) };
const reservation = {
  txid: 'b2'.repeat(32),
  vout: 1,
  proTxHash: 'c3'.repeat(32),
};
beforeEach(() => {
  Object.defineProperty(global, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  records.clear();
  jest.clearAllMocks();
  (chromeStorage.getItem as jest.Mock).mockImplementation(async (key) =>
    records.get(key)
  );
  (chromeStorage.setItem as jest.Mock).mockImplementation(async (key, value) =>
    records.set(key, value)
  );
});

it('explicit release removes only the exact acknowledged outpoint', async () => {
  await reserveSentryCollateral({
    ...scope,
    reservation,
    assertCurrent: () => undefined,
  });
  const other = {
    ...reservation,
    txid: 'ff'.repeat(32),
    proTxHash: 'ee'.repeat(32),
  };
  await reserveSentryCollateral({
    ...scope,
    reservation: other,
    assertCurrent: () => undefined,
  });
  await releaseSentryCollateral({
    ...scope,
    reservation,
    assertCurrent: () => undefined,
  });
  expect(await getSentryCollateralReservations(scope)).toEqual([other]);
});

it('protects a pending registration without inventing a node hash and upgrades it on confirmed linking', async () => {
  const pending = {
    txid: reservation.txid,
    vout: reservation.vout,
    pendingRegistration: true as const,
  };
  await reserveSentryCollateral({
    ...scope,
    reservation: pending,
    assertCurrent: () => undefined,
  });
  expect(await getSentryCollateralReservations(scope)).toEqual([pending]);
  expect(
    (await getSentryCollateralReservations(scope))[0].proTxHash
  ).toBeUndefined();
  await reserveSentryCollateral({
    ...scope,
    reservation,
    assertCurrent: () => undefined,
  });
  expect(await getSentryCollateralReservations(scope)).toEqual([reservation]);
  await expect(
    releaseSentryCollateral({
      ...scope,
      reservation: pending,
      assertCurrent: () => undefined,
    })
  ).rejects.toThrow('not found');
  expect(await getSentryCollateralReservations(scope)).toEqual([reservation]);
});
it('persists one reservation per verified registered node with vault/network isolation', async () => {
  const params = { ...scope, reservation, assertCurrent: () => undefined };
  await Promise.all([
    reserveSentryCollateral(params),
    reserveSentryCollateral(params),
  ]);
  expect(await getSentryCollateralReservations(scope)).toEqual([reservation]);
  expect(
    await getSentryCollateralReservations({
      ...scope,
      genesisHash: 'd4'.repeat(32),
    })
  ).toEqual([]);
  expect(
    await getSentryCollateralReservations({
      ...scope,
      walletIdentity: 'another-wallet',
    })
  ).toEqual([]);
});
it('fails closed on corrupt registry or unexpected collateral reassignment', async () => {
  await reserveSentryCollateral({
    ...scope,
    reservation,
    assertCurrent: () => undefined,
  });
  await expect(
    reserveSentryCollateral({
      ...scope,
      reservation: { ...reservation, vout: 2 },
      assertCurrent: () => undefined,
    })
  ).rejects.toThrow('changed unexpectedly');
  records.set([...records.keys()][0], [{ ...reservation, vout: -1 }]);
  await expect(getSentryCollateralReservations(scope)).rejects.toThrow(
    'spending is blocked'
  );
});

it('refuses a 1001st reservation without making the existing registry unreadable', async () => {
  const entries = Array.from({ length: 1000 }, (_, index) => ({
    txid: index.toString(16).padStart(64, '0'),
    vout: 0,
    pendingRegistration: true as const,
  }));
  (chromeStorage.getItem as jest.Mock).mockResolvedValue(entries);
  await expect(
    reserveSentryCollateral({
      ...scope,
      reservation,
      assertCurrent: () => undefined,
    })
  ).rejects.toThrow('limit has been reached');
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
  expect(await getSentryCollateralReservations(scope)).toHaveLength(1000);
  await reserveSentryCollateral({
    ...scope,
    reservation: {
      ...entries[0],
      pendingRegistration: undefined,
      proTxHash: 'ef'.repeat(32),
    },
    assertCurrent: () => undefined,
  });
  expect(chromeStorage.setItem).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining([
      expect.objectContaining({ proTxHash: 'ef'.repeat(32) }),
    ])
  );
});
