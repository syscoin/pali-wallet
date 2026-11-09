import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { SENTRY_NETWORKS } from '../../../../source/shared/sentryNetworks.ts';
import { readSentryServiceSettings } from '../../../../source/shared/sentrySettings.ts';
import {
  createSentryCollateralRegistry,
  type SentryCollateralScope,
  type createSentryCollateralCoordinator,
  type SentryCollateralReservation,
} from '../../../../source/wallet/sentryCollateral.ts';
import {
  createSentryNodeManagement,
  type SentryNodeLinkReview,
} from '../../../../source/wallet/sentryNodeManagement.ts';
import {
  emptySentryNodeStore,
  type SentryNodeStorage,
  type SentryNodeStore,
} from '../storage/sentryNodeDomain.ts';
import {
  WalletStorageError,
  type SentryStorageScope,
} from '../storage/types.ts';

export type { SentryNodeLinkReview } from '../../../../source/wallet/sentryNodeManagement.ts';
type CollateralPorts = Readonly<{
  assertCurrent(): void;
  coordinator: ReturnType<typeof createSentryCollateralCoordinator>;
  rootPublicIdentity: string;
  scope: SentryStorageScope;
  storage: SentryNodeStorage;
}>;

/** Bound storage observations stay inside custody; the shared core receives public arrays only. */
export function createNativeSentryCollateral(ports: CollateralPorts) {
  const scope = Object.freeze({ ...ports.scope });
  const genesisHash = SENTRY_NETWORKS[scope.network].genesisHash;
  const key = `sentry-collateral-v1:${scope.vaultId}:${genesisHash}`;
  const check = () => assertSynchronousEvmFeeGuard(ports.assertCurrent);
  check();
  const observations = new WeakMap<object, SentryNodeStore>();
  const collateralScope: SentryCollateralScope = Object.freeze({
    walletIdentity: ports.rootPublicIdentity,
    genesisHash,
  });
  const registry = createSentryCollateralRegistry(
    {
      async keyFor(owner) {
        check();
        if (
          owner.walletIdentity !== collateralScope.walletIdentity ||
          owner.genesisHash !== genesisHash
        )
          throw new WalletStorageError('STORAGE_CHANGED');
        return key;
      },
      async read(candidate) {
        check();
        if (candidate !== key) throw new WalletStorageError('STORAGE_CHANGED');
        const stored = await ports.storage.read();
        check();
        if (stored) observations.set(stored.collateral, stored);
        return stored?.collateral;
      },
      async write(candidate, next, assertOperation, expectedRaw, node) {
        const guard = () => {
          check();
          assertSynchronousEvmFeeGuard(assertOperation);
          check();
        };
        guard();
        if (candidate !== key) throw new WalletStorageError('STORAGE_CHANGED');
        const before =
          expectedRaw === undefined
            ? undefined
            : typeof expectedRaw === 'object' && expectedRaw !== null
            ? observations.get(expectedRaw)
            : undefined;
        if (expectedRaw !== undefined && !before)
          throw new WalletStorageError('STORAGE_CHANGED');
        if (before) observations.delete(expectedRaw as object);
        const previous = before ?? emptySentryNodeStore(scope);
        const linkedNodes = node
          ? [
              ...previous.linkedNodes.filter(
                (item) => item.proTxHash !== node.proTxHash
              ),
              node,
            ]
          : previous.linkedNodes;
        await ports.storage.compareAndSet(
          before,
          { ...previous, collateral: next, linkedNodes },
          guard
        );
        guard();
      },
    },
    ports.coordinator
  );
  return Object.freeze({ registry, scope: collateralScope });
}

type NodePorts = CollateralPorts &
  Readonly<{
    authenticate(password: string, check: () => void): Promise<void>;
    fetch: typeof globalThis.fetch;
    lifetime: AbortSignal;
    readSettings(): Promise<unknown>;
    run<T>(operation: () => Promise<T>): Promise<T>;
  }>;

/** Foreground adapter for the same link/release workflow used by the extension. */
export function createNativeSentryNodeManagement(ports: NodePorts) {
  let disposed = false;
  const owner = Object.freeze({ network: ports.scope.network });
  const check = () => {
    assertSynchronousEvmFeeGuard(ports.assertCurrent);
    if (disposed || ports.lifetime.aborted) throw new Error('CANCELLED');
  };
  check();
  const collateral = createNativeSentryCollateral({
    ...ports,
    assertCurrent: check,
  });
  const manager = createSentryNodeManagement({
    captureScope: () => {
      check();
      return owner;
    },
    assertCurrent: (captured) => {
      check();
      if (captured !== owner) throw new Error('CANCELLED');
    },
    network: () => owner.network,
    async readSettings() {
      check();
      const stored = await ports.storage.read();
      check();
      const settings = readSentryServiceSettings(
        await ports.readSettings(),
        owner.network
      );
      check();
      return {
        network: owner.network,
        serviceUrl: settings.serviceUrl,
        linkedNodes: stored?.linkedNodes ?? [],
        collateral: stored?.collateral ?? [],
      };
    },
    fetch: ports.fetch,
    captureAdmission: () =>
      collateral.registry.captureSentryCollateralAdmission(collateral.scope),
    commitLink: (_scope, { admission, node }, assertCurrent) =>
      collateral.registry.reserveSentryCollateral({
        ...collateral.scope,
        admission,
        assertCurrent,
        reservation: { ...node.collateralOutpoint, proTxHash: node.proTxHash },
        linkedNode: node,
      }),
    authenticate: (_scope, password, assertCurrent) =>
      ports.authenticate(password, assertCurrent),
    releaseCollateral: (_scope, _network, reservation, assertCurrent) =>
      collateral.registry.releaseSentryCollateral({
        ...collateral.scope,
        reservation,
        assertCurrent,
      }),
    runExclusive: ports.run,
    now: Date.now,
    createId: () => globalThis.crypto.randomUUID(),
  });
  const dispose = () => {
    disposed = true;
    ports.lifetime.removeEventListener('abort', dispose);
    manager.dispose();
  };
  ports.lifetime.addEventListener('abort', dispose, { once: true });
  return Object.freeze({
    list: () => ports.run(() => manager.list()),
    prepareLink: (proTxHash: string) =>
      ports.run(() =>
        manager.prepareLink(
          {
            version: 1,
            proTxHash,
            genesisHash: SENTRY_NETWORKS[owner.network].genesisHash,
          },
          'Pali Wallet'
        )
      ),
    confirmLink: (review: SentryNodeLinkReview) => manager.confirmLink(review),
    cancelLink: manager.cancelLink,
    releaseCollateral: (
      params: Readonly<{
        reservation: SentryCollateralReservation;
        password: string;
        acknowledgeNodeStops: true;
      }>
    ) => manager.releaseCollateral(params),
    dispose,
  });
}
export type NativeSentryNodeManagement = ReturnType<
  typeof createNativeSentryNodeManagement
>;
