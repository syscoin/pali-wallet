import isEqual from 'lodash/isEqual';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import {
  normalizeSentryServiceSettings,
  readSentryServiceSettings,
  sentrySettingsStorageKey,
} from '../../../shared/sentrySettings';
import { AsyncMutex } from 'utils/asyncMutex';
import {
  captureSentryCollateralAdmission,
  getSentryCollateralReservations,
  reserveSentryCollateral,
  type SentryCollateralReservation,
  type SentryCollateralAdmission,
} from 'utils/sentry/collateral';
import { createExtensionSentryNodeManagement } from 'utils/sentry/extensionSentry';
import {
  SentryFeeAuthorizations,
  type SentryFeeReview,
} from 'utils/sentry/feeAuthorization';
import { normalizeSentryKeyImportEntries } from 'utils/sentry/importBatch';
import {
  getSentryVaultId,
  listSentryKeys,
  loadSentryKey,
  removeSentryKey,
  saveSentryKeys,
} from 'utils/sentry/keyStore';
import { getSentryNetwork, SENTRY_NETWORKS } from 'utils/sentry/network';
import { withSentryPersistence } from 'utils/sentry/persistence';
import type { SentryApproval, SentrySettings } from 'utils/sentry/types';
import { runSentryCrypto } from 'utils/sentry/workerClient';
import { chromeStorage } from 'utils/storageAPI';

import { SentryVoteController } from './sentryVotes';
import type {
  SentryOperationRequest,
  SentryReviewContext,
  SentryAuthorityRole,
  SentryAuthorityScheme,
  SentryAuthorityKey,
  SentryManagementContext,
  SentryManagementRequest,
  SentryManagementResponse,
  SentryRequiredAuthorization,
  SentryOperationResponse,
} from '@sidhujag/sysweb3-sentry';

export interface SentryWalletScope {
  identity: string;
  network: { chainId: number; kind?: string; url: string };
  rootPublicIdentity: string;
}
interface Host {
  captureScope: () => SentryWalletScope;
  getSeed: (password: string) => Promise<string>;
  hasWalletAuthority?: (
    address: string,
    scope: SentryWalletScope
  ) => Promise<boolean>;
  ownsCollateral?: (
    outpoint: { txid: string; vout: number },
    scope: SentryWalletScope
  ) => Promise<boolean>;
  resolveVotingAuthority?: (
    params: { address: string; password: string },
    scope: SentryWalletScope
  ) => Promise<{ scheme: 'ecdsa'; secretKey: string }>;
  resolveWalletAuthority?: (
    params: { address: string; password: string },
    scope: SentryWalletScope
  ) => Promise<{ scheme: 'ecdsa'; secretKey: string }>;
}
type Pending = {
  admission: SentryCollateralAdmission;
  context: SentryManagementContext;
  expiresAt: number;
  publicApproval: SentryApproval;
  scope: SentryWalletScope;
  signing: boolean;
};
const APPROVAL_TTL_MS = 10 * 60 * 1000;
const loadSdk = () =>
  import(
    /* webpackChunkName: "sentry-sdk", webpackExports: ["inspectSentryOperation", "inspectSentryManagementOperation", "validateSentryOperationRequest", "validateSentryManagementRequest", "sentryKeyId"] */
    '@sidhujag/sysweb3-sentry'
  );

const readJson = async (url: string, limit = 2 * 1024 * 1024): Promise<any> => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      signal: abort.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Sentry data service is unavailable');
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > limit) {
      abort.abort();
      throw new Error('Sentry service response is too large');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Sentry service returned an empty response');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > limit) {
          void reader.cancel().catch(() => undefined);
          throw new Error('Sentry service response is too large');
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      return JSON.parse(text + decoder.decode());
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timer);
  }
};

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

/** Background-only custodian. Sites receive capabilities or one approved signature, never a key inventory. */
export class SentryController {
  private readonly mutex = new AsyncMutex();
  private readonly feeAuthorizations = new SentryFeeAuthorizations();
  private readonly approvals = new Map<string, Pending>();
  private readonly nodeManagement: ReturnType<
    typeof createExtensionSentryNodeManagement<SentryWalletScope>
  >;
  public readonly votes: SentryVoteController;
  constructor(private readonly host: Host) {
    this.nodeManagement = createExtensionSentryNodeManagement({
      captureScope: host.captureScope,
      assertCurrent: (scope) => this.assertCurrent(scope),
      authenticate: (password) => host.getSeed(password),
      readSettings: (scope) => this.settings(scope),
      runExclusive: (operation) => this.mutex.runExclusive(operation),
    });
    this.votes = new SentryVoteController({
      ...host,
      resolveWalletAuthority: host.resolveVotingAuthority,
      getSettings: (scope) => this.settings(scope),
      readJson,
      runExclusive: (operation) => this.mutex.runExclusive(operation),
    });
  }

  private assertCurrent(scope: SentryWalletScope) {
    if (this.host.captureScope().identity !== scope.identity)
      throw new Error(
        'Wallet account, network or session changed. Start the Sentry operation again.'
      );
  }

  private async settings(scope: SentryWalletScope): Promise<SentrySettings> {
    const network = getSentryNetwork(scope.network);
    const vaultId = await getSentryVaultId(scope.rootPublicIdentity);
    this.assertCurrent(scope);
    const key = sentrySettingsStorageKey(vaultId, network);
    const saved = (await chromeStorage.getItems([key]))[key];
    this.assertCurrent(scope);
    const { serviceUrl, maxFeeSatoshis } = readSentryServiceSettings(
      saved,
      network
    );
    const keys = await listSentryKeys(vaultId, network);
    this.assertCurrent(scope);
    const collateral = await getSentryCollateralReservations({
      walletIdentity: scope.rootPublicIdentity,
      genesisHash: SENTRY_NETWORKS[network].genesisHash,
    });
    this.assertCurrent(scope);
    const linkedNodes =
      (await chromeStorage.getItem(`sentry-linked-v1:${vaultId}:${network}`)) ||
      [];
    if (!Array.isArray(linkedNodes) || linkedNodes.length > 1000)
      throw new Error('Invalid linked Sentry registry');
    this.assertCurrent(scope);
    return {
      network,
      serviceUrl,
      maxFeeSatoshis,
      keys,
      collateral,
      linkedNodes,
    };
  }

  public async getSettings() {
    return this.settings(this.host.captureScope());
  }

  public async prepareLink(raw: unknown, origin: string): Promise<string> {
    return (await this.nodeManagement.prepareLink(raw, origin)).id;
  }

  public getLinkApproval(id: string) {
    return this.nodeManagement.getLinkApproval(id);
  }

  public cancelLink(id: string) {
    this.nodeManagement.cancelLink(id);
  }

  public async approveLink(id: string) {
    return this.nodeManagement.confirmLink(this.getLinkApproval(id));
  }

  public async saveSettings(params: {
    maxFeeSatoshis: string;
    password: string;
    serviceUrl: string;
  }) {
    const scope = this.host.captureScope();
    return this.mutex.runExclusive(async () => {
      this.assertCurrent(scope);
      const settings = normalizeSentryServiceSettings({
        serviceUrl: params.serviceUrl,
        maxFeeSatoshis: params.maxFeeSatoshis,
      });
      await this.host.getSeed(params.password);
      this.assertCurrent(scope);
      const network = getSentryNetwork(scope.network);
      const vaultId = await getSentryVaultId(scope.rootPublicIdentity);
      this.assertCurrent(scope);
      await withSentryPersistence(
        () => this.assertCurrent(scope),
        () =>
          chromeStorage.setItem(
            sentrySettingsStorageKey(vaultId, network),
            settings
          )
      );
      this.assertCurrent(scope);
      this.approvals.clear();
      this.feeAuthorizations.clear();
      this.votes.clear();
      return settings;
    });
  }

  public async importKey(params: {
    label: string;
    password: string;
    role?: SentryAuthorityRole;
    scheme: SentryAuthorityScheme;
    secretKey: string;
  }) {
    const results = await this.importKeys({
      password: params.password,
      role: params.role,
      scheme: params.scheme,
      entries: [{ label: params.label, secretKey: params.secretKey }],
    });
    return results[0];
  }

  public async importKeys(params: {
    entries: Array<{ label: string; secretKey: string }>;
    password: string;
    role?: SentryAuthorityRole;
    scheme: SentryAuthorityScheme;
  }) {
    const scope = this.host.captureScope();
    return this.mutex.runExclusive(async () => {
      this.assertCurrent(scope);
      const entries = normalizeSentryKeyImportEntries(
        params.entries,
        params.scheme,
        (secretKey) => {
          const pair = syscoinUtils.bitcoinjs.ECPair.fromWIF(
            secretKey,
            syscoinUtils.syscoinNetworks[getSentryNetwork(scope.network)]
          );
          if (!pair.privateKey) throw new Error('Unsupported key');
          return Buffer.from(pair.privateKey).toString('hex');
        }
      );
      const seed = await this.host.getSeed(params.password);
      this.assertCurrent(scope);
      const keys: Array<{ key: SentryAuthorityKey; label: string }> = [];
      for (const [index, entry] of entries.entries()) {
        let key: SentryAuthorityKey;
        try {
          key = await runSentryCrypto<SentryAuthorityKey>(
            {
              type: 'import',
              role: params.role || 'operator',
              scheme: params.scheme,
              secretKey: entry.secretKey,
            },
            () => this.assertCurrent(scope)
          );
        } catch {
          this.assertCurrent(scope);
          throw new Error(
            `Key ${index + 1}: invalid key for the selected role and type`
          );
        }
        this.assertCurrent(scope);
        keys.push({ label: entry.label, key });
      }
      const vaultId = await getSentryVaultId(scope.rootPublicIdentity);
      return saveSentryKeys({
        vaultId,
        network: getSentryNetwork(scope.network),
        entries: keys,
        seed,
        assertCurrent: () => this.assertCurrent(scope),
      });
    });
  }

  public async removeKey(params: { id: string; password: string }) {
    const scope = this.host.captureScope();
    return this.mutex.runExclusive(async () => {
      this.assertCurrent(scope);
      await this.host.getSeed(params.password);
      this.assertCurrent(scope);
      const vaultId = await getSentryVaultId(scope.rootPublicIdentity);
      await removeSentryKey(
        vaultId,
        getSentryNetwork(scope.network),
        params.id,
        () => this.assertCurrent(scope)
      );
      this.approvals.clear();
      this.feeAuthorizations.clear();
      this.votes.clear();
      return { removedKeyId: params.id };
    });
  }

  public async releaseCollateral(params: {
    acknowledgeNodeStops: boolean;
    password: string;
    reservation: SentryCollateralReservation;
  }) {
    return this.nodeManagement.releaseCollateral(params);
  }

  private async context(
    scope: SentryWalletScope,
    request: SentryOperationRequest | SentryManagementRequest
  ): Promise<{
    context: SentryManagementContext;
    settings: SentrySettings;
  }> {
    const sdk = await loadSdk();
    const settings = await this.settings(scope);
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
    const observation = await readJson(
      `${settings.serviceUrl}/api/sentry/v1/context?${query}`,
      65536
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
        const tx = await readJson(
          `${scope.network.url.replace(/\/$/, '')}/api/v2/tx/${txid}`
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
    const admission = await captureSentryCollateralAdmission({
      walletIdentity: scope.rootPublicIdentity,
      genesisHash: SENTRY_NETWORKS[getSentryNetwork(scope.network)].genesisHash,
    });
    const sdk = await loadSdk();
    const request =
      (rawRequest as { operation?: unknown })?.operation === 'updateService'
        ? sdk.validateSentryOperationRequest(rawRequest)
        : sdk.validateSentryManagementRequest(rawRequest);
    const { context, settings } = await this.context(scope, request);
    const review = await runSentryCrypto<SentryFeeReview>(
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
    if ('authorizations' in review && this.host.resolveWalletAuthority) {
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
          (await this.host.hasWalletAuthority?.(address, scope))
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
    const review = await runSentryCrypto<SentryFeeReview>(
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
      return await this.mutex.runExclusive(async () => {
        assertPending();
        const { scope, publicApproval } = pending;
        const seed = await this.host.getSeed(params.password);
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
        const vaultId = await getSentryVaultId(scope.rootPublicIdentity);
        assertPending();
        let key: SentryAuthorityKey;
        if (
          params.keyId.startsWith('wallet-') &&
          'authorizations' in publicApproval.review &&
          this.host.resolveWalletAuthority
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
          key = await runSentryCrypto<SentryAuthorityKey>(
            {
              type: 'import',
              role: auth.role,
              scheme: 'secp256k1',
              secretKey: secret.secretKey,
            },
            assertPending
          );
        } else
          key = await loadSentryKey({
            vaultId,
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
          await reserveSentryCollateral({
            admission: pending.admission,
            walletIdentity: scope.rootPublicIdentity,
            genesisHash: pending.context.chain.genesisHash,
            reservation: { ...registration, pendingRegistration: true },
            // Cancellation can stop a queued write, never undo protection
            // whose native write has already been admitted.
            assertCurrent: assertPending,
          });
        }
        const collateral = pending.context.node?.collateralOutpoint;
        // Importing an operator key does not import or prove ownership of collateral.
        // A separate account may own it; authorization must not depend on this check.
        if (
          collateral &&
          (await this.host.ownsCollateral?.(collateral, scope))
        ) {
          assertPending();
          await reserveSentryCollateral({
            admission: pending.admission,
            walletIdentity: scope.rootPublicIdentity,
            genesisHash: pending.context.chain.genesisHash,
            reservation: {
              ...collateral,
              proTxHash: publicApproval.review.proTxHash!,
            },
            assertCurrent: assertPending,
          });
        }
        const response = await runSentryCrypto<
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
