import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeGuard.ts';
import {
  normalizeSentryServiceUrl,
  SENTRY_NETWORKS,
  type SentryNetwork,
} from '../shared/sentryNetworks.ts';
import {
  isSentryLinkedNode,
  readSentryNode,
  type SentryLinkedNode,
} from '../shared/sentryNodeLookup.ts';

import {
  inspectSentryCollateral,
  isSentryCollateralReservation,
  type SentryCollateralAdmission,
  type SentryCollateralReservation,
} from './sentryCollateral.ts';

export type SentryNodeLinkReview = Readonly<{
  id: string;
  network: SentryNetwork;
  node: SentryLinkedNode;
  origin: string;
  serviceUrl: string;
}>;
export type SentryNodeManagementSettings = Readonly<{
  collateral: readonly SentryCollateralReservation[];
  linkedNodes: readonly SentryLinkedNode[];
  network: SentryNetwork;
  serviceUrl: string;
}>;
export type SentryNodeLinkResult = Readonly<{
  genesisHash: string;
  linked: true;
  proTxHash: string;
  version: 1;
}>;
export type SentryNodeManagementHost<Scope> = Readonly<{
  assertCurrent(scope: Scope): void;
  authenticate(
    scope: Scope,
    password: string,
    assertCurrent: () => void
  ): Promise<void>;
  captureAdmission(
    scope: Scope,
    network: SentryNetwork,
    assertCurrent: () => void
  ): Promise<SentryCollateralAdmission>;
  captureLinkScope(origin: string): Readonly<{
    assertCurrent(): void;
    scope: Scope;
  }>;
  captureScope(): Scope;
  /** Atomically retain this node and its collateral against the exact host observation. */
  commitLink(
    scope: Scope,
    link: Readonly<{
      admission: SentryCollateralAdmission;
      network: SentryNetwork;
      node: SentryLinkedNode;
    }>,
    assertCurrent: () => void
  ): Promise<void>;
  createId(): string;
  fetch(url: string, init: RequestInit): Promise<Response>;
  network(scope: Scope): SentryNetwork;
  now(): number;
  readSettings(scope: Scope): Promise<SentryNodeManagementSettings>;
  releaseCollateral(
    scope: Scope,
    network: SentryNetwork,
    reservation: SentryCollateralReservation,
    assertCurrent: () => void
  ): Promise<void>;
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
}>;

const APPROVAL_TTL_MS = 10 * 60 * 1000;
const copyNode = (node: SentryLinkedNode): SentryLinkedNode =>
  Object.freeze({
    proTxHash: node.proTxHash,
    service: node.service,
    nevmAddress: node.nevmAddress,
    collateralOutpoint: Object.freeze({ ...node.collateralOutpoint }),
  });
const sameNode = (left: SentryLinkedNode, right: SentryLinkedNode) =>
  left.proTxHash === right.proTxHash &&
  left.service === right.service &&
  left.nevmAddress === right.nevmAddress &&
  left.collateralOutpoint.txid === right.collateralOutpoint.txid &&
  left.collateralOutpoint.vout === right.collateralOutpoint.vout;

/** Public identity linking and explicit protection release, without signing ports. */
export function createSentryNodeManagement<Scope>(
  host: SentryNodeManagementHost<Scope>
) {
  if (typeof host.captureLinkScope !== 'function')
    throw new Error('Sentry link request-authority port is required');
  type Pending = {
    admission: SentryCollateralAdmission;
    assertRequestCurrent(): void;
    committing: boolean;
    controller: AbortController;
    expiresAt: number;
    review: SentryNodeLinkReview;
    scope: Scope;
  };
  const links = new Map<string, Pending>();
  const reads = new Set<AbortController>();
  let disposed = false;
  const assertCurrent = (scope: Scope) => {
    if (disposed) throw new Error('This Sentry node manager was closed');
    host.assertCurrent(scope);
  };
  const settings = async (scope: Scope, check: () => void) => {
    check();
    const value = await host.readSettings(scope);
    check();
    if (
      !Object.hasOwn(SENTRY_NETWORKS, value.network) ||
      value.network !== host.network(scope) ||
      (value.serviceUrl !== '' &&
        normalizeSentryServiceUrl(value.serviceUrl) !== value.serviceUrl) ||
      !Array.isArray(value.linkedNodes) ||
      value.linkedNodes.length > 1000 ||
      !value.linkedNodes.every(isSentryLinkedNode)
    )
      throw new Error('Invalid linked Sentry registry');
    return Object.freeze({
      network: value.network,
      serviceUrl: value.serviceUrl,
      linkedNodes: Object.freeze(value.linkedNodes.map(copyNode)),
      collateral: Object.freeze(
        inspectSentryCollateral(value.collateral).map((item) =>
          Object.freeze(item)
        )
      ),
    });
  };
  const retire = (id: string) => {
    const link = links.get(id);
    // A confirmed host commit owns its short atomic persistence boundary.
    if (link && !link.committing) {
      links.delete(id);
      link.controller.abort();
    }
  };
  const getPending = (id: string) => {
    const link = links.get(id);
    if (!link || link.expiresAt <= host.now())
      throw new Error('This Sentry link approval expired');
    assertCurrent(link.scope);
    assertSynchronousEvmFeeGuard(link.assertRequestCurrent);
    return link;
  };
  const readNode = async (
    network: SentryNetwork,
    serviceUrl: string,
    proTxHash: string,
    controller: AbortController,
    check: () => void
  ) => {
    reads.add(controller);
    try {
      return (
        await readSentryNode(
          { network, origin: serviceUrl, proTxHash },
          {
            assertCurrent: check,
            fetch: (url, init) => host.fetch(url, init),
            signal: controller.signal,
          }
        )
      ).node;
    } catch (error) {
      check();
      throw error;
    } finally {
      reads.delete(controller);
    }
  };
  return Object.freeze({
    async list(): Promise<SentryNodeManagementSettings> {
      const scope = host.captureScope();
      return settings(scope, () => assertCurrent(scope));
    },
    async prepareLink(
      raw: unknown,
      origin: string
    ): Promise<SentryNodeLinkReview> {
      const requestScope = host.captureLinkScope(origin);
      const { scope } = requestScope;
      const check = () => {
        assertCurrent(scope);
        assertSynchronousEvmFeeGuard(requestScope.assertCurrent);
      };
      check();
      const network = host.network(scope);
      const request = raw as {
        genesisHash?: unknown;
        proTxHash?: unknown;
        version?: unknown;
      };
      if (
        !request ||
        typeof request !== 'object' ||
        Object.keys(request).some(
          (key) => !['version', 'proTxHash', 'genesisHash'].includes(key)
        ) ||
        request.version !== 1 ||
        typeof request.proTxHash !== 'string' ||
        !/^[a-fA-F0-9]{64}$/.test(request.proTxHash)
      )
        throw new Error('Supply a versioned Sentry node identity only');
      const admission = await host.captureAdmission(scope, network, check);
      check();
      const initial = await settings(scope, check);
      if (initial.network !== network)
        throw new Error('Sentry network changed after review');
      if (request.genesisHash !== SENTRY_NETWORKS[initial.network].genesisHash)
        throw new Error(
          'Switch to the requested Syscoin network before linking this node'
        );
      if (!initial.serviceUrl)
        throw new Error(
          'Configure a trusted Sentry data service in wallet settings first'
        );
      const controller = new AbortController();
      const node = await readNode(
        initial.network,
        initial.serviceUrl,
        request.proTxHash.toLowerCase(),
        controller,
        check
      );
      check();
      for (const [id, link] of links) {
        let stale = link.expiresAt <= host.now();
        try {
          host.assertCurrent(link.scope);
        } catch {
          stale = true;
        }
        if (stale) retire(id);
      }
      if (links.size >= 8) throw new Error('Too many pending Sentry links');
      const id = host.createId();
      if (!id || links.has(id))
        throw new Error('Unable to create a Sentry link approval');
      const review = Object.freeze({
        id,
        origin,
        network: initial.network,
        serviceUrl: initial.serviceUrl,
        node: copyNode(node),
      });
      links.set(id, {
        admission,
        scope,
        assertRequestCurrent: requestScope.assertCurrent,
        controller,
        expiresAt: host.now() + APPROVAL_TTL_MS,
        committing: false,
        review,
      });
      return review;
    },
    getLinkApproval(id: string): SentryNodeLinkReview {
      return getPending(id).review;
    },
    cancelLink: retire,
    async confirmLink(
      review: SentryNodeLinkReview
    ): Promise<SentryNodeLinkResult> {
      const link = getPending(review.id);
      if (link.review !== review)
        throw new Error('This Sentry link review changed');
      return host.runExclusive(async () => {
        const check = () => {
          host.assertCurrent(link.scope);
          assertSynchronousEvmFeeGuard(link.assertRequestCurrent);
          if (
            links.get(review.id) !== link ||
            (!link.committing && (disposed || link.expiresAt <= host.now()))
          )
            throw new Error(
              'This Sentry link approval was cancelled or expired'
            );
        };
        check();
        const fresh = await settings(link.scope, check);
        if (
          fresh.network !== review.network ||
          fresh.serviceUrl !== review.serviceUrl
        )
          throw new Error(
            'Sentry state changed after review. Link the node again.'
          );
        const node = await readNode(
          review.network,
          review.serviceUrl,
          review.node.proTxHash,
          link.controller,
          check
        );
        check();
        const latest = await settings(link.scope, check);
        if (
          !sameNode(node, review.node) ||
          latest.network !== review.network ||
          latest.serviceUrl !== review.serviceUrl
        )
          throw new Error(
            'Sentry state changed after review. Link the node again.'
          );
        if (
          latest.linkedNodes.filter(
            (item) => item.proTxHash !== review.node.proTxHash
          ).length >= 1000
        )
          throw new Error('The linked Sentry node limit has been reached');
        check();
        link.committing = true;
        try {
          await host.commitLink(
            link.scope,
            {
              admission: link.admission,
              network: review.network,
              node: review.node,
            },
            check
          );
          check();
          links.delete(review.id);
          return Object.freeze({
            version: 1,
            linked: true,
            proTxHash: review.node.proTxHash,
            genesisHash: SENTRY_NETWORKS[review.network].genesisHash,
          });
        } finally {
          link.committing = false;
        }
      });
    },
    async releaseCollateral(params: {
      acknowledgeNodeStops: boolean;
      password: string;
      reservation: SentryCollateralReservation;
    }): Promise<SentryCollateralReservation> {
      const scope = host.captureScope();
      const check = () => assertCurrent(scope);
      check();
      if (params.acknowledgeNodeStops !== true)
        throw new Error('Confirm that spending collateral will stop this node');
      const { txid, vout, proTxHash, pendingRegistration } = params.reservation;
      const reservation = Object.freeze({
        txid,
        vout,
        proTxHash,
        pendingRegistration,
      });
      if (!isSentryCollateralReservation(reservation))
        throw new Error('Invalid Sentry collateral reservation');
      return host.runExclusive(async () => {
        check();
        await host.authenticate(scope, params.password, check);
        check();
        const network = host.network(scope);
        await host.releaseCollateral(scope, network, reservation, check);
        check();
        return reservation;
      });
    },
    dispose() {
      disposed = true;
      for (const id of links.keys()) retire(id);
      for (const controller of reads) controller.abort();
    },
  });
}
