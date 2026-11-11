import isEqual from 'lodash/isEqual.js';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeGuard.ts';
import { SENTRY_NETWORKS } from '../shared/sentryNetworks.ts';

import type { SentryApprovalHost } from './sentryApprovalHost.ts';
import type {
  SentryVoteApproval,
  SentryRequestScope,
  SentryRequestLifetime,
} from './sentryApprovalTypes.ts';
import type { WalletAuthentication } from '../shared/walletAuthentication.ts';
import type {
  SentryAuthorityKey,
  SentryGovernanceVoteContext,
  SentryGovernanceVoteRequest,
  SentryGovernanceVoteResponse,
  SentryGovernanceVoteReview,
} from '@sidhujag/sysweb3-sentry';

interface IPendingSentryVote {
  context: SentryGovernanceVoteContext;
  expiresAt: number;
  lifetime: SentryRequestLifetime;
  publicApproval: SentryVoteApproval;
  scope: SentryRequestScope;
  signing: boolean;
}

/** Dedicated governance protocol: never accept an arbitrary digest from a site. */
export class SharedSentryVoteApprovals {
  private readonly approvals = new Map<string, IPendingSentryVote>();
  private readonly host: SentryApprovalHost;

  constructor(host: SentryApprovalHost) {
    this.host = host;
  }

  private assertCurrent(
    scope: SentryRequestScope,
    lifetime: SentryRequestLifetime
  ) {
    assertSynchronousEvmFeeGuard(() => this.host.assertCurrent(scope));
    assertSynchronousEvmFeeGuard(scope.assertRequestCurrent);
    if (
      !lifetime ||
      typeof lifetime.assertCurrent !== 'function' ||
      typeof lifetime.signal?.aborted !== 'boolean'
    )
      throw new Error('Sentry request lifetime is required');
    assertSynchronousEvmFeeGuard(lifetime.assertCurrent);
    if (lifetime.signal.aborted)
      throw new Error('Sentry request was cancelled');
  }

  public clear() {
    this.approvals.clear();
  }

  private async context(
    scope: SentryRequestScope,
    request: SentryGovernanceVoteRequest,
    lifetime: SentryRequestLifetime
  ) {
    this.assertCurrent(scope, lifetime);
    const settings = await this.host.getSettings(scope);
    this.assertCurrent(scope, lifetime);
    if (!settings.serviceUrl)
      throw new Error('Set a trusted Sentry service in wallet settings.');
    if (
      request.chain.genesisHash !==
      SENTRY_NETWORKS[settings.network].genesisHash
    )
      throw new Error('Switch to the requested Syscoin network.');
    const query = new URLSearchParams({
      network: settings.network,
      proposalHash: request.proposalHash,
      proTxHashes: request.nodes.map((node) => node.proTxHash).join(','),
    });
    const context = (await this.host.readJson(
      `${settings.serviceUrl}/api/sentry/v1/voting-context?${query}`,
      65536,
      scope,
      () => this.assertCurrent(scope, lifetime),
      lifetime.signal
    )) as SentryGovernanceVoteContext;
    this.assertCurrent(scope, lifetime);
    if (
      context?.chain?.genesisHash !==
      SENTRY_NETWORKS[settings.network].genesisHash
    )
      throw new Error('Sentry service returned the wrong network genesis.');
    if (!context.proposal)
      throw new Error(
        'Sentry service could not verify the registered proposal.'
      );
    // Time is a wallet observation, not a server-controlled authorization window.
    return {
      settings,
      context: { ...context, now: Math.floor(Date.now() / 1000) },
    };
  }

  public async prepare(
    raw: unknown,
    origin: string,
    scope: SentryRequestScope,
    lifetime: SentryRequestLifetime
  ) {
    this.assertCurrent(scope, lifetime);
    const request = await this.host.runCrypto<SentryGovernanceVoteRequest>(
      { type: 'validateVote', request: raw },
      () => this.assertCurrent(scope, lifetime)
    );
    const { settings, context } = await this.context(scope, request, lifetime);
    await this.host.runCrypto<SentryGovernanceVoteReview>(
      { type: 'reviewVote', request, context },
      () => this.assertCurrent(scope, lifetime)
    );
    const votingKeys = settings.keys.filter(
      (key) => key.role === 'voting' && key.scheme === 'secp256k1'
    );
    const identities = votingKeys.length
      ? await this.host.runCrypto<
          Array<{ compressed: string; publicKey: string; uncompressed: string }>
        >(
          {
            type: 'votingIdentities',
            publicKeys: votingKeys.map((key) => key.publicKey),
          },
          () => this.assertCurrent(scope, lifetime)
        )
      : [];
    this.assertCurrent(scope, lifetime);
    const nodes: SentryVoteApproval['nodes'] = [];
    const missingNodes: string[] = [];
    for (const requested of request.nodes) {
      const node = context.nodes.find(
        (item) => item.proTxHash === requested.proTxHash
      )!;
      const publicKey = identities.find(
        (item) =>
          item.compressed === node.votingKeyId ||
          item.uncompressed === node.votingKeyId
      )?.publicKey;
      const key = votingKeys.find((item) => item.publicKey === publicKey);
      if (key)
        nodes.push({
          ...requested,
          votingKeyId: node.votingKeyId,
          keyId: key.id,
          keyLabel: key.label,
          publicKey: key.publicKey,
        });
      else {
        const address = syscoinUtils.bitcoinjs.address.toBase58Check(
          Buffer.from(node.votingKeyId, 'hex'),
          SENTRY_NETWORKS[settings.network].encoding.pubKeyHash
        );
        if (!(await this.host.hasWalletAuthority(address, scope))) {
          missingNodes.push(requested.proTxHash);
          nodes.push({
            ...requested,
            votingKeyId: node.votingKeyId,
            keyId: '',
            keyLabel: '',
            publicKey: '',
          });
          continue;
        }
        nodes.push({
          ...requested,
          votingKeyId: node.votingKeyId,
          keyId: 'wallet-voting',
          keyLabel: 'Selected wallet account',
          publicKey: '',
        });
      }
      this.assertCurrent(scope, lifetime);
    }
    // Key availability stays inside the approval; it is not a provider oracle.
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
      lifetime,
      signing: false,
      expiresAt: Date.now() + 10 * 60 * 1000,
      publicApproval: {
        id,
        missingVotingKeys: missingNodes,
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
      throw new Error('Vote approval expired. Start again from the dapp.');
    }
    this.assertCurrent(pending.scope, pending.lifetime);
    return pending;
  }

  public getApproval(id: string) {
    return this.pending(id).publicApproval;
  }

  public cancel(id: string) {
    this.approvals.delete(id);
  }

  public async sign(params: { id: string; password: WalletAuthentication }) {
    const pending = this.pending(params.id);
    if (pending.signing)
      throw new Error('This vote approval is already being signed');
    pending.signing = true;
    const assertPending = () => {
      if (this.pending(params.id) !== pending)
        throw new Error('Vote approval was cancelled');
    };
    try {
      return await this.host.runExclusive(async () => {
        if (this.pending(params.id) !== pending)
          throw new Error('Vote approval was cancelled');
        const { scope, publicApproval: approval, lifetime } = pending;
        if (approval.missingVotingKeys.length)
          throw new Error(
            'SENTRY_VOTING_KEY_MISSING: Import matching voting keys in Pali and start again.'
          );
        const fresh = await this.context(scope, approval.request, lifetime);
        await this.host.runCrypto<SentryGovernanceVoteReview>(
          {
            type: 'reviewVote',
            request: approval.request,
            context: fresh.context,
          },
          assertPending
        );
        if (this.pending(params.id) !== pending)
          throw new Error('Vote approval was cancelled');
        // Ignore only the current clock; all reviewed identities/metadata must remain exact.
        if (
          !isEqual(
            { ...fresh.context, now: 0 },
            { ...pending.context, now: 0 }
          ) ||
          fresh.settings.serviceUrl !== approval.serviceUrl
        )
          throw new Error(
            'Proposal or voting key changed. Review the vote again.'
          );
        const walletAuthorities = approval.nodes
          .filter((node) => node.keyId === 'wallet-voting')
          .map((node) => ({
            address: syscoinUtils.bitcoinjs.address.toBase58Check(
              Buffer.from(node.votingKeyId, 'hex'),
              SENTRY_NETWORKS[approval.network].encoding.pubKeyHash
            ),
            purpose: 'voting' as const,
          }));
        const response = await this.host.withSigningMaterial(
          {
            authentication: params.password,
            scope,
            walletAuthorities,
            signal: lifetime.signal,
            assertCurrent: assertPending,
          },
          async (material) => {
            const votes: SentryGovernanceVoteResponse[] = [];
            for (const node of approval.nodes) {
              if (this.pending(params.id) !== pending)
                throw new Error('Vote approval was cancelled');
              let key: SentryAuthorityKey | undefined;
              try {
                if (node.keyId === 'wallet-voting') {
                  const address = syscoinUtils.bitcoinjs.address.toBase58Check(
                    Buffer.from(node.votingKeyId, 'hex'),
                    SENTRY_NETWORKS[approval.network].encoding.pubKeyHash
                  );
                  const secret = material.resolveWalletAuthority({
                    address,
                    purpose: 'voting',
                  });
                  if (!secret)
                    throw new Error(
                      'Selected wallet has no private Sentry authority key'
                    );
                  key = await this.host.runCrypto<SentryAuthorityKey>(
                    {
                      type: 'import',
                      role: 'voting',
                      scheme: 'secp256k1',
                      secretKey: secret.secretKey,
                    },
                    assertPending
                  );
                } else {
                  key = await this.host.loadKey({
                    scope,
                    network: approval.network,
                    id: node.keyId,
                    seed: material.seed,
                    assertCurrent: assertPending,
                  });
                }
                assertPending();
                if (
                  key.role !== 'voting' ||
                  key.scheme !== 'secp256k1' ||
                  (node.publicKey && node.publicKey !== key.publicKey)
                )
                  throw new Error(
                    'The selected key is not this node’s registered voting key'
                  );
                const vote =
                  await this.host.runCrypto<SentryGovernanceVoteResponse>(
                    {
                      type: 'signVote',
                      request: approval.request,
                      context: fresh.context,
                      proTxHash: node.proTxHash,
                      key,
                    },
                    assertPending
                  );
                if (this.pending(params.id) !== pending)
                  throw new Error('Vote approval was cancelled');
                votes.push(vote);
              } finally {
                if (key) key.secretKey = '';
              }
            }
            return {
              version: 1,
              chain: approval.request.chain,
              proposalHash: approval.request.proposalHash,
              signal: approval.request.signal,
              outcome: approval.request.outcome,
              timestamp: approval.request.timestamp,
              votes,
            };
          }
        );
        assertPending();
        this.approvals.delete(params.id);
        return response;
      });
    } finally {
      pending.signing = false;
    }
  }
}
