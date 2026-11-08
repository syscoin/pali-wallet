import { createDappSigningApproval } from '../../../../source/wallet/dappSigningApproval.ts';
import {
  isDappMessageMethod,
  readDappMessageRequest,
  type DappMessageRequest,
} from '../../../../source/shared/dappMessageRequest.ts';
import { assertDappTypedDataValid } from '../../../../source/shared/dappTypedDataValidation.ts';
import { getPersonalSignReview } from '../../../../source/utils/personalSignReview.ts';
import { reviewDappMessageAdvisories, reviewDappAddressAdvisories } from '../../../../source/shared/dappMessageAdvisories.ts';
import { normalizeDappTransaction } from '../../../../source/shared/dappTransaction.ts';
import { getBlacklistTargetsForEvmCall } from '../../../../source/shared/evmCallBlacklist.ts';
import { getEffectiveApprovalData } from '../../../../source/shared/approval.ts';
import type { IBlacklistCheckResult } from '../../../../source/types/security.ts';
import { getTypedOrderReview } from '../../../../source/utils/typedOrderReview.ts';
import { createDappSessions } from '../../../../source/wallet/dappSessions.ts';
import { DAPP_REQUEST_LIMITS } from '../../../../source/utils/requestPayloadBudget.ts';
import { createDappApprovalLifetime } from '../../../../source/utils/dappApprovalLifetime.ts';
import type { DappSessionEvent } from '../../../../source/wallet/dappSessions.ts';
import type { KeyringAccountType } from '../../../../source/types/network.ts';
import type { CustodySnapshot } from '../custody/types.ts';
import type { NativeConnectionHost } from './host.ts';
import type { NativeConnectionRepository } from './storage.ts';
import {
  openWalletConnectTransport,
  type WalletConnectTransport,
  type WalletConnectTransportEvent,
  type WalletConnectProposal,
  type WalletConnectSession,
  type WalletConnectRequest,
  type WalletConnectPairing,
} from './walletConnect.ts';
import type {
  NativeConnectionError,
  NativeMessageReview,
  NativeSigningReview,
  NativeTransactionReview,
  NativeMessageReviewError,
  NativeConnectionsSnapshot,
  NativeConnectionsView,
} from './types.ts';

const METHODS = Object.freeze([
  'eth_chainId',
  'net_version',
  'eth_accounts',
  'eth_requestAccounts',
  'eth_sendTransaction',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
]);
const EVENTS = Object.freeze(['accountsChanged', 'chainChanged']);
type Source = {
  getSnapshot(): CustodySnapshot;
  subscribe(listener: (snapshot: CustodySnapshot) => void): () => void;
};
type Engine = ReturnType<typeof createDappSessions>;
type Connected = { id: string; session: WalletConnectSession; engine: Engine };
type MessageApproval = ReturnType<typeof createDappSigningApproval>;
type TransactionRequest = Readonly<{
  method: 'eth_sendTransaction';
  transaction: ReturnType<typeof normalizeDappTransaction>;
}>;
type PrivateSigningReview =
  | Omit<NativeMessageReview, 'revision' | 'needsAccountSwitch' | 'busy' | 'dispatched'>
  | Omit<NativeTransactionReview, 'revision' | 'needsAccountSwitch' | 'busy' | 'dispatched'>;
type PendingSigning = {
  id: string;
  wire: WalletConnectRequest;
  connection: Connected;
  session: WalletConnectSession;
  request: DappMessageRequest | TransactionRequest;
  accountId: string;
  networkId: string;
  networkFingerprint: string;
  accountXpub: string;
  approval: MessageApproval | undefined;
  review: PrivateSigningReview;
  prepared?: Awaited<ReturnType<NativeConnectionHost['prepareTransaction']>>;
  broadcastHash?: string;
  requestExpiresAt: number;
  sourceRevision: number;
  timer: ReturnType<typeof setTimeout>;
  busy: boolean;
  switching: boolean;
  switchRevision?: number;
  dispatched: boolean;
};
const MESSAGE_REVIEW_LIFETIME_MS = 5 * 60_000;
type Options = {
  source: Source;
  activateAccount(accountId: string, expectedRevision: number, assertCurrent: () => void): Promise<void>;
  openHost(): Promise<NativeConnectionHost>;
  preparePlatform(): Promise<void>;
  checkSite(origin: string): Promise<Readonly<{ isBlacklisted: boolean }>>;
  checkAddress(address: string): Promise<IBlacklistCheckResult>;
  projectId: string;
  metadata: Parameters<typeof openWalletConnectTransport>[0]['metadata'];
  openTransport?: typeof openWalletConnectTransport;
};
class ConnectionActionError extends Error {
  readonly code: NativeConnectionError;
  constructor(code: NativeConnectionError) {
    super(code);
    this.code = code;
  }
}
const failure = (code: NativeConnectionError): never => {
  throw new ConnectionActionError(code);
};
const sessionKey = (session: WalletConnectSession) =>
  `${session.binding.peerPublicKey}:${session.binding.topic}`;
const sessionEventChain = (session: WalletConnectSession, name: string) => {
  for (const namespace of Object.values(session.namespaces)) {
    if (!namespace.events.includes(name)) continue;
    const account = namespace.accounts.find((value) =>
      /^eip155:\d+:[^:]+$/.test(value)
    );
    if (account) return account.slice(0, account.lastIndexOf(':'));
  }
  return undefined;
};

/** Native lifecycle and public view adapter. The common engine owns every grant. */
export class NativeConnectionsController {
  private host: NativeConnectionHost | undefined;
  private repository: NativeConnectionRepository | undefined;
  private transport: WalletConnectTransport | undefined;
  private opening: Promise<void> | undefined;
  private openingTransport: Promise<void> | undefined;
  private restored = false;
  private transportOwner: object | undefined;
  private transportRetirement: Promise<void> = Promise.resolve();
  private publishedScope: { network: string; accounts: string } | undefined;
  private closing: Promise<void> | undefined;
  private disposed = false;
  private readonly lifetime = new AbortController();
  private revision = 0;
  private actionEpoch = 0;
  private serial = 0;
  private action: AbortController | undefined;
  private pairing: WalletConnectPairing | undefined;
  private activeGrant: Connected | undefined;
  private activeProposalId: number | undefined;
  private readonly canceledPairings = new Map<string, WalletConnectPairing>();
  private status: 'ready' | 'pairing' | 'approving' | 'unavailable' = 'ready';
  private error: NativeConnectionError | null = null;
  private readonly connections = new Map<string, Connected>();
  private readonly proposals = new Map<number, WalletConnectProposal>();
  private readonly requests = new Map<string, PendingSigning>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private snapshot: NativeConnectionsSnapshot;
  readonly view: NativeConnectionsView;

  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
    this.snapshot = this.project();
    this.view = Object.freeze({
      getSnapshot: () => this.snapshot,
      subscribe: (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
      pair: (uri) => this.perform(() => this.pair(uri)),
      approve: (id, accountId, networkId, revision) =>
        this.perform(() => this.approve(id, accountId, networkId, revision)),
      reject: (id) => this.perform(() => this.reject(id)),
      disconnect: (id) => this.perform(() => this.disconnect(id)),
      approveRequest: (id, revision, acknowledgeWarning) =>
        this.perform(
          () => this.approveRequest(id, revision, acknowledgeWarning),
          { owner: this.requests.get(id) }
        ),
      rejectRequest: (id) =>
        this.perform(() => this.rejectRequest(id), {
          owner: this.requests.get(id),
        }),
      activateRequestAccount: (id, revision) =>
        this.perform(() => this.activateRequestAccount(id, revision), {
          owner: this.requests.get(id),
        }),
      editApprovalAmount: (id, revision, amount) =>
        this.perform(() => this.editApprovalAmount(id, revision, amount), { owner: this.requests.get(id) }),
      retry: () =>
        this.perform(async () => {
          if (this.action) return failure('BUSY');
          if (this.options.source.getSnapshot().phase !== 'ready')
            return failure('CONTEXT_CHANGED');
          await this.ensure();
        }),
      cancel: () => this.cancel(),
    });
    this.unsubscribe = options.source.subscribe(() => {
      const phase = options.source.getSnapshot().phase;
      if (phase !== 'ready' && (this.action || this.pairing)) this.cancel();
      this.revalidateSigningRequests();
      const previous = this.publishedScope;
      const current = this.publicScope();
      this.publishedScope = current;
      if (current && previous)
        for (const connection of this.connections.values()) {
          if (current.accounts !== previous.accounts)
            void connection.engine.handleStateChange('pali_accountsChanged', {
              method: 'pali_accountsChanged',
              params: [],
            });
          if (current.network !== previous.network) {
            const network = this.host!.context().network;
            void connection.engine.handleStateChange('pali_chainChanged', {
              method: 'pali_chainChanged',
              params: {
                chainId: `0x${network.chainId.toString(16)}`,
                networkVersion: network.chainId,
                isBitcoinBased: network.kind === 'syscoin',
              },
            });
          }
        }
      this.publish();
      if (phase === 'ready') void this.ensure().catch(() => this.unavailable());
    });
    if (options.source.getSnapshot().phase === 'ready')
      void this.ensure().catch(() => this.unavailable());
  }

  private check() {
    if (this.disposed) return failure('CONNECTION_UNAVAILABLE');
    this.host?.assertOwner();
    this.repository?.assertHealthy();
  }
  private unavailable() {
    if (!this.disposed) {
      this.restored = false;
      this.actionEpoch++;
      this.action?.abort();
      this.action = undefined;
      this.pairing = undefined;
      this.activeGrant = undefined;
      this.activeProposalId = undefined;
      this.transportOwner = undefined;
      const transport = this.transport;
      this.transport = undefined;
      this.connections.clear();
      this.proposals.clear();
      if (transport)
        void this.retireTransport(transport).catch(() => undefined);
      for (const message of [...this.requests.values()])
        void this.retireRequest(message, false);
      this.status = 'unavailable';
      this.error = 'CONNECTION_UNAVAILABLE';
      this.publish();
    }
  }
  private retireTransport(transport: WalletConnectTransport): Promise<void> {
    const closing = Promise.resolve().then(() => transport.close());
    this.transportRetirement = Promise.all([
      this.transportRetirement,
      closing,
    ]).then(() => undefined);
    void this.transportRetirement.catch(() => undefined);
    return closing;
  }
  private requiredMethods(proposal: WalletConnectProposal): string[] {
    return [
      ...new Set(
        Object.values(proposal.requiredNamespaces).flatMap((raw) => {
          const methods = (raw as { methods?: unknown }).methods;
          return Array.isArray(methods)
            ? methods.filter(
                (method): method is string => typeof method === 'string'
              )
            : [];
        })
      ),
    ];
  }
  private canApprove(proposal: WalletConnectProposal): boolean {
    if (
      proposal.verification.isScam ||
      proposal.verification.validation === 'INVALID'
    )
      return false;
    const context = this.host?.context();
    if (!context || context.network.kind !== 'ethereum') return false;
    const chain = `eip155:${context.network.chainId}`;
    return Object.entries(proposal.requiredNamespaces).every(([name, raw]) => {
      const requirement = raw as {
        chains?: string[];
        methods?: string[];
        events?: string[];
      };
      return (
        (name === 'eip155' || name === chain) &&
        (requirement.chains ?? [chain]).every((id) => id === chain) &&
        (requirement.methods ?? []).every((method) =>
          METHODS.includes(method)
        ) &&
        (requirement.events ?? []).every((event) => EVENTS.includes(event))
      );
    });
  }
  private project(): NativeConnectionsSnapshot {
    const ready =
      this.options.source.getSnapshot().phase === 'ready' && !this.disposed;
    let context: ReturnType<NativeConnectionHost['context']> | undefined;
    try {
      context = this.host?.context();
    } catch {
      /* A retired host never contributes account data. */
    }
    const evm = context?.network.kind === 'ethereum';
    return Object.freeze({
      revision: this.revision,
      status: ready ? this.status : 'locked',
      selectedAccountId: ready && evm ? context!.activeAccountId : null,
      accounts: Object.freeze(
        ready && evm
          ? context!.accounts.map(({ id, label, address }) =>
              Object.freeze({ id, label, address })
            )
          : []
      ),
      network:
        ready && evm
          ? Object.freeze({
              id: context!.networkId,
              label: context!.networkLabel,
              chainId: String(context!.network.chainId),
            })
          : null,
      proposals: Object.freeze(
        ready
          ? [...this.proposals.values()].map((proposal) =>
              Object.freeze({
                id: proposal.id,
                name: proposal.metadata.name,
                origin: new URL(proposal.metadata.url).origin,
                verification: proposal.verification,
                requiredMethods: Object.freeze(this.requiredMethods(proposal)),
                canApprove: this.canApprove(proposal),
              })
            )
          : []
      ),
      sessions: Object.freeze(
        ready
          ? [...this.connections.values()].flatMap(
              ({ id, session, engine }) => {
                const grant = engine.get(session.binding.origin);
                if (!grant) return [];
                const account = context?.accounts.find(
                  (value) =>
                    value.index === grant.accountId &&
                    value.type === grant.accountType
                );
                return [
                  Object.freeze({
                    id,
                    name: session.metadata.name,
                    origin: session.binding.origin,
                    accountLabel: account?.label ?? 'Account',
                    networkLabel:
                      grant.chainId === context?.network.chainId
                        ? context.networkLabel
                        : `Chain ${grant.chainId}`,
                  }),
                ];
              }
            )
          : []
      ),
      signingReview: ready ? this.signingReview() : null,
      error: ready ? this.error : null,
    });
  }
  private publish() {
    this.revision++;
    this.snapshot = this.project();
    for (const listener of this.listeners) listener();
  }
  private publicScope() {
    try {
      const context = this.host?.context();
      if (!context) return undefined;
      return {
        network: JSON.stringify([
          context.networkId,
          context.network.chainId,
          context.network.url,
        ]),
        accounts: JSON.stringify([
          context.unlocked,
          context.accounts.map(({ id, address, xpub }) => [id, address, xpub]),
        ]),
      };
    } catch {
      return undefined;
    }
  }
  private ensure(): Promise<void> {
    if (this.restored) {
      return Promise.resolve().then(() => this.check());
    }
    if (this.opening) return this.opening;
    this.opening = (async () => {
      if (this.options.source.getSnapshot().phase !== 'ready')
        return failure('CONTEXT_CHANGED');
      if (!this.host || !this.repository) {
        this.host = await this.options.openHost();
        this.check();
        this.repository = this.host.repository;
      }
      this.repository.assertHealthy();
      this.publishedScope = this.publicScope();
      await this.transportRetirement;
      if (this.repository.bindings().length) await this.ensureTransport();
      this.check();
      this.restored = true;
      if (!this.action) this.status = 'ready';
      this.error = null;
      this.publish();
    })().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }
  private ensureTransport(): Promise<void> {
    if (this.transport) return Promise.resolve();
    if (this.openingTransport) return this.openingTransport;
    this.openingTransport = (async () => {
      if (!this.repository || !this.options.projectId)
        return failure('CONNECTION_UNAVAILABLE');
      const owner = {};
      const events: WalletConnectTransportEvent[] = [];
      this.transportOwner = owner;
      const guard = () => {
        this.check();
        if (this.transportOwner !== owner) return failure('CONTEXT_CHANGED');
      };
      let transport: WalletConnectTransport | undefined;
      try {
        await this.transportRetirement;
        guard();
        transport = await (
          this.options.openTransport ?? openWalletConnectTransport
        )({
          projectId: this.options.projectId,
          metadata: this.options.metadata,
          repository: this.repository,
          supportedMethods: METHODS,
          supportedEvents: EVENTS,
          assertOwner: guard,
          preparePlatform: this.options.preparePlatform,
          signal: this.lifetime.signal,
          onEvent: (event) => {
            if (this.disposed || this.transportOwner !== owner) return;
            if (this.transport === transport && transport) this.onEvent(event);
            else events.push(event);
          },
        });
        guard();
        const sessions = await transport.sessions();
        guard();
        await this.repository.reconcileSessions(
          sessions.map(({ binding }) => binding),
          guard
        );
        guard();
        this.transport = transport;
        for (const session of sessions) this.connection(session);
        for (const event of events) this.onEvent(event);
        guard();
      } catch (error) {
        if (this.transportOwner === owner) {
          this.transportOwner = undefined;
          this.transport = undefined;
          this.connections.clear();
          this.proposals.clear();
        }
        if (transport) await this.retireTransport(transport);
        throw error;
      }
    })().finally(() => {
      this.openingTransport = undefined;
    });
    return this.openingTransport;
  }
  private connection(session: WalletConnectSession): Connected {
    const key = sessionKey(session),
      previous = this.connections.get(key);
    if (previous) {
      previous.session = session;
      return previous;
    }
    const host = this.host!,
      repository = this.repository!,
      transport = this.transport!;
    const engine = createDappSessions({
      wallet: () => {
        host.assertOwner();
        const context = host.context();
        return {
          generation: 0,
          activeSlip44: context.network.slip44,
          isBitcoinBased: context.network.kind === 'syscoin',
          network: context.network,
          unlocked: context.unlocked,
        };
      },
      account: (id, type) =>
        host
          .context()
          .accounts.find(
            (account) => account.index === id && account.type === type
          ),
      canPublishAccount: (account) => !!account,
      isAccountAvailable: (account, _type, network) =>
        !!account && network.kind === 'ethereum',
      permissions: repository.permissions(session.binding),
      resolveDelivery: async (origin, id) => {
        if (
          origin !== session.binding.origin ||
          !['pali_accountsChanged', 'pali_chainChanged'].includes(id)
        )
          return null;
        return async (prepare, current) => {
          const revision = this.options.source.getSnapshot().revision;
          const connection = this.connections.get(key);
          const selectedSession = connection?.session;
          const grant = engine.get(origin);
          if (!selectedSession) return;
          const guard = () => {
            if (
              !current() ||
              revision !== this.options.source.getSnapshot().revision ||
              this.connections.get(key) !== connection ||
              connection?.session !== selectedSession ||
              engine.get(origin) !== grant
            )
              failure('CONTEXT_CHANGED');
          };
          guard();
          const event: DappSessionEvent = prepare();
          const message =
            id === 'pali_accountsChanged'
              ? { name: 'accountsChanged', data: event.params }
              : {
                  name: 'chainChanged',
                  data: (event.params as { chainId: string }).chainId,
                };
          // A network change or removed grant cannot expand session permissions.
          const chainId = grant
            ? `eip155:${grant.chainId}`
            : sessionEventChain(selectedSession, message.name);
          if (!chainId) return;
          guard();
          await transport.emit(session.binding, chainId, message, guard);
        };
      },
      providerAvailability: async () => undefined,
      notifyConnection: () => this.publish(),
      clearProviderCache() {},
      now: Date.now,
      reportError: () => undefined,
    });
    engine.setup(session.binding.origin);
    const connection = { id: `connection-${++this.serial}`, session, engine };
    this.connections.set(key, connection);
    return connection;
  }
  private onEvent(event: WalletConnectTransportEvent) {
    if (this.disposed) return;
    if (event.type === 'proposal') {
      this.pruneCanceledPairings();
      if (this.canceledPairings.has(event.proposal.pairingTopic)) {
        void this.transport!.reject(event.proposal, {
          code: 5000,
          message: 'Connection cancelled',
        }).catch(() => {
          this.error = 'CONNECTION_UNAVAILABLE';
          this.publish();
        });
        return;
      }
      this.proposals.set(event.proposal.id, event.proposal);
      if (!this.action) this.status = 'ready';
    } else if (event.type === 'proposal-expired') {
      this.proposals.delete(event.id);
      this.error = 'REQUEST_EXPIRED';
    } else if (event.type === 'session') this.connection(event.session);
    else if (event.type === 'session-ended') {
      for (const [key, value] of this.connections)
        if (value.session.binding.topic === event.topic) {
          void value.engine
            .revoke(value.session.binding.origin, {
              allowAlreadyDisconnected: true,
            })
            .catch(() => this.unavailable());
          this.connections.delete(key);
        }
    } else if (event.type === 'request-expired') {
      for (const message of this.requests.values())
        if (message.wire.id === event.id) this.retireRequest(message, false);
    } else if (event.type === 'request')
      void this.respond(event.request).catch(() => {
        try {
          this.check();
        } catch {
          this.unavailable();
        }
      });
    else if (event.type === 'unavailable') this.unavailable();
    this.revalidateSigningRequests();
    this.publish();
  }
  private async perform(
    operation: () => Promise<void>,
    messageScope?: Readonly<{ owner: PendingSigning | undefined }>
  ): Promise<void> {
    let epoch = this.actionEpoch;
    try {
      this.check();
      const result = operation();
      epoch = this.actionEpoch;
      await result;
    } catch (error) {
      if (
        epoch === this.actionEpoch &&
        !this.disposed &&
        (!messageScope ||
          (messageScope.owner !== undefined &&
            this.requests.get(messageScope.owner.id) === messageScope.owner))
      ) {
        this.error =
          error instanceof ConnectionActionError
            ? error.code
            : 'CONNECTION_UNAVAILABLE';
        this.publish();
      }
      throw error;
    }
  }
  private pruneCanceledPairings() {
    for (const [topic, pairing] of this.canceledPairings)
      if (pairing.expiresAt <= Date.now()) this.canceledPairings.delete(topic);
  }
  private async pair(uri: string) {
    this.pruneCanceledPairings();
    if (
      this.action ||
      this.canceledPairings.size >= DAPP_REQUEST_LIMITS.pendingRequests
    )
      return failure('BUSY');
    if (!uri.startsWith('wc:') || uri.length > 4096)
      return failure('INVALID_LINK');
    const action = new AbortController(),
      revision = this.options.source.getSnapshot().revision;
    this.action = action;
    this.actionEpoch++;
    this.status = 'pairing';
    this.error = null;
    this.publish();
    const guard = () => {
      this.check();
      if (
        action.signal.aborted ||
        this.action !== action ||
        this.options.source.getSnapshot().phase !== 'ready' ||
        this.options.source.getSnapshot().revision !== revision
      )
        failure('CONTEXT_CHANGED');
    };
    let attemptedPairing: WalletConnectPairing | undefined;
    try {
      await this.ensure();
      guard();
      await this.ensureTransport();
      guard();
      const pairing = await this.transport!.pair(uri, guard, (pairing) => {
        guard();
        attemptedPairing = pairing;
        this.pairing = pairing;
      });
      try {
        guard();
        this.pairing = pairing;
      } catch (error) {
        void pairing.cancel().catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (this.action === action) {
        if (attemptedPairing) {
          this.canceledPairings.set(attemptedPairing.topic, attemptedPairing);
          for (const [id, proposal] of this.proposals)
            if (proposal.pairingTopic === attemptedPairing.topic)
              this.proposals.delete(id);
          if (this.pairing === attemptedPairing) this.pairing = undefined;
        }
        if (this.snapshot.status !== 'unavailable') this.status = 'ready';
      }
      throw error;
    } finally {
      if (this.action === action) {
        this.action = undefined;
        if (this.proposals.size) this.status = 'ready';
        this.publish();
      }
    }
  }
  private async approve(
    id: number,
    accountId: string,
    networkId: string,
    revision: number
  ) {
    if (this.action) return failure('BUSY');
    if (revision !== this.revision) return failure('CONTEXT_CHANGED');
    const proposal = this.proposals.get(id),
      context = this.host?.context();
    if (!context) return failure('CONTEXT_CHANGED');
    const account = context.accounts.find((value) => value.id === accountId);
    if (
      !proposal ||
      !account ||
      context.networkId !== networkId ||
      this.options.source.getSnapshot().phase !== 'ready'
    )
      return failure('CONTEXT_CHANGED');
    if (proposal.verification.isScam) return failure('BLOCKED_SITE');
    if (proposal.verification.validation === 'INVALID')
      return failure('SITE_MISMATCH');
    if (!this.canApprove(proposal)) return failure('UNSUPPORTED_REQUEST');
    const action = new AbortController(),
      sourceRevision = this.options.source.getSnapshot().revision;
    this.action = action;
    this.actionEpoch++;
    this.activeProposalId = id;
    this.status = 'approving';
    this.error = null;
    this.publish();
    const lifetime = createDappApprovalLifetime(() => {
      const current = this.host!.context();
      return (
        !this.disposed &&
        this.options.source.getSnapshot().phase === 'ready' &&
        this.options.source.getSnapshot().revision === sourceRevision &&
        current.networkId === networkId &&
        current.accounts.some(
          (value) =>
            value.id === accountId &&
            value.address === account.address &&
            value.xpub === account.xpub
        ) &&
        this.proposals.get(id) === proposal
      );
    }, action.signal);
    const guard = () => {
      this.check();
      if (!lifetime.isCurrent()) failure('CONTEXT_CHANGED');
    };
    let connected: Connected | undefined;
    try {
      await this.ensure();
      guard();
      await this.ensureTransport();
      guard();
      const site = await this.options.checkSite(
        new URL(proposal.metadata.url).origin
      );
      guard();
      if (site.isBlacklisted) return failure('BLOCKED_SITE');
      const chain = `eip155:${context.network.chainId}`;
      const requested = [
        ...Object.values(proposal.requiredNamespaces),
        ...Object.values(proposal.optionalNamespaces),
      ] as { methods?: string[]; events?: string[] }[];
      const methods = [
        ...new Set(
          requested
            .flatMap((value) => value.methods ?? [])
            .filter((value) => METHODS.includes(value))
        ),
      ];
      const events = [
        ...new Set(
          requested
            .flatMap((value) => value.events ?? [])
            .filter((value) => EVENTS.includes(value))
        ),
      ];
      const session = await this.transport!.approve(
        proposal,
        {
          eip155: {
            chains: [chain],
            accounts: [`${chain}:${account.address}`],
            methods,
            events,
          },
        },
        guard
      );
      guard();
      connected = this.connection(session);
      this.activeGrant = connected;
      await connected.engine.connect(
        {
          host: session.binding.origin,
          accountId: account.index,
          accountType: account.type as KeyringAccountType,
          chain: context.network.kind,
          chainId: context.network.chainId,
          date: Date.now(),
        },
        {
          address: account.address,
          xpub: account.xpub,
          network: context.network,
        }
      );
      guard();
      this.proposals.delete(id);
      this.pairing = undefined;
    } catch (error) {
      if (connected) {
        await connected.engine.revoke(connected.session.binding.origin, {
          allowAlreadyDisconnected: true,
        });
        this.connections.delete(sessionKey(connected.session));
        this.notifyRemoteDisconnect(connected);
      }
      throw error;
    } finally {
      lifetime.dispose();
      if (this.action === action) {
        this.activeGrant = undefined;
        this.activeProposalId = undefined;
        this.action = undefined;
        this.status = 'ready';
        this.publish();
      }
    }
  }
  private async reject(id: number) {
    const proposal = this.proposals.get(id);
    if (!proposal) return failure('REQUEST_EXPIRED');
    if (this.activeProposalId === id) {
      this.actionEpoch++;
      this.action?.abort();
      const grant = this.activeGrant;
      if (grant)
        void grant.engine
          .revoke(grant.session.binding.origin, {
            allowAlreadyDisconnected: true,
          })
          .catch(() => this.unavailable());
    }
    this.proposals.delete(id);
    this.status = 'ready';
    this.publish();
    await this.ensure();
    await this.ensureTransport();
    await this.transport!.reject(proposal, {
      code: 5000,
      message: 'User rejected',
    });
  }
  private async disconnect(id: string) {
    this.check();
    const connected = [...this.connections.values()].find(
      (value) => value.id === id
    );
    if (!connected) return;
    for (const message of [...this.requests.values()])
      if (message.connection === connected) void this.retireRequest(message);
    await connected.engine.revoke(connected.session.binding.origin, {
      allowAlreadyDisconnected: true,
    });
    this.connections.delete(sessionKey(connected.session));
    this.publish();
    this.notifyRemoteDisconnect(connected);
  }
  private notifyRemoteDisconnect(connected: Connected) {
    const epoch = this.actionEpoch;
    void this.transport!.disconnect(connected.session.binding).catch(() => {
      if (!this.disposed && this.actionEpoch === epoch) {
        this.error = 'CONNECTION_UNAVAILABLE';
        this.publish();
      }
    });
  }
  private async respond(request: WalletConnectRequest) {
    this.check();
    const key = sessionKey(request.session);
    const connected = this.connections.get(key);
    const session = connected?.session;
    const grant = connected?.engine.get(request.session.binding.origin);
    const context = this.host!.context(),
      revision = this.options.source.getSnapshot().revision;
    const guard = () => {
      this.check();
      if (
        revision !== this.options.source.getSnapshot().revision ||
        context.networkId !== this.host!.context().networkId ||
        this.connections.get(key) !== connected ||
        connected?.session !== session ||
        connected?.engine.get(request.session.binding.origin) !== grant
      )
        failure('CONTEXT_CHANGED');
    };
    if (isDappMessageMethod(request.method) || request.method === 'eth_sendTransaction') {
      await this.queueSigningRequest(request);
      return;
    }
    let result: unknown, error: { code: number; message: string } | undefined;
    if (!connected?.engine.isConnected(request.session.binding.origin))
      error = { code: 4100, message: 'Not connected' };
    else if (request.chainId !== `eip155:${context.network.chainId}`)
      error = { code: 4901, message: 'Requested chain is not selected' };
    else if (request.method === 'eth_chainId')
      result = `0x${context.network.chainId.toString(16)}`;
    else if (request.method === 'net_version')
      result = String(context.network.chainId);
    else if (
      request.method === 'eth_accounts' ||
      request.method === 'eth_requestAccounts'
    ) {
      const account = connected.engine.getAccount(
        request.session.binding.origin
      );
      result = context.unlocked && account ? [account.address] : [];
    } else error = { code: 4200, message: 'Unsupported method' };
    await this.transport!.respond(
      request.session.binding,
      request.id,
      error ? { error } : { result },
      guard,
      () => undefined
    );
  }
  private signingReview(): NativeSigningReview | null {
    const message = this.requests.values().next().value as
      | PendingSigning
      | undefined;
    if (!message) return null;
    try {
      return Object.freeze({
        ...message.review,
        revision: this.revision,
        busy: message.busy,
        dispatched: message.dispatched,
        needsAccountSwitch:
          this.host!.context().activeAccountId !== message.accountId,
      });
    } catch {
      return null;
    }
  }
  private requestConnectionCurrent(message: PendingSigning): boolean {
    const snapshot = this.options.source.getSnapshot();
    const currentPhase = snapshot.phase === 'ready' ||
      (message.switching && snapshot.phase === 'authenticating' && snapshot.revision === message.switchRevision);
    const context = this.host?.context();
    const account = context?.accounts.find(
      (entry) => entry.id === message.accountId
    );
    return (
      !this.disposed &&
      currentPhase &&
      context?.networkId === message.networkId &&
      JSON.stringify(context.network) === message.networkFingerprint &&
      account?.address === message.review.address &&
      account.xpub === message.accountXpub &&
      this.requests.get(message.id) === message &&
      this.connections.get(sessionKey(message.session)) ===
        message.connection &&
      message.connection.session === message.session &&
      message.connection.engine.get(message.session.binding.origin) !==
        undefined &&
      Date.now() < message.review.expiresAt
    );
  }
  private captureSigningApproval(message: PendingSigning): MessageApproval {
    const host = this.host!;
    message.sourceRevision = this.options.source.getSnapshot().revision;
    const readScope = () => {
      try {
        const context = host.context();
        const account = context.accounts.find(
          (entry) => entry.id === message.accountId
        );
        return {
          account: account
            ? {
                id: account.index,
                type: account.type,
                address: account.address,
                xpub: account.xpub,
              }
            : { id: -1, type: 'HDAccount' },
          grant: message.connection.engine.get(message.session.binding.origin),
          isBitcoinBased: context.network.kind === 'syscoin',
          network: context.network,
          sessionGeneration: host.sessionGeneration(),
        };
      } catch {
        return {
          account: { id: -1, type: 'HDAccount' },
          grant: undefined,
          isBitcoinBased: false,
          network: { kind: '', chainId: -1 },
          sessionGeneration: -1,
        };
      }
    };
    const approval = createDappSigningApproval({
      readScope,
      signal: this.lifetime.signal,
      subscribe: (changed) => this.options.source.subscribe(() => changed()),
    });
    try {
      approval.bindSigner(
        'native-connection-request',
        () =>
          this.requestConnectionCurrent(message) &&
          message.sourceRevision === this.options.source.getSnapshot().revision
      );
      return approval;
    } catch (error) {
      approval.dispose();
      throw error;
    }
  }
  private revalidateSigningRequests() {
    for (const message of [...this.requests.values()]) {
      try {
        if (!this.requestConnectionCurrent(message))
          throw Error('Stale request');
        if (!message.switching && !message.dispatched)
          message.approval?.assertCurrent();
      } catch {
        void this.retireRequest(message);
      }
    }
  }
  private retireRequest(
    message: PendingSigning,
    respond = true
  ): Promise<void> {
    if (this.requests.get(message.id) !== message) return Promise.resolve();
    this.requests.delete(message.id);
    message.approval?.dispose();
    clearTimeout(message.timer);
    this.publish();
    if (!respond || message.dispatched || message.broadcastHash || this.disposed || !this.transport)
      return Promise.resolve();
    const guard = () => {
      this.check();
      if (
        this.connections.get(sessionKey(message.session))?.session !==
        message.session
      )
        failure('CONTEXT_CHANGED');
    };
    return this.transport
      .respond(
        message.session.binding,
        message.wire.id,
        { error: { code: 4001, message: 'User rejected or request expired' } },
        guard,
        () => undefined
      )
      .catch(() => undefined);
  }
  private async queueSigningRequest(wire: WalletConnectRequest) {
    const connection = this.connections.get(sessionKey(wire.session));
    const context = this.host!.context();
    const origin = wire.session.binding.origin;
    const grant = connection?.engine.get(origin);
    const account =
      grant &&
      context.accounts.find(
        (entry) =>
          entry.index === grant.accountId && entry.type === grant.accountType
      );
    const reject = (code: number, message: string) =>
      this.transport!.respond(
        wire.session.binding,
        wire.id,
        { error: { code, message } },
        () => this.check(),
        () => undefined
      );
    if (
      !connection ||
      !grant ||
      !account ||
      !context.unlocked ||
      this.options.source.getSnapshot().phase !== 'ready' ||
      context.network.kind !== 'ethereum'
    )
      return reject(4100, 'Account is unavailable');
    if (wire.chainId !== `eip155:${context.network.chainId}`)
      return reject(4901, 'Requested chain is not selected');
    const permitted = Object.values(connection.session.namespaces).some(
      (namespace) =>
        namespace.methods.includes(wire.method) &&
        namespace.accounts.some(
          (id) =>
            id.toLowerCase() ===
            `${wire.chainId}:${account.address}`.toLowerCase()
        )
    );
    if (!permitted) return reject(4100, 'Method or account is not authorized');
    if (
      this.requests.size >= DAPP_REQUEST_LIMITS.pendingRequests ||
      [...this.requests.values()].filter(
        (entry) => entry.connection === connection
      ).length >= DAPP_REQUEST_LIMITS.requestsPerOrigin
    )
      return reject(-32005, 'Too many requests');
    if (
      [...this.requests.values()].some(
        (entry) =>
          entry.wire.id === wire.id &&
          entry.session.binding.topic === wire.session.binding.topic
      )
    )
      return;
    let request: DappMessageRequest | TransactionRequest | undefined;
    try {
      if (wire.method === 'eth_sendTransaction') {
        if (!Array.isArray(wire.params) || wire.params.length !== 1) throw new Error('Invalid transaction parameters');
        const transaction = normalizeDappTransaction(wire.params[0]);
        if (transaction.from !== undefined && transaction.from.toLowerCase() !== account.address.toLowerCase())
          throw new Error('Transaction signer does not match account');
        if (transaction.chainId !== undefined && BigInt(transaction.chainId) !== BigInt(context.network.chainId))
          throw new Error('Transaction chain does not match session');
        request = { method: 'eth_sendTransaction', transaction: { ...transaction, from: account.address } };
      } else {
        assertDappTypedDataValid(wire.method, wire.params);
        request = readDappMessageRequest(wire.method, wire.params, account.address);
      }
    } catch {
      /* Invalid requests never become signing capabilities. */
    }
    if (!request) return reject(-32602, 'Invalid signing request');
    const personal =
      request.method === 'personal_sign'
        ? getPersonalSignReview(request.message, origin, account.address)
        : null;
    const error: NativeMessageReviewError | null = wire.verification.isScam
      ? 'BLOCKED_SITE'
      : wire.verification.validation === 'INVALID'
      ? 'SITE_MISMATCH'
      : personal?.error === 'send.signingForWrongAddress'
      ? 'SIGNER_MISMATCH'
      : personal?.error === 'send.suspiciousSignInRequest'
      ? 'SUSPICIOUS_SIGN_IN'
      : personal?.error
      ? 'INVALID_MESSAGE'
      : null;
    const order =
      request.method === 'eth_sendTransaction' || request.method === 'personal_sign' || request.version === 'V1'
        ? null
        : getTypedOrderReview(request.typedData);
    const expiresAt = Math.min(
      wire.expiresAt,
      Date.now() + MESSAGE_REVIEW_LIFETIME_MS,
      wire.session.expiry * 1000
    );
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
      return reject(4001, 'Request expired');
    const id = `request-${++this.serial}`;
    const message: PendingSigning = {
      id,
      wire,
      requestExpiresAt: expiresAt,
      connection,
      session: connection.session,
      request,
      accountId: account.id,
      networkId: context.networkId,
      networkFingerprint: JSON.stringify(context.network),
      accountXpub: account.xpub,
      approval: undefined,
      sourceRevision: this.options.source.getSnapshot().revision,
      busy: true,
      switching: false,
      dispatched: false,
      review: Object.freeze({
        id,
        appName: wire.session.metadata.name,
        origin,
        verification: wire.verification,
        accountLabel: account.label,
        address: account.address,
        networkLabel: context.networkLabel,
        chainId: String(context.network.chainId),
        expiresAt,
        error,
        advisories: Object.freeze([]),
        requiresWarningAcknowledgement: false,
        ...(request.method === 'eth_sendTransaction' ? {
          kind: 'transaction' as const,
          method: request.method,
          transaction: null,
          maximumFeeUnits: null,
          maximumTotalUnits: null,
          symbol: context.network.currency,
          decimals: 18,
          broadcastHash: null,
          approval: null,
        } : {
          kind: 'message' as const,
          method: request.method,
          message: personal?.message ?? null,
          typedData: request.method === 'personal_sign' ? null : JSON.stringify(request.typedData, null, 2),
          order: order ? Object.freeze({ ...order, warnings: Object.freeze([...order.warnings]) }) : null,
        }),
      }),
      timer: setTimeout(() => {
        void this.retireRequest(message);
      }, Math.max(0, expiresAt - Date.now())),
    };
    this.requests.set(id, message);
    try {
      message.approval = this.captureSigningApproval(message);
      this.publish();
      const site = await this.options.checkSite(origin);
      message.approval.assertCurrent();
      if (site.isBlacklisted)
        message.review = Object.freeze({
          ...message.review,
          error: 'BLOCKED_SITE',
        });
      if (request.method === 'eth_sendTransaction') {
        if (context.activeAccountId === account.id && !message.review.error)
          await this.prepareTransactionReview(message);
        message.busy = false;
        this.publish();
        return;
      }
      const advisories = await reviewDappMessageAdvisories({
        method: request.method,
        typedData:
          request.method === 'personal_sign' ? undefined : request.typedData,
        checkAddress: this.options.checkAddress,
        assertCurrent: message.approval.assertCurrent,
        onWarning: (warning) => {
          message.review = Object.freeze({
            ...message.review,
            advisories: Object.freeze([
              Object.freeze({
                ...warning,
                ...(warning.reason
                  ? { reason: warning.reason.slice(0, 512) }
                  : {}),
              }),
            ]),
            requiresWarningAcknowledgement: true,
          });
          this.publish();
        },
      });
      message.approval.assertCurrent();
      message.review = Object.freeze({
        ...message.review,
        advisories: Object.freeze(
          advisories.addresses.map((entry) =>
            Object.freeze({
              ...entry,
              ...(entry.reason ? { reason: entry.reason.slice(0, 512) } : {}),
            })
          )
        ),
        requiresWarningAcknowledgement: Boolean(advisories.warning),
      });
      message.busy = false;
      this.publish();
    } catch {
      if (message.request.method === 'eth_sendTransaction' && this.requestConnectionCurrent(message)) {
        message.prepared = undefined;
        message.busy = false;
        message.review = Object.freeze({ ...message.review, error: 'TRANSACTION_UNAVAILABLE' });
        this.publish();
        return;
      }
      await this.retireRequest(message);
    }
  }
  private async prepareTransactionReview(message: PendingSigning) {
    if (message.request.method !== 'eth_sendTransaction' || message.review.kind !== 'transaction')
      throw new Error('Invalid transaction request');
    const approval = message.approval;
    if (!approval) throw new Error('Missing request approval');
    approval.assertCurrent();
    const prepared = await this.host!.prepareTransaction({
      accountId: message.accountId,
      networkId: message.networkId,
      transaction: message.request.transaction,
      approval,
    }, approval.assertCurrent);
    approval.assertCurrent();
    const remaining = prepared.expiresAtMonotonicMilliseconds - Math.floor(performance.now());
    if (remaining <= 0) throw new Error('Transaction fee review expired');
    const advisories = await reviewDappAddressAdvisories({
      targets: getBlacklistTargetsForEvmCall({
        data: prepared.transaction.data,
        to: prepared.transaction.to ?? undefined,
        tokenStandard: prepared.approval?.standardVerified ? prepared.approval.tokenStandard : undefined,
      }).map(({ address, type, method }) => ({ address, field: method ?? type })),
      checkAddress: this.options.checkAddress,
      assertCurrent: approval.assertCurrent,
      onWarning: (warning) => {
        message.review = Object.freeze({
          ...message.review,
          advisories: Object.freeze([warning]),
          requiresWarningAcknowledgement: true,
        });
        this.publish();
      },
    });
    approval.assertCurrent();
    if (prepared.expiresAtMonotonicMilliseconds <= Math.floor(performance.now()))
      throw new Error('Transaction fee review expired');
    const expiresAt = Math.min(message.requestExpiresAt,
      Date.now() + Math.max(0, prepared.expiresAtMonotonicMilliseconds - Math.floor(performance.now())));
    message.prepared = prepared;
    message.review = Object.freeze({
      ...message.review,
      transaction: prepared.transaction,
      maximumFeeUnits: prepared.maximumFeeUnits,
      maximumTotalUnits: prepared.maximumTotalUnits,
      approval: prepared.approval,
      expiresAt,
      advisories: Object.freeze(advisories.addresses),
      requiresWarningAcknowledgement: Boolean(advisories.warning),
    });
    clearTimeout(message.timer);
    message.timer = setTimeout(() => { void this.retireRequest(message); }, Math.max(0, expiresAt - Date.now()));
  }
  private async editApprovalAmount(id: string, revision: number, amount: string) {
    const message = this.requests.get(id);
    if (!message || revision !== this.revision || this.requests.values().next().value !== message ||
        message.request.method !== 'eth_sendTransaction' || message.review.kind !== 'transaction' ||
        message.dispatched || message.broadcastHash) return failure('REQUEST_EXPIRED');
    if (message.busy || this.action) return failure('BUSY');
    const summary = message.prepared?.approval;
    if (!summary?.canEditAmount || !summary.token || summary.amountUnits === undefined || message.review.error)
      return failure('UNSUPPORTED_REQUEST');
    const effective = getEffectiveApprovalData({
      tokenStandard: summary.tokenStandard,
      approvalType: summary.approvalType, customAmount: amount,
      data: message.request.transaction.data, decimals: summary.token.decimals,
      decodedTx: { method: summary.method, inputs: [summary.authority, summary.amountUnits], names: ['spender', 'amount'], types: ['address', 'uint256'] },
      isCustom: true,
    });
    if (!effective) return failure('UNSUPPORTED_REQUEST');
    message.approval?.assertCurrent();
    message.prepared = undefined;
    message.busy = true;
    message.request = { ...message.request, transaction: { ...message.request.transaction, data: effective.data } };
    this.publish();
    try {
      await this.prepareTransactionReview(message);
      message.busy = false;
      this.publish();
    } catch (error) {
      if (this.requestConnectionCurrent(message)) {
        message.busy = false;
        message.review = Object.freeze({ ...message.review, error: 'TRANSACTION_UNAVAILABLE' });
        this.publish();
      } else await this.retireRequest(message);
      throw error;
    }
  }
  private async approveRequest(
    id: string,
    revision: number,
    acknowledgeWarning: boolean
  ) {
    const message = this.requests.get(id);
    if (
      !message ||
      revision !== this.revision ||
      this.requests.values().next().value !== message
    )
      return failure('REQUEST_EXPIRED');
    if (message.dispatched) return failure('REQUEST_EXPIRED');
    if (message.busy || this.action) return failure('BUSY');
    if (
      typeof acknowledgeWarning !== 'boolean' ||
      message.review.error ||
      (message.review.requiresWarningAcknowledgement && !acknowledgeWarning) ||
      this.host!.context().activeAccountId !== message.accountId
    )
      return failure('UNSUPPORTED_REQUEST');
    const approval = message.approval;
    if (!approval) return failure('REQUEST_EXPIRED');
    approval.assertCurrent();
    message.busy = true;
    this.publish();
    try {
      let result: string;
      if (message.request.method === 'eth_sendTransaction') {
        if (!message.prepared) return failure('REQUEST_EXPIRED');
        result = await message.prepared.submit(approval.assertCurrent, (hash) => {
          message.broadcastHash = hash;
          if (message.review.kind === 'transaction')
            message.review = Object.freeze({ ...message.review, broadcastHash: hash });
          this.publish();
        });
      } else {
        result = await this.host!.signMessage({
          accountId: message.accountId,
          networkId: message.networkId,
          request: message.request,
          approval,
        });
      }
      approval.assertCurrent();
      await this.transport!.respond(
        message.session.binding,
        message.wire.id,
        { result },
        approval.assertCurrent,
        () => {
          message.dispatched = true;
          queueMicrotask(() => {
            if (this.requests.get(message.id) === message) this.publish();
          });
        }
      );
      await this.retireRequest(message, false);
    } catch (error) {
      if (message.dispatched || message.broadcastHash) {
        approval.dispose();
        if (this.requests.get(message.id) === message) {
          message.busy = false;
          message.review = Object.freeze({
            ...message.review,
            error: 'DELIVERY_UNCERTAIN',
          });
          this.publish();
        }
        return failure('DELIVERY_UNCERTAIN');
      }
      await this.retireRequest(message);
      throw error;
    }
  }
  private rejectRequest(id: string): Promise<void> {
    const message = this.requests.get(id);
    if (!message) return Promise.resolve();
    if (message.dispatched && this.error === 'DELIVERY_UNCERTAIN')
      this.error = null;
    return this.retireRequest(message);
  }
  private async activateRequestAccount(id: string, revision: number) {
    const message = this.requests.get(id);
    if (
      !message ||
      revision !== this.revision ||
      this.requests.values().next().value !== message
    )
      return failure('REQUEST_EXPIRED');
    if (message.dispatched) return failure('REQUEST_EXPIRED');
    if (message.busy || this.action) return failure('BUSY');
    message.approval?.assertCurrent();
    const grant = message.connection.engine.get(message.session.binding.origin);
    const guard = () => {
      this.check();
      if (
        !this.requestConnectionCurrent(message) ||
        message.connection.engine.get(message.session.binding.origin) !== grant
      )
        failure('CONTEXT_CHANGED');
    };
    const expectedRevision = this.options.source.getSnapshot().revision;
    message.switchRevision = expectedRevision + 1;
    message.switching = true;
    message.busy = true;
    message.approval?.dispose();
    this.publish();
    try {
      await this.options.activateAccount(message.accountId, expectedRevision, guard);
      guard();
      message.approval = this.captureSigningApproval(message);
      message.switching = false;
      message.switchRevision = undefined;
      if (message.request.method === 'eth_sendTransaction')
        await this.prepareTransactionReview(message);
      message.busy = false;
      this.publish();
    } catch (error) {
      await this.retireRequest(message);
      throw error;
    }
  }
  private cancel() {
    // Leaving the connection screen may reveal an incoming message review.
    // Its cleanup owns pairing, while message rejection owns that request.
    this.error = null;
    this.actionEpoch++;
    this.action?.abort();
    this.action = undefined;
    const grant = this.activeGrant;
    this.activeGrant = undefined;
    if (grant)
      void grant.engine
        .revoke(grant.session.binding.origin, {
          allowAlreadyDisconnected: true,
        })
        .catch(() => this.unavailable());
    const pairing = this.pairing;
    this.pairing = undefined;
    if (pairing) {
      this.canceledPairings.set(pairing.topic, pairing);
      for (const [id, proposal] of this.proposals)
        if (proposal.pairingTopic === pairing.topic) this.proposals.delete(id);
      void pairing.cancel().catch(() => {
        this.error = 'CONNECTION_UNAVAILABLE';
        this.publish();
      });
    }
    if (this.status !== 'unavailable') this.status = 'ready';
    this.publish();
  }
  async dispose(): Promise<void> {
    if (this.closing) return this.closing;
    for (const message of [...this.requests.values()])
      this.retireRequest(message, false);
    this.disposed = true;
    this.transportOwner = undefined;
    this.lifetime.abort();
    this.action?.abort();
    this.unsubscribe();
    this.publish();
    this.closing = (async () => {
      await this.opening?.catch(() => undefined);
      await this.openingTransport?.catch(() => undefined);
      try {
        await this.transportRetirement;
        await this.transport?.close();
      } finally {
        this.connections.clear();
        this.proposals.clear();
      }
    })();
    return this.closing;
  }
}
