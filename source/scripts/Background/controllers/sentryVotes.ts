import isEqual from 'lodash/isEqual';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import { getSentryVaultId, loadSentryKey } from 'utils/sentry/keyStore';
import { SENTRY_NETWORKS } from 'utils/sentry/network';
import type { SentrySettings, SentryVoteApproval } from 'utils/sentry/types';
import { runSentryCrypto } from 'utils/sentry/workerClient';

import type { SentryWalletScope } from './sentry';
import type {
  SentryAuthorityKey,
  SentryGovernanceVoteContext,
  SentryGovernanceVoteRequest,
  SentryGovernanceVoteResponse,
} from '@sidhujag/sysweb3-sentry';

interface Host {
  captureScope: () => SentryWalletScope;
  getSeed: (password: string) => Promise<string>;
  getSettings: (scope: SentryWalletScope) => Promise<SentrySettings>;
  hasWalletAuthority?: (
    address: string,
    scope: SentryWalletScope
  ) => Promise<boolean>;
  readJson: (url: string, limit: number) => Promise<any>;
  resolveWalletAuthority?: (
    params: { address: string; password: string },
    scope: SentryWalletScope
  ) => Promise<{ scheme: 'ecdsa'; secretKey: string }>;
  runExclusive: <T>(operation: () => Promise<T>) => Promise<T>;
}

interface Pending {
  context: SentryGovernanceVoteContext;
  expiresAt: number;
  publicApproval: SentryVoteApproval;
  scope: SentryWalletScope;
  signing: boolean;
}

const loadSdk = () =>
  import(
    /* webpackChunkName: "sentry-sdk", webpackExports: ["validateSentryGovernanceVoteRequest", "reviewSentryGovernanceVote", "verifySentryGovernanceVote", "governanceVotingKeyIds"] */
    '@sidhujag/sysweb3-sentry'
  );

/** Dedicated governance protocol: never accept an arbitrary digest from a site. */
export class SentryVoteController {
  private readonly approvals = new Map<string, Pending>();

  constructor(private readonly host: Host) {}

  private assertCurrent(scope: SentryWalletScope) {
    if (this.host.captureScope().identity !== scope.identity)
      throw new Error(
        'Wallet account, network or session changed. Start the vote again.'
      );
  }

  public clear() {
    this.approvals.clear();
  }

  private async context(
    scope: SentryWalletScope,
    request: SentryGovernanceVoteRequest
  ) {
    const settings = await this.host.getSettings(scope);
    this.assertCurrent(scope);
    if (!settings.serviceUrl)
      throw new Error(
        'Configure a trusted Sentry data service in wallet settings first'
      );
    if (
      request.chain.genesisHash !==
      SENTRY_NETWORKS[settings.network].genesisHash
    )
      throw new Error('Switch to the requested Syscoin network before voting');
    const query = new URLSearchParams({
      network: settings.network,
      proposalHash: request.proposalHash,
      proTxHashes: request.nodes.map((node) => node.proTxHash).join(','),
    });
    const context = (await this.host.readJson(
      `${settings.serviceUrl}/api/sentry/v1/voting-context?${query}`,
      65536
    )) as SentryGovernanceVoteContext;
    this.assertCurrent(scope);
    if (
      context?.chain?.genesisHash !==
      SENTRY_NETWORKS[settings.network].genesisHash
    )
      throw new Error(
        'The Sentry data service returned a different network genesis'
      );
    if (!context.proposal)
      throw new Error(
        'The Sentry data service did not identify the registered proposal'
      );
    // Time is a wallet observation, not a server-controlled authorization window.
    return {
      settings,
      context: { ...context, now: Math.floor(Date.now() / 1000) },
    };
  }

  public async prepare(raw: unknown, origin: string) {
    const scope = this.host.captureScope();
    const sdk = await loadSdk();
    const request = sdk.validateSentryGovernanceVoteRequest(raw);
    const { settings, context } = await this.context(scope, request);
    sdk.reviewSentryGovernanceVote(request, context);
    const votingKeys = await Promise.all(
      settings.keys
        .filter((key) => key.role === 'voting' && key.scheme === 'secp256k1')
        .map(async (key) => ({
          key,
          identities: Object.values(
            await sdk.governanceVotingKeyIds(key.publicKey)
          ),
        }))
    );
    this.assertCurrent(scope);
    const nodes: SentryVoteApproval['nodes'] = [];
    const missingNodes: string[] = [];
    for (const requested of request.nodes) {
      const node = context.nodes.find(
        (item) => item.proTxHash === requested.proTxHash
      )!;
      const key = votingKeys.find((item) =>
        item.identities.includes(node.votingKeyId)
      )?.key;
      if (key)
        nodes.push({
          ...requested,
          votingKeyId: node.votingKeyId,
          keyId: key.id,
          keyLabel: key.label,
        });
      else {
        if (
          !this.host.resolveWalletAuthority ||
          !this.host.hasWalletAuthority
        ) {
          missingNodes.push(requested.proTxHash);
          continue;
        }
        const address = syscoinUtils.bitcoinjs.address.toBase58Check(
          Buffer.from(node.votingKeyId, 'hex'),
          SENTRY_NETWORKS[settings.network].encoding.pubKeyHash
        );
        if (!(await this.host.hasWalletAuthority(address, scope))) {
          missingNodes.push(requested.proTxHash);
          continue;
        }
        nodes.push({
          ...requested,
          votingKeyId: node.votingKeyId,
          keyId: 'wallet-voting',
          keyLabel: 'Selected wallet account',
        });
      }
      this.assertCurrent(scope);
    }
    if (missingNodes.length)
      throw new Error(
        `Import the matching voting keys for these nodes: ${missingNodes.join(
          ', '
        )}`
      );
    for (const [id, approval] of this.approvals)
      if (
        approval.expiresAt <= Date.now() ||
        approval.scope.identity !== scope.identity
      )
        this.approvals.delete(id);
    if (this.approvals.size >= 8)
      throw new Error('Too many pending Sentry vote approvals');
    const id = crypto.randomUUID();
    this.approvals.set(id, {
      context,
      scope,
      signing: false,
      expiresAt: Date.now() + 10 * 60 * 1000,
      publicApproval: {
        id,
        origin,
        network: settings.network,
        serviceUrl: settings.serviceUrl,
        request,
        nodes,
        proposal: context.proposal,
      },
    });
    return id;
  }

  private pending(id: string) {
    const pending = this.approvals.get(id);
    if (!pending || pending.expiresAt <= Date.now()) {
      this.approvals.delete(id);
      throw new Error('This vote approval expired. Start again from the dapp.');
    }
    this.assertCurrent(pending.scope);
    return pending;
  }

  public getApproval(id: string) {
    return this.pending(id).publicApproval;
  }

  public cancel(id: string) {
    this.approvals.delete(id);
  }

  public async sign(params: { id: string; password: string }) {
    const pending = this.pending(params.id);
    if (pending.signing)
      throw new Error('This vote approval is already being signed');
    pending.signing = true;
    try {
      return await this.host.runExclusive(async () => {
        if (this.pending(params.id) !== pending)
          throw new Error('Vote approval was cancelled');
        const { scope, publicApproval: approval } = pending;
        const seed = await this.host.getSeed(params.password);
        this.assertCurrent(scope);
        const sdk = await loadSdk();
        const fresh = await this.context(scope, approval.request);
        sdk.reviewSentryGovernanceVote(approval.request, fresh.context);
        // Ignore only the current clock; all reviewed identities/metadata must remain exact.
        if (
          !isEqual(
            { ...fresh.context, now: 0 },
            { ...pending.context, now: 0 }
          ) ||
          fresh.settings.serviceUrl !== approval.serviceUrl
        )
          throw new Error(
            'Proposal or registered voting authority changed after review. Start the vote again.'
          );
        const vaultId = await getSentryVaultId(scope.rootPublicIdentity);
        const votes: SentryGovernanceVoteResponse[] = [];
        for (const node of approval.nodes) {
          let key: SentryAuthorityKey;
          if (
            node.keyId === 'wallet-voting' &&
            this.host.resolveWalletAuthority
          ) {
            const address = syscoinUtils.bitcoinjs.address.toBase58Check(
              Buffer.from(node.votingKeyId, 'hex'),
              SENTRY_NETWORKS[approval.network].encoding.pubKeyHash
            );
            const secret = await this.host.resolveWalletAuthority(
              { address, password: params.password },
              scope
            );
            key = await runSentryCrypto<SentryAuthorityKey>(
              {
                type: 'import',
                role: 'voting',
                scheme: 'secp256k1',
                secretKey: secret.secretKey,
              },
              () => this.assertCurrent(scope)
            );
          } else {
            key = await loadSentryKey({
              vaultId,
              network: approval.network,
              id: node.keyId,
              seed,
              assertCurrent: () => this.assertCurrent(scope),
            });
          }
          this.assertCurrent(scope);
          if (
            key.role !== 'voting' ||
            key.scheme !== 'secp256k1' ||
            !Object.values(
              await sdk.governanceVotingKeyIds(key.publicKey)
            ).includes(node.votingKeyId)
          )
            throw new Error(
              'The selected key is not this node’s registered voting key'
            );
          const vote = await runSentryCrypto<SentryGovernanceVoteResponse>(
            {
              type: 'signVote',
              request: approval.request,
              context: fresh.context,
              proTxHash: node.proTxHash,
              key,
            },
            () => this.assertCurrent(scope)
          );
          if (
            !(await sdk.verifySentryGovernanceVote(
              approval.request,
              fresh.context,
              vote
            ))
          )
            throw new Error(
              'The generated vote does not match the approved node and proposal'
            );
          if (this.pending(params.id) !== pending)
            throw new Error('Vote approval was cancelled');
          votes.push(vote);
        }
        this.approvals.delete(params.id);
        return {
          version: 1,
          chain: approval.request.chain,
          proposalHash: approval.request.proposalHash,
          signal: approval.request.signal,
          outcome: approval.request.outcome,
          timestamp: approval.request.timestamp,
          votes,
        };
      });
    } finally {
      pending.signing = false;
    }
  }
}
