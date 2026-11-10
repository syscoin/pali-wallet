import { createSentryNodeManagement } from '../../wallet/sentryNodeManagement';

import {
  captureSentryCollateralAdmission,
  releaseSentryCollateral,
  reserveSentryCollateral,
} from './collateral';
import { getSentryNetwork, SENTRY_NETWORKS } from './network';
import type { SentrySettings } from './types';

type ExtensionSentryScope = {
  network: { chainId: number; kind?: string; url: string };
  rootPublicIdentity: string;
};

/** Storage and authentication ports for the shared public-node lifecycle. */
export function createExtensionSentryNodeManagement<
  Scope extends ExtensionSentryScope
>(host: {
  assertCurrent(scope: Scope): void;
  authenticate(password: string): Promise<unknown>;
  captureLinkScope(origin: string): Readonly<{
    assertCurrent(): void;
    scope: Scope;
  }>;
  captureScope(): Scope;
  readSettings(scope: Scope): Promise<SentrySettings>;
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
}) {
  return createSentryNodeManagement({
    assertCurrent: (scope: Scope) => host.assertCurrent(scope),
    authenticate: async (_scope, password, check) => {
      if (typeof password !== 'string')
        throw new Error('Password authentication is required');
      check();
      await host.authenticate(password);
      check();
    },
    captureScope: () => host.captureScope(),
    captureLinkScope: (origin) => host.captureLinkScope(origin),
    captureAdmission: async (scope, network, check) => {
      check();
      if (getSentryNetwork(scope.network) !== network)
        throw new Error('Sentry network changed after review');
      const admission = await captureSentryCollateralAdmission({
        walletIdentity: scope.rootPublicIdentity,
        genesisHash: SENTRY_NETWORKS[network].genesisHash,
      });
      check();
      return admission;
    },
    commitLink: (scope, { admission, network, node }, check) =>
      reserveSentryCollateral({
        admission,
        walletIdentity: scope.rootPublicIdentity,
        genesisHash: SENTRY_NETWORKS[network].genesisHash,
        reservation: { ...node.collateralOutpoint, proTxHash: node.proTxHash },
        linkedNode: node,
        assertCurrent: check,
      }),
    createId: () => crypto.randomUUID(),
    fetch: (url, init) => fetch(url, init),
    network: (scope) => getSentryNetwork(scope.network),
    now: () => Date.now(),
    readSettings: (scope) => host.readSettings(scope),
    releaseCollateral: (scope, network, reservation, check) =>
      releaseSentryCollateral({
        walletIdentity: scope.rootPublicIdentity,
        genesisHash: SENTRY_NETWORKS[network].genesisHash,
        reservation,
        assertCurrent: check,
      }),
    runExclusive: (operation) => host.runExclusive(operation),
  });
}
