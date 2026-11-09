import { jsonStorageEqual } from '../../shared/jsonStorageEqual';
import { SENTRY_NETWORKS } from '../../shared/sentryNetworks';
import { isSentryLinkedNode } from '../../shared/sentryNodeLookup';
import {
  createSentryCollateralCoordinator,
  createSentryCollateralRegistry,
} from '../../wallet/sentryCollateral';
import { chromeStorage } from 'utils/storageAPI';

import { getSentryVaultId } from './keyStore';
import { withSentryPersistence } from './persistence';
export type {
  SentryCollateralReservation,
  SentryCollateralAdmission,
} from '../../wallet/sentryCollateral';

// getItem masks falsy values; only actual Chrome absence is an empty registry.
const readSentryCollateral = async (key: string) =>
  (await chromeStorage.getItems([key]))[key] ?? undefined;

// Preserve the released extension namespace and array representation.
export const {
  captureSentryCollateralAdmission,
  withSentryCollateralBroadcast,
  withSentryCollateralSignatureRelease,
  getSentryCollateralReservations,
  reserveSentryCollateral,
  releaseSentryCollateral,
} = createSentryCollateralRegistry(
  {
    keyFor: async ({ walletIdentity, genesisHash }) =>
      `sentry-collateral-v1:${await getSentryVaultId(
        walletIdentity
      )}:${genesisHash}`,
    read: readSentryCollateral,
    write: (key, items, assertCurrent, expectedRaw, linkedNode) =>
      withSentryPersistence(assertCurrent, async () => {
        const current = await readSentryCollateral(key);
        assertCurrent();
        if (!jsonStorageEqual(current, expectedRaw))
          throw new Error('Sentry collateral storage changed. Start again.');
        if (!linkedNode) {
          await chromeStorage.setItem(key, items);
          return;
        }
        const scope =
          /^sentry-collateral-v1:([0-9a-f]{64}):([0-9a-f]{64})$/.exec(key);
        const network = Object.entries(SENTRY_NETWORKS).find(
          ([, value]) => value.genesisHash === scope?.[2]
        )?.[0];
        if (!scope || !network || !isSentryLinkedNode(linkedNode))
          throw new Error('Invalid linked Sentry registry');
        const nodeKey = `sentry-linked-v1:${scope[1]}:${network}`;
        const nodes = (await chromeStorage.getItems([nodeKey]))[nodeKey] ?? [];
        assertCurrent();
        if (
          !Array.isArray(nodes) ||
          nodes.length > 1000 ||
          !nodes.every(isSentryLinkedNode)
        )
          throw new Error('Invalid linked Sentry registry');
        const nextNodes = nodes.filter(
          (node) => node.proTxHash !== linkedNode.proTxHash
        );
        if (nextNodes.length >= 1000)
          throw new Error('The linked Sentry node limit has been reached');
        nextNodes.push(linkedNode);
        await chromeStorage.setItems({ [key]: items, [nodeKey]: nextNodes });
      }),
  },
  createSentryCollateralCoordinator()
);
