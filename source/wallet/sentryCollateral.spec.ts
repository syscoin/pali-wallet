import {
  createSentryCollateralCoordinator,
  createSentryCollateralRegistry,
  type SentryCollateralHost,
  type SentryCollateralReservation,
} from './sentryCollateral';

const scope = {
  walletIdentity: 'public-wallet-root',
  genesisHash: 'ab'.repeat(32),
};
const reservation = {
  txid: 'cd'.repeat(32),
  vout: 1,
  proTxHash: 'ef'.repeat(32),
};
const keyFor = ({ walletIdentity, genesisHash }: typeof scope) =>
  `${walletIdentity}:${genesisHash}`;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture(initial?: SentryCollateralReservation[]) {
  const records = new Map<string, unknown>([[keyFor(scope), initial]]);
  let current = true;
  const assertCurrent = () => {
    if (!current) throw new Error('Wallet authority changed');
  };
  const host: SentryCollateralHost = {
    keyFor: async (value) => keyFor(value),
    read: jest.fn(async (key) => records.get(key)),
    write: jest.fn(async (key, items, check, expected) => {
      check();
      if (records.get(key) !== expected) throw new Error('Storage changed');
      records.set(key, items);
    }),
  };
  const coordinator = createSentryCollateralCoordinator();
  const registry = createSentryCollateralRegistry(host, coordinator);
  const otherManager = createSentryCollateralRegistry(host, coordinator);
  return {
    records,
    host,
    registry,
    otherManager,
    assertCurrent,
    expire: () => {
      current = false;
    },
  };
}

it('commits against the exact observed record without mutating the stored array during review', async () => {
  const pending = {
    txid: reservation.txid,
    vout: reservation.vout,
    pendingRegistration: true as const,
  };
  const observed = [pending];
  const f = fixture(observed);
  const node = {
    proTxHash: reservation.proTxHash,
    collateralOutpoint: { txid: reservation.txid, vout: reservation.vout },
    service: '127.0.0.1:8369',
    nevmAddress: '',
  };
  await f.registry.reserveSentryCollateral({
    ...scope,
    reservation,
    linkedNode: node,
    admission: await f.registry.captureSentryCollateralAdmission(scope),
    assertCurrent: f.assertCurrent,
  });
  expect(observed).toEqual([pending]);
  expect(f.host.write).toHaveBeenCalledWith(
    keyFor(scope),
    [reservation],
    f.assertCurrent,
    observed,
    node
  );
  const committed = f.records.get(keyFor(scope));
  await f.registry.releaseSentryCollateral({
    ...scope,
    reservation,
    assertCurrent: f.assertCurrent,
  });
  expect(f.host.write).toHaveBeenLastCalledWith(
    keyFor(scope),
    [],
    f.assertCurrent,
    committed
  );
});

it('preserves a competing reservation when the host refuses a stale observation', async () => {
  const f = fixture([]);
  const competing = [
    { ...reservation, txid: '12'.repeat(32), proTxHash: '34'.repeat(32) },
  ];
  (f.host.read as jest.Mock).mockImplementationOnce(async (key) => {
    const observed = f.records.get(key);
    f.records.set(key, competing);
    return observed;
  });
  await expect(
    f.registry.reserveSentryCollateral({
      ...scope,
      reservation,
      admission: await f.registry.captureSentryCollateralAdmission(scope),
      assertCurrent: f.assertCurrent,
    })
  ).rejects.toThrow('Storage changed');
  expect(f.records.get(keyFor(scope))).toBe(competing);
});

it.each(['reserve', 'release'] as const)(
  'refuses %s after authority changes while reading storage',
  async (operation) => {
    const observed = [reservation];
    const f = fixture(observed);
    (f.host.read as jest.Mock).mockImplementationOnce(async () => {
      f.expire();
      return observed;
    });
    const admission = await f.registry.captureSentryCollateralAdmission(scope);
    await expect(
      operation === 'reserve'
        ? f.registry.reserveSentryCollateral({
            ...scope,
            reservation,
            admission,
            assertCurrent: f.assertCurrent,
          })
        : f.registry.releaseSentryCollateral({
            ...scope,
            reservation,
            assertCurrent: f.assertCurrent,
          })
    ).rejects.toThrow('Wallet authority changed');
    expect(f.host.write).not.toHaveBeenCalled();
    expect(f.records.get(keyFor(scope))).toBe(observed);
  }
);

it('serializes reservations from separate managers sharing the host coordinator', async () => {
  const f = fixture();
  const other = {
    ...reservation,
    txid: '12'.repeat(32),
    proTxHash: '34'.repeat(32),
  };
  const admission = await f.registry.captureSentryCollateralAdmission(scope);
  await Promise.all([
    f.registry.reserveSentryCollateral({
      ...scope,
      reservation,
      admission,
      assertCurrent: f.assertCurrent,
    }),
    f.otherManager.reserveSentryCollateral({
      ...scope,
      reservation: other,
      admission,
      assertCurrent: f.assertCurrent,
    }),
  ]);
  expect(await f.registry.getSentryCollateralReservations(scope)).toEqual([
    reservation,
    other,
  ]);
});

describe.each([
  'withSentryCollateralBroadcast',
  'withSentryCollateralSignatureRelease',
] as const)('%s across managers', (operation) => {
  it.each(['acknowledged', 'ambiguous'])(
    '%s invocation invalidates old and mid-flight admissions, with scope isolation',
    async (outcome) => {
      const f = fixture();
      const admission = await f.registry.captureSentryCollateralAdmission(
        scope
      );
      const otherScope = { ...scope, walletIdentity: 'different-wallet-root' };
      const otherAdmission = await f.registry.captureSentryCollateralAdmission(
        otherScope
      );
      const invoked = deferred(),
        finish = deferred();
      const sending = f.registry[operation](scope, async (markInvoked) => {
        markInvoked();
        markInvoked();
        invoked.resolve();
        await finish.promise;
        if (outcome === 'ambiguous') throw new Error('Outcome unknown');
        return 'acknowledged';
      });
      const result = sending.catch((error: Error) => error.message);
      await invoked.promise;
      await expect(
        f.otherManager.captureSentryCollateralAdmission(scope)
      ).rejects.toThrow('authorization is in progress');
      const refused = expect(
        f.otherManager.reserveSentryCollateral({
          ...scope,
          reservation,
          admission,
          assertCurrent: f.assertCurrent,
        })
      ).rejects.toThrow('changed the Sentry approval');
      finish.resolve();
      expect(await result).toBe(
        outcome === 'ambiguous' ? 'Outcome unknown' : 'acknowledged'
      );
      await refused;
      expect(
        (await f.otherManager.captureSentryCollateralAdmission(scope))
          .generation
      ).toBe(admission.generation + 2);
      await f.otherManager.reserveSentryCollateral({
        ...otherScope,
        reservation,
        admission: otherAdmission,
        assertCurrent: f.assertCurrent,
      });
      expect(await f.registry.getSentryCollateralReservations(scope)).toEqual(
        []
      );
      expect(
        await f.registry.getSentryCollateralReservations(otherScope)
      ).toEqual([reservation]);
    }
  );

  it('keeps the prior admission when authorization fails before disclosure', async () => {
    const f = fixture();
    const admission = await f.registry.captureSentryCollateralAdmission(scope);
    await expect(
      f.registry[operation](scope, async () => {
        throw new Error('Authority changed');
      })
    ).rejects.toThrow('Authority changed');
    await f.otherManager.reserveSentryCollateral({
      ...scope,
      reservation,
      admission,
      assertCurrent: f.assertCurrent,
    });
    expect(await f.registry.getSentryCollateralReservations(scope)).toEqual([
      reservation,
    ]);
  });
});
