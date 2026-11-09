import isEqual from 'lodash/isEqual.js';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeGuard.ts';
import { SENTRY_NETWORKS } from '../shared/sentryNetworks.ts';

import type { SentryOperationHost } from './sentryApprovalHost.ts';
import type {
  SentryApprovalScope,
  SentryApproval,
  SentrySettings,
} from './sentryApprovalTypes.ts';
import type { SentryCollateralAdmission } from './sentryCollateral.ts';
import {
  SentryFeeAuthorizations,
  type SentryFeeReview,
} from './sentryFeeAuthorizations.ts';
import type {
  SentryOperationRequest,
  SentryManagementRequest,
  SentryManagementContext,
  SentryAuthorityKey,
  SentryReviewContext,
  SentryOperationResponse,
  SentryManagementResponse,
  SentryRequiredAuthorization,
} from '@sidhujag/sysweb3-sentry';

type Pending = {
  admission: SentryCollateralAdmission;
  context: SentryManagementContext;
  expiresAt: number;
  publicApproval: SentryApproval;
  scope: SentryApprovalScope;
  signing: boolean;
};
const APPROVAL_TTL_MS = 10 * 60 * 1000;
const loadSdk = () =>
  import(
    /* webpackChunkName: "sentry-sdk", webpackExports: ["inspectSentryOperation", "inspectSentryManagementOperation", "validateSentryOperationRequest", "validateSentryManagementRequest", "sentryKeyId"] */
    '@sidhujag/sysweb3-sentry'
  );

const inputIds = (
  request: SentryOperationRequest | SentryManagementRequest
) => {
  const transaction = syscoinUtils.bitcoinjs.Transaction.fromHex(
    request.transactionHex
  );
  if (!transaction.ins.length || transaction.ins.length > 32)
    throw new Error('Sentry updates require between 1 and 32 funding inputs');
  return [
    ...new Set<string>(
      transaction.ins.map((input: any) =>
        Buffer.from(input.hash).reverse().toString('hex')
      )
    ),
  ];
};

/** Existing operation and exact fee-authorization lifecycle, shared by both hosts. */
export class SharedSentryOperationApprovals {
  private readonly feeAuthorizations = new SentryFeeAuthorizations();
  private readonly approvals = new Map<string, Pending>();
  private readonly host: SentryOperationHost;
  constructor(host: SentryOperationHost) {
    this.host = host;
  }
  private assertCurrent(scope: SentryApprovalScope) {
    assertSynchronousEvmFeeGuard(() => this.host.assertCurrent(scope));
  }
  public clear() {
    this.approvals.clear();
    this.feeAuthorizations.clear();
  }

  private async context(
    scope: SentryApprovalScope,
    request: SentryOperationRequest | SentryManagementRequest
  ): Promise<{
    context: SentryManagementContext;
    settings: SentrySettings;
  }> {
    const sdk = await loadSdk();
    const settings = await this.host.getSettings(scope);
    this.assertCurrent(scope);
    if (settings.network !== this.host.network(scope))
      throw new Error('Sentry network changed. Start the operation again.');
    if (!settings.serviceUrl)
      throw new Error(
        'Configure a trusted Sentry data service in wallet settings first'
      );
    const inspection =
      request.operation === 'updateService'
        ? sdk.inspectSentryOperation(request)
        : sdk.inspectSentryManagementOperation(request);
    const query = new URLSearchParams({ network: settings.network });
    if (inspection.proTxHash) query.set('proTxHash', inspection.proTxHash);
    else if ('collateral' in inspection && inspection.collateral) {
      query.set('collateralTxid', inspection.collateral.txid);
      query.set('collateralVout', String(inspection.collateral.vout));
    } else
      throw new Error(
        'Sentry operation does not identify its node or collateral'
      );
    const observation = await this.host.readJson(
      `${settings.serviceUrl}/api/sentry/v1/context?${query}`,
      65536,
      scope,
      () => this.assertCurrent(scope)
    );
    this.assertCurrent(scope);
    if (
      observation?.chain?.genesisHash !==
      SENTRY_NETWORKS[settings.network].genesisHash
    )
      throw new Error(
        'The Sentry data service returned a different network genesis'
      );
    const collateral =
      observation.node?.collateralOutpoint ||
      ('collateral' in inspection ? inspection.collateral : undefined);
    if (
      !collateral ||
      !/^[0-9a-f]{64}$/.test(collateral.txid) ||
      !Number.isSafeInteger(collateral.vout) ||
      collateral.vout < 0
    )
      throw new Error(
        'The Sentry data service did not provide registered collateral'
      );
    const transaction = syscoinUtils.bitcoinjs.Transaction.fromHex(
      request.transactionHex
    );
    if (
      transaction.ins.some(
        (input: any) =>
          Buffer.from(input.hash).reverse().toString('hex') ===
            collateral.txid && input.index === collateral.vout
      )
    )
      throw new Error('Sentry collateral cannot fund a service update');
    const previousTransactions = await Promise.all(
      inputIds(request).map(async (txid) => {
        const tx = await this.host.readJson(
          `${scope.network.url.replace(/\/$/, '')}/api/v2/tx/${txid}`,
          2 * 1024 * 1024,
          scope,
          () => this.assertCurrent(scope)
        );
        const raw = tx?.hex;
        if (typeof raw !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(raw))
          throw new Error(
            'The selected Blockbook did not provide the raw funding transaction'
          );
        return raw;
      })
    );
    this.assertCurrent(scope);
    return {
      settings,
      context: {
        chain: observation.chain,
        node: observation.node,
        network: SENTRY_NETWORKS[settings.network].encoding,
        allowOperatorPreparation: observation.allowOperatorPreparation === true,
        allowOwnerPreparation: observation.allowOwnerPreparation === true,
        registration: observation.registration,
        previousTransactions,
        maxFeeSatoshis: settings.maxFeeSatoshis,
      },
    };
  }

  public async prepare(rawRequest: unknown, origin: string): Promise<string> {
    const scope = this.host.captureScope();
    const admission = await this.host.captureCollateralAdmission(scope);
    this.assertCurrent(scope);
    const sdk = await loadSdk();
    const request =
      (rawRequest as { operation?: unknown })?.operation === 'updateService'
        ? sdk.validateSentryOperationRequest(rawRequest)
        : sdk.validateSentryManagementRequest(rawRequest);
    const { context, settings } = await this.context(scope, request);
    const review = await this.host.runCrypto<SentryFeeReview>(
      { type: 'reviewOperation', request, context },
      () => this.assertCurrent(scope)
    );
    if (
      review.operation === 'updateService' &&
      review.changes.nevmAddress.previous !== review.changes.nevmAddress.next
    ) {
      const status = context.node as typeof context.node & {
        confirmedHash?: string;
        poseBanHeight?: number;
      };
      if (
        !status?.confirmedHash ||
        !/^[0-9a-f]{64}$/i.test(status.confirmedHash) ||
        /^0+$/.test(status.confirmedHash) ||
        !Number.isSafeInteger(status.poseBanHeight) ||
        status.poseBanHeight! >= 0
      )
        throw new Error(
          'An NEVM address change requires a confirmed, non-banned Sentry node'
        );
    }
    const keys: SentryApproval['keys'] =
      'authorizations' in review
        ? settings.keys.flatMap((key) =>
            review.authorizations
              .filter(
                (auth) =>
                  !auth.signed &&
                  key.role === auth.role &&
                  key.scheme === auth.scheme &&
                  (key.scheme === 'secp256k1'
                    ? sdk.sentryKeyId(key.publicKey)
                    : key.publicKey) === auth.keyIdentity
              )
              .map((auth) => ({ ...key, authorizationId: auth.id }))
          )
        : settings.keys.filter(
            (key) =>
              key.role === 'operator' &&
              key.scheme === review.scheme &&
              key.publicKey === context.node!.operatorPublicKey
          );
    if ('authorizations' in review) {
      for (const auth of review.authorizations) {
        const address =
          auth.scheme === 'secp256k1'
            ? syscoinUtils.bitcoinjs.address.toBase58Check(
                Buffer.from(auth.keyIdentity, 'hex'),
                SENTRY_NETWORKS[settings.network].encoding.pubKeyHash
              )
            : '';
        if (
          !auth.signed &&
          auth.scheme === 'secp256k1' &&
          (await this.host.hasWalletAuthority(address, scope))
        )
          keys.push({
            id: `wallet-${auth.id}`,
            label: 'Selected wallet account',
            network: settings.network,
            role: auth.role,
            scheme: auth.scheme,
            publicKey: '',
            authorizationId: auth.id,
          });
      }
    }
    this.assertCurrent(scope);
    for (const [id, pending] of this.approvals)
      if (
        pending.expiresAt <= Date.now() ||
        pending.scope.identity !== scope.identity
      )
        this.approvals.delete(id);
    if (this.approvals.size >= 8)
      throw new Error('Too many pending Sentry approvals');
    const id = crypto.randomUUID();
    this.approvals.set(id, {
      admission,
      scope,
      context,
      expiresAt: Date.now() + APPROVAL_TTL_MS,
      signing: false,
      publicApproval: {
        id,
        origin,
        serviceUrl: settings.serviceUrl,
        network: settings.network,
        request,
        review,
        keys,
      },
    });
    return id;
  }

  private pending(id: string) {
    const pending = this.approvals.get(id);
    if (!pending || pending.expiresAt <= Date.now()) {
      this.approvals.delete(id);
      throw new Error(
        'This Sentry approval expired. Start again from the dapp.'
      );
    }
    this.assertCurrent(pending.scope);
    return pending;
  }

  public getApproval(id: string): SentryApproval {
    return this.pending(id).publicApproval;
  }

  public cancel(id: string) {
    this.approvals.delete(id);
  }

  public prepareFeePsbt(transactionHex: string, origin: string): string {
    return this.feeAuthorizations.find(
      transactionHex,
      origin,
      this.host.captureScope().identity
    );
  }

  public beginFeeSigning(id: string, transactionHex: string) {
    return this.feeAuthorizations.acquire(
      id,
      transactionHex,
      this.host.captureScope().identity
    );
  }

  public async reviewFeePsbt(
    id: string,
    transactionHex: string
  ): Promise<SentryFeeReview> {
    const scope = this.host.captureScope();
    const entry = this.feeAuthorizations.get(
      id,
      transactionHex,
      scope.identity
    );
    const fresh = await this.context(scope, entry.request);
    if (
      !isEqual(fresh.context, entry.context) ||
      fresh.settings.serviceUrl !== entry.serviceUrl
    )
      throw new Error(
        'Sentry state changed after authorization. Authorize the operation again.'
      );
    const review = await this.host.runCrypto<SentryFeeReview>(
      { type: 'verifyFee', request: entry.request, context: fresh.context },
      () => this.assertCurrent(scope)
    );
    this.feeAuthorizations.get(id, transactionHex, scope.identity);
    this.assertCurrent(scope);
    return review;
  }

  public async sign(params: {
    authorizationId?: SentryRequiredAuthorization['id'];
    id: string;
    keyId: string;
    password: string;
  }) {
    const pending = this.pending(params.id);
    if (pending.signing)
      throw new Error('This Sentry approval is already being signed');
    pending.signing = true;
    const assertPending = () => {
      if (this.pending(params.id) !== pending)
        throw new Error('Sentry approval was cancelled');
    };
    try {
      return await this.host.runExclusive(async () => {
        assertPending();
        const { scope, publicApproval } = pending;
        const seed = await this.host.getSeed(
          params.password,
          scope,
          assertPending
        );
        assertPending();
        const fresh = await this.context(scope, publicApproval.request);
        assertPending();
        if (
          !isEqual(fresh.context, pending.context) ||
          fresh.settings.serviceUrl !== publicApproval.serviceUrl
        )
          throw new Error(
            'Sentry state changed after review. Start the operation again.'
          );
        if (
          !publicApproval.keys.some(
            (key) =>
              key.id === params.keyId &&
              key.authorizationId === params.authorizationId
          )
        )
          throw new Error('Select the registered operator key');
        let key: SentryAuthorityKey;
        if (
          params.keyId.startsWith('wallet-') &&
          'authorizations' in publicApproval.review
        ) {
          const auth = publicApproval.review.authorizations.find(
            (candidate) =>
              candidate.id === params.authorizationId &&
              candidate.scheme === 'secp256k1'
          );
          if (!auth) throw new Error('Invalid wallet authority selection');
          const address = syscoinUtils.bitcoinjs.address.toBase58Check(
            Buffer.from(auth.keyIdentity, 'hex'),
            SENTRY_NETWORKS[publicApproval.network].encoding.pubKeyHash
          );
          const secret = await this.host.resolveWalletAuthority(
            { address, password: params.password },
            scope
          );
          if (!secret)
            throw new Error(
              'Selected wallet has no private Sentry authority key'
            );
          key = await this.host.runCrypto<SentryAuthorityKey>(
            {
              type: 'import',
              role: auth.role,
              scheme: 'secp256k1',
              secretKey: secret.secretKey,
            },
            assertPending
          );
        } else
          key = await this.host.loadKey({
            scope,
            network: publicApproval.network,
            id: params.keyId,
            seed,
            assertCurrent: assertPending,
          });
        assertPending();
        if (publicApproval.request.operation === 'register') {
          const sdk = await loadSdk();
          const registration = sdk.inspectSentryManagementOperation(
            publicApproval.request
          ).collateral;
          if (!registration)
            throw new Error('Missing verified registration collateral');
          await this.host.reserveCollateral(
            scope,
            {
              admission: pending.admission,
              reservation: { ...registration, pendingRegistration: true },
            },
            assertPending
          );
        }
        const collateral = pending.context.node?.collateralOutpoint;
        // Importing an operator key does not import or prove ownership of collateral.
        // A separate account may own it; authorization must not depend on this check.
        if (collateral && (await this.host.ownsCollateral(collateral, scope))) {
          assertPending();
          await this.host.reserveCollateral(
            scope,
            {
              admission: pending.admission,
              reservation: {
                ...collateral,
                proTxHash: publicApproval.review.proTxHash!,
              },
            },
            assertPending
          );
        }
        const response = await this.host.runCrypto<
          SentryOperationResponse | SentryManagementResponse
        >(
          publicApproval.request.operation === 'updateService'
            ? {
                type: 'sign',
                request: publicApproval.request,
                context: pending.context as SentryReviewContext,
                key,
              }
            : {
                type: 'signManagement',
                request: publicApproval.request,
                context: pending.context,
                key,
                authorizationId: params.authorizationId!,
              },
          assertPending
        );
        assertPending();
        if (
          response.operation === 'updateService' ||
          ('complete' in response && response.complete)
        )
          this.feeAuthorizations.remember({
            context: pending.context,
            origin: publicApproval.origin,
            request: {
              ...publicApproval.request,
              transactionHex: response.transactionHex,
            },
            scopeIdentity: scope.identity,
            serviceUrl: publicApproval.serviceUrl,
          });
        this.approvals.delete(params.id);
        return response;
      });
    } finally {
      pending.signing = false;
    }
  }
}
