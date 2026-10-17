import isEqual from 'lodash/isEqual';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import { AsyncMutex } from 'utils/asyncMutex';
import {
  captureSentryCollateralAdmission,
  getSentryCollateralReservations,
  releaseSentryCollateral,
  reserveSentryCollateral,
  type SentryCollateralReservation,
  type SentryCollateralAdmission,
} from 'utils/sentry/collateral';
import {
  SentryFeeAuthorizations,
  type SentryFeeReview,
} from 'utils/sentry/feeAuthorization';
import {
  getSentryVaultId,
  listSentryKeys,
  loadSentryKey,
  removeSentryKey,
  saveSentryKeys,
} from 'utils/sentry/keyStore';
import {
  getSentryNetwork,
  normalizeSentryServiceUrl,
  SENTRY_NETWORKS,
  validateSentryFeeLimit,
} from 'utils/sentry/network';
import type {
  SentryApproval,
  SentrySettings,
  SentryLinkApproval,
  SentryLinkedNode,
} from 'utils/sentry/types';
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
  private readonly links = new Map<
    string,
    {
      admission: SentryCollateralAdmission;
      approval: SentryLinkApproval;
      committing?: boolean;
      expiresAt: number;
      scope: SentryWalletScope;
    }
  >();
  public readonly votes: SentryVoteController;
  constructor(private readonly host: Host) {
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
    const saved = await chromeStorage.getItem(
      `sentry-settings-v1:${vaultId}:${network}`
    );
    this.assertCurrent(scope);
    const serviceUrl = saved?.serviceUrl
      ? normalizeSentryServiceUrl(saved.serviceUrl)
      : SENTRY_NETWORKS[network].defaultServiceUrl;
    const maxFeeSatoshis = validateSentryFeeLimit(
      saved?.maxFeeSatoshis || '100000'
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
    const scope = this.host.captureScope();
    const admission = await captureSentryCollateralAdmission({
      walletIdentity: scope.rootPublicIdentity,
      genesisHash: SENTRY_NETWORKS[getSentryNetwork(scope.network)].genesisHash,
    });
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
    const settings = await this.settings(scope);
    if (request.genesisHash !== SENTRY_NETWORKS[settings.network].genesisHash)
      throw new Error(
        'Switch to the requested Syscoin network before linking this node'
      );
    if (!settings.serviceUrl)
      throw new Error(
        'Configure a trusted Sentry data service in wallet settings first'
      );
    const proTxHash = request.proTxHash.toLowerCase();
    const query = new URLSearchParams({ network: settings.network, proTxHash });
    const observation = await readJson(
      `${settings.serviceUrl}/api/sentry/v1/context?${query}`,
      65536
    );
    this.assertCurrent(scope);
    const node = observation?.node;
    const collateral = node?.collateralOutpoint;
    if (
      observation?.chain?.genesisHash !==
        SENTRY_NETWORKS[settings.network].genesisHash ||
      node?.proTxHash !== proTxHash ||
      !collateral ||
      !/^[0-9a-f]{64}$/.test(collateral.txid) ||
      !Number.isSafeInteger(collateral.vout) ||
      collateral.vout < 0 ||
      collateral.vout > 0xffffffff ||
      typeof node.service !== 'string' ||
      node.service.length > 128 ||
      typeof node.nevmAddress !== 'string' ||
      (node.nevmAddress !== '' && !/^0x[0-9a-fA-F]{40}$/.test(node.nevmAddress))
    )
      throw new Error(
        'Unable to verify the registered Sentry node on this network'
      );
    for (const [id, link] of this.links)
      if (
        !link.committing &&
        (link.expiresAt <= Date.now() || link.scope.identity !== scope.identity)
      )
        this.links.delete(id);
    if (this.links.size >= 8) throw new Error('Too many pending Sentry links');
    const id = crypto.randomUUID();
    this.links.set(id, {
      admission,
      scope,
      expiresAt: Date.now() + APPROVAL_TTL_MS,
      approval: {
        id,
        origin,
        network: settings.network,
        serviceUrl: settings.serviceUrl,
        node: {
          proTxHash,
          service: node.service,
          nevmAddress: node.nevmAddress,
          collateralOutpoint: { ...collateral },
        },
      },
    });
    return id;
  }

  public getLinkApproval(id: string) {
    const link = this.links.get(id);
    if (!link || link.expiresAt <= Date.now())
      throw new Error('This Sentry link approval expired');
    this.assertCurrent(link.scope);
    return link.approval;
  }

  public cancelLink(id: string) {
    // Once the user-approved commit starts, let its two scoped writes finish.
    // Cancellation before this boundary prevents every persistent mutation.
    if (!this.links.get(id)?.committing) this.links.delete(id);
  }

  public async approveLink(id: string) {
    const link = this.links.get(id);
    this.getLinkApproval(id);
    return this.mutex.runExclusive(async () => {
      const { scope, approval } = link!;
      const assertLinkCurrent = () => {
        this.assertCurrent(scope);
        if (
          this.links.get(id) !== link ||
          (!link!.committing && link!.expiresAt <= Date.now())
        )
          throw new Error('This Sentry link approval was cancelled or expired');
      };
      assertLinkCurrent();
      const freshId = await this.prepareLink(
        {
          version: 1,
          proTxHash: approval.node.proTxHash,
          genesisHash: SENTRY_NETWORKS[approval.network].genesisHash,
        },
        approval.origin
      );
      let fresh: SentryLinkApproval;
      try {
        assertLinkCurrent();
        fresh = this.getLinkApproval(freshId);
      } finally {
        this.links.delete(freshId);
      }
      if (
        !isEqual(fresh.node, approval.node) ||
        fresh.serviceUrl !== approval.serviceUrl
      )
        throw new Error(
          'Sentry state changed after review. Link the node again.'
        );
      const settings = await this.settings(scope);
      assertLinkCurrent();
      const vaultId = await getSentryVaultId(scope.rootPublicIdentity);
      assertLinkCurrent();
      const linkedNodes: SentryLinkedNode[] = settings.linkedNodes.filter(
        (node) => node.proTxHash !== approval.node.proTxHash
      );
      if (linkedNodes.length >= 1000)
        throw new Error('The linked Sentry node limit has been reached');
      linkedNodes.push(approval.node);
      assertLinkCurrent();
      link!.committing = true;
      try {
        await reserveSentryCollateral({
          admission: link!.admission,
          walletIdentity: scope.rootPublicIdentity,
          genesisHash: SENTRY_NETWORKS[approval.network].genesisHash,
          reservation: {
            ...approval.node.collateralOutpoint,
            proTxHash: approval.node.proTxHash,
          },
          assertCurrent: assertLinkCurrent,
        });
        assertLinkCurrent();
        await chromeStorage.setItem(
          `sentry-linked-v1:${vaultId}:${approval.network}`,
          linkedNodes
        );
        assertLinkCurrent();
        this.links.delete(id);
        return {
          version: 1,
          linked: true,
          proTxHash: approval.node.proTxHash,
          genesisHash: SENTRY_NETWORKS[approval.network].genesisHash,
        };
      } finally {
        link!.committing = false;
      }
    });
  }

  public async saveSettings(params: {
    maxFeeSatoshis: string;
    password: string;
    serviceUrl: string;
  }) {
    const scope = this.host.captureScope();
    return this.mutex.runExclusive(async () => {
      this.assertCurrent(scope);
      const serviceUrl = normalizeSentryServiceUrl(params.serviceUrl);
      const maxFeeSatoshis = validateSentryFeeLimit(params.maxFeeSatoshis);
      await this.host.getSeed(params.password);
      this.assertCurrent(scope);
      const network = getSentryNetwork(scope.network);
      const vaultId = await getSentryVaultId(scope.rootPublicIdentity);
      this.assertCurrent(scope);
      await chromeStorage.setItem(`sentry-settings-v1:${vaultId}:${network}`, {
        serviceUrl,
        maxFeeSatoshis,
      });
      this.assertCurrent(scope);
      this.approvals.clear();
      this.feeAuthorizations.clear();
      this.votes.clear();
      return this.settings(scope);
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
      if (
        !Array.isArray(params.entries) ||
        !params.entries.length ||
        params.entries.length > 20
      )
        throw new Error('Import between 1 and 20 Sentry keys at a time');
      const privateInputs = params.entries
        .map((entry) =>
          typeof entry?.secretKey === 'string'
            ? entry.secretKey.replace(/^0x/i, '').toLowerCase()
            : ''
        )
        .filter((value) => value.length >= 50);
      if (
        params.entries.some(
          (entry) =>
            typeof entry?.label === 'string' &&
            privateInputs.some((value) =>
              entry.label.toLowerCase().includes(value)
            )
        )
      )
        throw new Error('Key labels must not contain private keys');
      if (
        !['bls-basic', 'slh-dsa-shake-128s', 'secp256k1'].includes(
          params.scheme
        )
      )
        throw new Error('Unsupported Sentry operator key scheme');
      const entries = params.entries.map((entry, index) => {
        if (
          !entry ||
          typeof entry.label !== 'string' ||
          !entry.label.trim() ||
          entry.label.trim().length > 80
        )
          throw new Error(
            `Key ${index + 1}: enter a label of 1 to 80 characters`
          );
        let secretKey = entry.secretKey;
        if (
          params.scheme === 'secp256k1' &&
          typeof secretKey === 'string' &&
          !/^(?:0x)?[0-9a-fA-F]{64}$/.test(secretKey)
        ) {
          try {
            const pair = syscoinUtils.bitcoinjs.ECPair.fromWIF(
              secretKey,
              syscoinUtils.syscoinNetworks[getSentryNetwork(scope.network)]
            );
            if (!pair.privateKey) throw new Error('Unsupported key');
            secretKey = Buffer.from(pair.privateKey).toString('hex');
          } catch {
            throw new Error(
              `Key ${
                index + 1
              }: enter a voting/owner WIF for the selected network, or a 32-byte hexadecimal private key`
            );
          }
        }
        if (
          typeof secretKey !== 'string' ||
          !new RegExp(
            `^(?:0x)?[0-9a-fA-F]{${
              params.scheme === 'slh-dsa-shake-128s' ? 128 : 64
            }}$`
          ).test(secretKey)
        )
          throw new Error(
            `Key ${
              index + 1
            }: enter a complete hexadecimal Sentry operator private key`
          );
        return { label: entry.label.trim(), secretKey };
      });
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
      return this.settings(scope);
    });
  }

  public async releaseCollateral(params: {
    acknowledgeNodeStops: boolean;
    password: string;
    reservation: SentryCollateralReservation;
  }) {
    const scope = this.host.captureScope();
    if (params.acknowledgeNodeStops !== true)
      throw new Error('Confirm that spending collateral will stop this node');
    return this.mutex.runExclusive(async () => {
      this.assertCurrent(scope);
      await this.host.getSeed(params.password);
      this.assertCurrent(scope);
      const network = getSentryNetwork(scope.network);
      await releaseSentryCollateral({
        walletIdentity: scope.rootPublicIdentity,
        genesisHash: SENTRY_NETWORKS[network].genesisHash,
        reservation: params.reservation,
        assertCurrent: () => this.assertCurrent(scope),
      });
      return this.settings(scope);
    });
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
    try {
      return await this.mutex.runExclusive(async () => {
        if (this.pending(params.id) !== pending)
          throw new Error('Sentry approval was cancelled');
        const { scope, publicApproval } = pending;
        const seed = await this.host.getSeed(params.password);
        this.assertCurrent(scope);
        const fresh = await this.context(scope, publicApproval.request);
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
            () => this.assertCurrent(scope)
          );
        } else
          key = await loadSentryKey({
            vaultId,
            network: publicApproval.network,
            id: params.keyId,
            seed,
            assertCurrent: () => this.assertCurrent(scope),
          });
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
            assertCurrent: () => this.assertCurrent(scope),
          });
        }
        const collateral = pending.context.node?.collateralOutpoint;
        // Importing an operator key does not import or prove ownership of collateral.
        // A separate account may own it; authorization must not depend on this check.
        if (
          collateral &&
          (await this.host.ownsCollateral?.(collateral, scope))
        ) {
          this.assertCurrent(scope);
          await reserveSentryCollateral({
            admission: pending.admission,
            walletIdentity: scope.rootPublicIdentity,
            genesisHash: pending.context.chain.genesisHash,
            reservation: {
              ...collateral,
              proTxHash: publicApproval.review.proTxHash!,
            },
            assertCurrent: () => this.assertCurrent(scope),
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
          () => this.assertCurrent(scope)
        );
        this.assertCurrent(scope);
        if (this.pending(params.id) !== pending)
          throw new Error('Sentry approval was cancelled');
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
