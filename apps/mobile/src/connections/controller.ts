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
  NativeConnectionsSnapshot,
  NativeConnectionsView,
} from './types.ts';

const METHODS = Object.freeze([
  'eth_chainId',
  'net_version',
  'eth_accounts',
  'eth_requestAccounts',
]);
const EVENTS = Object.freeze(['accountsChanged', 'chainChanged']);
type Source = {
  getSnapshot(): CustodySnapshot;
  subscribe(listener: (snapshot: CustodySnapshot) => void): () => void;
};
type Engine = ReturnType<typeof createDappSessions>;
type Connected = { id: string; session: WalletConnectSession; engine: Engine };
type Options = {
  source: Source;
  openHost(): Promise<NativeConnectionHost>;
  preparePlatform(): Promise<void>;
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
  private readonly earlyEvents: WalletConnectTransportEvent[] = [];
  private status: 'ready' | 'pairing' | 'approving' | 'unavailable' = 'ready';
  private error: NativeConnectionError | null = null;
  private readonly connections = new Map<string, Connected>();
  private readonly proposals = new Map<number, WalletConnectProposal>();
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
      cancel: () => this.cancel(),
    });
    this.unsubscribe = options.source.subscribe(() => {
      const phase = options.source.getSnapshot().phase;
      if (phase !== 'ready' && (this.action || this.pairing)) this.cancel();
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
      this.status = 'unavailable';
      this.error = 'CONNECTION_UNAVAILABLE';
      this.publish();
    }
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
    if (this.host && this.repository) return Promise.resolve();
    if (this.opening) return this.opening;
    this.opening = (async () => {
      if (this.options.source.getSnapshot().phase !== 'ready')
        return failure('CONTEXT_CHANGED');
      this.host = await this.options.openHost();
      this.check();
      this.repository = this.host.repository;
      this.repository.assertHealthy();
      this.publishedScope = this.publicScope();
      if (this.repository.bindings().length) await this.ensureTransport();
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
      this.transport = await (
        this.options.openTransport ?? openWalletConnectTransport
      )({
        projectId: this.options.projectId,
        metadata: this.options.metadata,
        repository: this.repository,
        supportedMethods: METHODS,
        supportedEvents: EVENTS,
        assertOwner: () => this.check(),
        preparePlatform: this.options.preparePlatform,
        signal: this.lifetime.signal,
        onEvent: (event) => {
          if (this.transport) this.onEvent(event);
          else this.earlyEvents.push(event);
        },
      });
      this.check();
      for (const event of this.earlyEvents.splice(0)) this.onEvent(event);
      for (const session of await this.transport.sessions())
        this.connection(session);
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
    } else if (event.type === 'request')
      void this.respond(event.request).catch(() => {
        try {
          this.check();
        } catch {
          this.unavailable();
        }
      });
    else if (event.type === 'unavailable') this.unavailable();
    this.publish();
  }
  private async perform(operation: () => Promise<void>): Promise<void> {
    let epoch = this.actionEpoch;
    try {
      this.check();
      const result = operation();
      epoch = this.actionEpoch;
      await result;
    } catch (error) {
      if (epoch === this.actionEpoch && !this.disposed) {
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
      guard
    );
  }
  private cancel() {
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
    this.disposed = true;
    this.lifetime.abort();
    this.action?.abort();
    this.unsubscribe();
    this.publish();
    this.closing = (async () => {
      await this.opening?.catch(() => undefined);
      await this.openingTransport?.catch(() => undefined);
      try {
        await this.transport?.close();
      } finally {
        this.connections.clear();
        this.proposals.clear();
      }
    })();
    return this.closing;
  }
}
