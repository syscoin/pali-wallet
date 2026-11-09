import type { SentryLinkedNode } from '../shared/sentryNodeLookup.ts';

export type SentryCollateralReservation = {
  pendingRegistration?: true;
  proTxHash?: string;
  txid: string;
  vout: number;
};
export type SentryCollateralAdmission = {
  generation: number;
  key: string;
};
export const isSentryCollateralReservation = (
  item: SentryCollateralReservation
) =>
  item &&
  /^[0-9a-f]{64}$/.test(item.txid) &&
  (item.proTxHash === undefined
    ? item.pendingRegistration === true
    : /^[0-9a-f]{64}$/.test(item.proTxHash)) &&
  Number.isSafeInteger(item.vout) &&
  item.vout >= 0 &&
  item.vout <= 0xffffffff;

export function createSentryCollateralCoordinator() {
  let tail = Promise.resolve();
  return {
    generations: new Map<string, number>(),
    async runExclusive<T>(operation: () => T | Promise<T>): Promise<T> {
      const before = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await before;
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
}
export type SentryCollateralScope = Readonly<{
  genesisHash: string;
  walletIdentity: string;
}>;
export type SentryCollateralHost = Readonly<{
  keyFor(scope: SentryCollateralScope): Promise<string>;
  read(key: string): Promise<unknown>;
  // Commit only against the exact observation returned by read, under the live owner.
  write(
    key: string,
    items: SentryCollateralReservation[],
    assertCurrent: () => void,
    expectedRaw: unknown,
    node?: SentryLinkedNode
  ): Promise<void>;
}>;
export function inspectSentryCollateral(
  value: unknown
): SentryCollateralReservation[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    !value.every(isSentryCollateralReservation)
  )
    throw new Error('Invalid Sentry collateral registry; spending is blocked');
  return value.map((entry) => ({ ...entry }));
}
/** One coordinator spans all managers and final spend admissions for a host. */
export function createSentryCollateralRegistry(
  host: SentryCollateralHost,
  coordinator: ReturnType<typeof createSentryCollateralCoordinator>
) {
  const { generations } = coordinator;
  const mutex = coordinator;
  const keyFor = (walletIdentity: string, genesisHash: string) => {
    if (!/^[0-9a-f]{64}$/.test(genesisHash))
      throw new Error('Invalid Sentry network genesis');
    return host.keyFor({ walletIdentity, genesisHash });
  };
  const captureSentryCollateralAdmission = async (params: {
    genesisHash: string;
    walletIdentity: string;
  }): Promise<SentryCollateralAdmission> => {
    const key = await keyFor(params.walletIdentity, params.genesisHash);
    const generation = generations.get(key) || 0;
    if (generation % 2)
      throw new Error(
        'A wallet transaction authorization is in progress. Start the Sentry operation again.'
      );
    return { key, generation };
  };

  /** No prompt or signing belongs inside this short final admission boundary. */
  const withSentryCollateralBroadcast = async <T>(
    params: { genesisHash: string; walletIdentity: string },
    broadcast: (markInvoked: () => void) => Promise<T>
  ): Promise<T> => {
    const key = await keyFor(params.walletIdentity, params.genesisHash);
    return mutex.runExclusive(async () => {
      let invoked = false;
      const generation = generations.get(key) || 0;
      try {
        return await broadcast(() => {
          if (!invoked) {
            invoked = true;
            generations.set(key, generation + 1);
          }
        });
      } finally {
        // A disclosed signature or ambiguous send invalidates earlier reviews.
        if (invoked) generations.set(key, generation + 2);
      }
    });
  };

  /** Releasing a signature gives its recipient the ability to broadcast later. */
  const withSentryCollateralSignatureRelease = withSentryCollateralBroadcast;

  const readSentryCollateralReservations = async (params: {
    genesisHash: string;
    walletIdentity: string;
  }) => {
    const expectedRaw = await host.read(
      await keyFor(params.walletIdentity, params.genesisHash)
    );
    return { items: inspectSentryCollateral(expectedRaw), expectedRaw };
  };
  const getSentryCollateralReservations = async (params: {
    genesisHash: string;
    walletIdentity: string;
  }): Promise<SentryCollateralReservation[]> =>
    (await readSentryCollateralReservations(params)).items;

  /** Registered collateral is not released when a signing key is removed. */
  const reserveSentryCollateral = async (params: {
    admission: SentryCollateralAdmission;
    assertCurrent: () => void;
    genesisHash: string;
    linkedNode?: SentryLinkedNode;
    reservation: SentryCollateralReservation;
    walletIdentity: string;
  }) =>
    mutex.runExclusive(async () => {
      const key = await keyFor(params.walletIdentity, params.genesisHash);
      if (
        params.admission.key !== key ||
        params.admission.generation % 2 ||
        params.admission.generation !== (generations.get(key) || 0)
      )
        throw new Error(
          'A wallet transaction changed the Sentry approval. Start the operation again.'
        );
      if (!isSentryCollateralReservation(params.reservation))
        throw new Error('Invalid registered Sentry collateral');
      const { items, expectedRaw } = await readSentryCollateralReservations(
        params
      );
      params.assertCurrent();
      const sameNode =
        params.reservation.proTxHash &&
        items.find((entry) => entry.proTxHash === params.reservation.proTxHash);
      const existing = items.find(
        (entry) =>
          entry.txid === params.reservation.txid &&
          entry.vout === params.reservation.vout
      );
      if (
        sameNode &&
        (sameNode.txid !== params.reservation.txid ||
          sameNode.vout !== params.reservation.vout)
      )
        throw new Error('Registered Sentry collateral changed unexpectedly');
      if (
        existing?.proTxHash &&
        params.reservation.proTxHash &&
        existing.proTxHash !== params.reservation.proTxHash
      )
        throw new Error('Registered Sentry collateral changed unexpectedly');
      if (
        params.linkedNode &&
        (params.linkedNode.proTxHash !== params.reservation.proTxHash ||
          params.linkedNode.collateralOutpoint.txid !==
            params.reservation.txid ||
          params.linkedNode.collateralOutpoint.vout !== params.reservation.vout)
      )
        throw new Error('Sentry node differs from its collateral');
      if (
        params.linkedNode ||
        !existing ||
        (existing.pendingRegistration && params.reservation.proTxHash)
      ) {
        if (!existing && items.length >= 1000)
          throw new Error(
            'The protected Sentry collateral limit has been reached'
          );
        if (existing) items.splice(items.indexOf(existing), 1);
        items.push({ ...params.reservation });
        await host.write(
          key,
          items,
          params.assertCurrent,
          expectedRaw,
          params.linkedNode
        );
        params.assertCurrent();
      }
    });

  /** Explicit trusted-wallet action only; removing a signer never calls this. */
  const releaseSentryCollateral = async (params: {
    assertCurrent: () => void;
    genesisHash: string;
    reservation: SentryCollateralReservation;
    walletIdentity: string;
  }) =>
    mutex.runExclusive(async () => {
      if (!isSentryCollateralReservation(params.reservation))
        throw new Error('Invalid Sentry collateral reservation');
      const { items, expectedRaw } = await readSentryCollateralReservations(
        params
      );
      params.assertCurrent();
      const remaining = items.filter(
        (entry) =>
          entry.txid !== params.reservation.txid ||
          entry.vout !== params.reservation.vout ||
          entry.proTxHash !== params.reservation.proTxHash ||
          entry.pendingRegistration !== params.reservation.pendingRegistration
      );
      if (remaining.length === items.length)
        throw new Error('Sentry collateral reservation was not found');
      const key = await keyFor(params.walletIdentity, params.genesisHash);
      await host.write(key, remaining, params.assertCurrent, expectedRaw);
      params.assertCurrent();
    });

  return Object.freeze({
    captureSentryCollateralAdmission,
    withSentryCollateralBroadcast,
    withSentryCollateralSignatureRelease,
    getSentryCollateralReservations,
    reserveSentryCollateral,
    releaseSentryCollateral,
  });
}
export type SentryCollateralRegistry = ReturnType<
  typeof createSentryCollateralRegistry
>;
