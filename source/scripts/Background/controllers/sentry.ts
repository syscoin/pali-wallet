import { utils as syscoinUtils } from 'syscoinjs-lib';

import {
  abortable,
  boundedResponseText,
  cancelResponseBody,
  ResponseSizeLimitError,
} from '../../../shared/boundedHttp';
import { assertSynchronousEvmFeeGuard } from '../../../shared/evmFeeGuard';
import {
  normalizeSentryServiceSettings,
  readSentryServiceSettings,
  sentrySettingsStorageKey,
} from '../../../shared/sentrySettings';
import { withPasswordSentrySigningMaterial } from '../../../wallet/sentryApprovalHost.ts';
import { SharedSentryOperationApprovals } from '../../../wallet/sentryOperationApprovals';
import { AsyncMutex } from 'utils/asyncMutex';
import {
  captureSentryCollateralAdmission,
  getSentryCollateralReservations,
  reserveSentryCollateral,
  type SentryCollateralReservation,
} from 'utils/sentry/collateral';
import { createExtensionSentryNodeManagement } from 'utils/sentry/extensionSentry';
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
import { runSentryCrypto } from 'utils/sentry/workerClient';
import { chromeStorage } from 'utils/storageAPI';

import { SentryVoteController } from './sentryVotes';
import type {
  SentryApproval,
  SentrySettings,
  SentryApprovalScope,
  SentryRequestScope,
  SentryRequestLifetime,
} from '../../../wallet/sentryApprovalTypes';
import type { SentryFeeReview } from '../../../wallet/sentryFeeAuthorizations';
import type {
  SentryAuthorityRole,
  SentryAuthorityScheme,
  SentryAuthorityKey,
  SentryRequiredAuthorization,
} from '@sidhujag/sysweb3-sentry';

export type SentryWalletScope = SentryApprovalScope;
type Host = {
  captureApprovalScope(origin: string): SentryRequestScope;
  captureScope: () => SentryWalletScope;
  getSeed: (password: string) => Promise<string>;
  hasWalletAuthority: (
    address: string,
    scope: SentryWalletScope
  ) => Promise<boolean>;
  ownsCollateral: (
    outpoint: { txid: string; vout: number },
    scope: SentryWalletScope
  ) => Promise<boolean>;
  resolveVotingAuthority: (
    params: { address: string; password: string },
    scope: SentryWalletScope
  ) => Promise<{ scheme: 'ecdsa'; secretKey: string } | undefined>;
  resolveWalletAuthority: (
    params: { address: string; password: string },
    scope: SentryWalletScope
  ) => Promise<{ scheme: 'ecdsa'; secretKey: string } | undefined>;
};
const readJson = async (
  url: string,
  limit: number,
  check: () => void,
  signal: AbortSignal
): Promise<any> => {
  if (typeof check !== 'function' || typeof signal?.aborted !== 'boolean')
    throw new Error('Sentry request lifetime is required');
  const abort = new AbortController();
  const cancel = () => abort.abort();
  const current = () => {
    assertSynchronousEvmFeeGuard(check);
    if (signal.aborted || abort.signal.aborted)
      throw new Error('Sentry request was cancelled');
  };
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 15000);
  try {
    current();
    const pending = fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      signal: abort.signal,
      headers: { Accept: 'application/json' },
    }).then((response) => {
      try {
        current();
        return response;
      } catch (error) {
        cancelResponseBody(response);
        throw error;
      }
    });
    void pending.catch(() => undefined);
    const response = await abortable(pending, abort.signal);
    current();
    if (!response.ok) {
      cancelResponseBody(response);
      throw new Error('Sentry data service is unavailable');
    }
    if (!response.body?.getReader)
      throw new Error('Sentry service returned an empty response');
    const text = await boundedResponseText(response, abort.signal, limit);
    current();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ResponseSizeLimitError)
      throw new Error('Sentry service response is too large');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    abort.abort();
  }
};

/** Background-only custodian. Sites receive capabilities or one approved signature, never a key inventory. */
export class SentryController {
  private readonly mutex = new AsyncMutex();
  private readonly operations: SharedSentryOperationApprovals;
  private readonly nodeManagement: ReturnType<
    typeof createExtensionSentryNodeManagement<SentryWalletScope>
  >;
  public readonly votes: SentryVoteController;
  constructor(private readonly host: Host) {
    if (
      [
        host.hasWalletAuthority,
        host.captureApprovalScope,
        host.ownsCollateral,
        host.resolveVotingAuthority,
        host.resolveWalletAuthority,
      ].some((port) => typeof port !== 'function')
    )
      throw new Error('Sentry authority and collateral ports are required');
    this.nodeManagement = createExtensionSentryNodeManagement({
      captureScope: host.captureScope,
      captureLinkScope: (origin) => {
        const scope = host.captureApprovalScope(origin);
        return { scope, assertCurrent: scope.assertRequestCurrent };
      },
      assertCurrent: (scope) => this.assertCurrent(scope),
      authenticate: (password) => host.getSeed(password),
      readSettings: (scope) => this.settings(scope),
      runExclusive: (operation) => this.mutex.runExclusive(operation),
    });
    this.operations = new SharedSentryOperationApprovals({
      captureScope: host.captureScope,
      assertCurrent: (scope) => this.assertCurrent(scope),
      withSigningMaterial: (request, work) =>
        withPasswordSentrySigningMaterial(request, work, {
          getSeed: (password) => host.getSeed(password),
          resolveWalletAuthority: (authority, password) =>
            (authority.purpose === 'management'
              ? host.resolveWalletAuthority
              : host.resolveVotingAuthority)(
              { address: authority.address, password },
              request.scope
            ),
        }),
      getSettings: (scope) => this.settings(scope),
      readJson: (url, limit, scope, check, signal) =>
        readJson(url, limit, check, signal),
      runCrypto: runSentryCrypto,
      runExclusive: (operation) => this.mutex.runExclusive(operation),
      hasWalletAuthority: (address, scope) =>
        host.hasWalletAuthority(address, scope),
      async loadKey({ scope, network, id, seed, assertCurrent }) {
        const vaultId = await getSentryVaultId(scope.rootPublicIdentity);
        assertCurrent();
        return loadSentryKey({ vaultId, network, id, seed, assertCurrent });
      },
      network: (scope) => getSentryNetwork(scope.network),
      captureCollateralAdmission: (scope) =>
        captureSentryCollateralAdmission({
          walletIdentity: scope.rootPublicIdentity,
          genesisHash:
            SENTRY_NETWORKS[getSentryNetwork(scope.network)].genesisHash,
        }),
      ownsCollateral: (point, scope) => host.ownsCollateral(point, scope),
      reserveCollateral: (scope, { admission, reservation }, assertCurrent) =>
        reserveSentryCollateral({
          admission,
          reservation,
          assertCurrent,
          walletIdentity: scope.rootPublicIdentity,
          genesisHash:
            SENTRY_NETWORKS[getSentryNetwork(scope.network)].genesisHash,
        }),
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
      this.operations.clear();
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
      this.operations.clear();
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

  public prepare(
    raw: unknown,
    origin: string,
    lifetime: SentryRequestLifetime
  ) {
    return this.operations.prepare(
      raw,
      origin,
      this.host.captureApprovalScope(origin),
      lifetime
    );
  }
  public getApproval(id: string): SentryApproval {
    return this.operations.getApproval(id);
  }
  public cancel(id: string) {
    this.operations.cancel(id);
  }
  public publishFeeAuthorization(id: string) {
    this.operations.publishFeeAuthorization(id);
  }
  public prepareFeePsbt(transactionHex: string, origin: string) {
    return this.operations.prepareFeePsbt(transactionHex, origin);
  }
  public beginFeeSigning(id: string, transactionHex: string) {
    return this.operations.beginFeeSigning(id, transactionHex);
  }
  public reviewFeePsbt(
    id: string,
    transactionHex: string,
    lifetime: SentryRequestLifetime
  ): Promise<SentryFeeReview> {
    return this.operations.reviewFeePsbt(id, transactionHex, lifetime);
  }
  public sign(params: {
    authorizationId?: SentryRequiredAuthorization['id'];
    id: string;
    keyId: string;
    password: string;
  }) {
    return this.operations.sign(params);
  }
}
