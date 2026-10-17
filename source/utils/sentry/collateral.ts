import { AsyncMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import { getSentryVaultId } from './keyStore';

export interface SentryCollateralReservation {
  pendingRegistration?: true;
  proTxHash?: string;
  txid: string;
  vout: number;
}
const mutex = new AsyncMutex();
const generations = new Map<string, number>();
export interface SentryCollateralAdmission {
  generation: number;
  key: string;
}
const keyFor = async (walletIdentity: string, genesisHash: string) => {
  if (!/^[0-9a-f]{64}$/.test(genesisHash))
    throw new Error('Invalid Sentry network genesis');
  return `sentry-collateral-v1:${await getSentryVaultId(
    walletIdentity
  )}:${genesisHash}`;
};
const valid = (item: SentryCollateralReservation) =>
  item &&
  /^[0-9a-f]{64}$/.test(item.txid) &&
  (item.proTxHash === undefined
    ? item.pendingRegistration === true
    : /^[0-9a-f]{64}$/.test(item.proTxHash)) &&
  Number.isSafeInteger(item.vout) &&
  item.vout >= 0 &&
  item.vout <= 0xffffffff;

export const captureSentryCollateralAdmission = async (params: {
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
export const withSentryCollateralBroadcast = async <T>(
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
export const withSentryCollateralSignatureRelease =
  withSentryCollateralBroadcast;

export const getSentryCollateralReservations = async (params: {
  genesisHash: string;
  walletIdentity: string;
}): Promise<SentryCollateralReservation[]> => {
  const value = await chromeStorage.getItem(
    await keyFor(params.walletIdentity, params.genesisHash)
  );
  if (!value) return [];
  if (!Array.isArray(value) || value.length > 1000 || !value.every(valid))
    throw new Error('Invalid Sentry collateral registry; spending is blocked');
  return value.map((entry) => ({ ...entry }));
};

/** Registered collateral is not released when a signing key is removed. */
export const reserveSentryCollateral = async (params: {
  admission: SentryCollateralAdmission;
  assertCurrent: () => void;
  genesisHash: string;
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
    if (!valid(params.reservation))
      throw new Error('Invalid registered Sentry collateral');
    const items = await getSentryCollateralReservations(params);
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
      !existing ||
      (existing.pendingRegistration && params.reservation.proTxHash)
    ) {
      if (!existing && items.length >= 1000)
        throw new Error(
          'The protected Sentry collateral limit has been reached'
        );
      if (existing) items.splice(items.indexOf(existing), 1);
      items.push({ ...params.reservation });
      await chromeStorage.setItem(
        await keyFor(params.walletIdentity, params.genesisHash),
        items
      );
      params.assertCurrent();
    }
  });

/** Explicit trusted-wallet action only; removing a signer never calls this. */
export const releaseSentryCollateral = async (params: {
  assertCurrent: () => void;
  genesisHash: string;
  reservation: SentryCollateralReservation;
  walletIdentity: string;
}) =>
  mutex.runExclusive(async () => {
    if (!valid(params.reservation))
      throw new Error('Invalid Sentry collateral reservation');
    const items = await getSentryCollateralReservations(params);
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
    await chromeStorage.setItem(
      await keyFor(params.walletIdentity, params.genesisHash),
      remaining
    );
    params.assertCurrent();
  });
