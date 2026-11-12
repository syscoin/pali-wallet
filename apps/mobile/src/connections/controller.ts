import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope, type NativePrivateAuthentication } from '../custody/privateAuthentication.ts';
import { NativeSmartPreparationRequests } from './smartPreparationRequests.ts';
import { getRequestedSmartAccountAuthenticator, type SmartAccountPreparationRequest } from '../../../../source/shared/smartAccountPreparation.ts';
import type { NativeSmartCreationAllocation } from '../smartAccount/preparation.ts';
import { SmartAccountModulesProjectionError } from '../../../../source/shared/smartAccountModules.ts';
import { SMART_ACCOUNT_MODULE_REQUEST_METHODS, isSmartAccountModuleRequestMethod, normalizeSmartAccountModuleRequest, SmartAccountModuleRequestError, type SmartAccountModuleRequest } from '../../../../source/shared/smartAccountModuleRequest.ts';
import { NativeSigningHandoffs, captureNativeSigningContinuation, completeNativeSigningOwnerStep, retireNativeSigningHandoff, sameSigningResumeOwner, type NativeSigningHandoff, type SigningResumeScope, type SigningHandoffDescriptor } from './signingHandoff.ts';
import { isDappEncryptionMethod, readDappEncryptionRequest, supportsDappEncryptionAccount, type DappEncryptionRequest } from '../../../../source/shared/dappEncryptionRequest.ts';
import { prepareDappEncryptionApproval } from '../../../../source/wallet/dappEncryptionApproval.ts';
import { dappCaipChain, dappNamespace, DAPP_MODE_METHODS, normalizeDappModeRequest, type DappChainScope } from '../../../../source/shared/dappChainScope.ts';
import { DAPP_SYSCOIN_READ_METHODS, isDappSyscoinRead, normalizeDappSyscoinRead } from '../../../../source/shared/dappSyscoinReads.ts';
import { SENTRY_NETWORKS } from '../../../../source/shared/sentryNetworks.ts';
import { NativeSentryRequests, SENTRY_DAPP_METHODS } from './sentryRequests.ts';
import { NativePsbtRequests, PSBT_DAPP_METHODS } from './psbtRequests.ts';
import {
  evmDappFeeChoiceMatches,
  selectEvmDappFeeChoice,
  type EvmDappFeeChoice,
} from '../../../../source/shared/evmDappFeePolicy.ts';
import { NativeOperationDrain } from '../custody/operationDrain.ts';
import { NativeDappControlRequests } from './controlRequests.ts';
import { isDappPermissionMethod, readDappPermissionRequest, projectDappPermissions } from '../../../../source/shared/dappPermissions.ts';
import { DAPP_PUBLIC_RPC_METHODS, isDappPublicRpcMethod, normalizeDappRpcRequest } from '../../../../source/shared/dappRpcReads.ts';
import { createDappReturnTarget } from './pairingReturn.ts';
import { isDappWalletControlMethod, normalizeDappWalletControl } from '../../../../source/shared/dappWalletControl.ts';
import {
  normalizeDappCallsRequest,
  assertDappCallsAtomicSupport,
  createSmartAccountCallsExecutions,
  type DappCallsRequest,
} from '../../../../source/shared/dappCalls.ts';
import type { CallsBundleStatus } from '../../../../source/wallet/dappCallsBundles.ts';
import type { NativeSmartAccountOperation } from '../smartAccount/operation.ts';
import type { NativePreparedConnectionTransaction } from './transactionRuntime.ts';
import { createNativeEoaCalls, createNativeEoaCallsContinuation, isNativeEoaCallsContinuation, type NativeEoaCalls } from './eoaCalls.ts';
import { createDappSigningApproval } from '../../../../source/wallet/dappSigningApproval.ts';
import {
  normalizeDappCapabilitiesRequest,
  projectDappCapabilities,
} from '../../../../source/shared/dappCapabilities.ts';
import { EthereumRpcErrorHandler } from '../../../../source/helpers/errors/errorClassesHandlers.ts';
import {
  isDappMessageMethod,
  readDappMessageRequest,
  type DappMessageRequest,
} from '../../../../source/shared/dappMessageRequest.ts';
import { assertDappTypedDataValid } from '../../../../source/shared/dappTypedDataValidation.ts';
import { getPersonalSignReview } from '../../../../source/utils/personalSignReview.ts';
import {
  reviewDappMessageAdvisories,
  reviewDappAddressAdvisories,
} from '../../../../source/shared/dappMessageAdvisories.ts';
import { normalizeDappTransaction } from '../../../../source/shared/dappTransaction.ts';
import { getBlacklistTargetsForEvmCall } from '../../../../source/shared/evmCallBlacklist.ts';
import { getEffectiveApprovalData } from '../../../../source/shared/approval.ts';
import type { IBlacklistCheckResult } from '../../../../source/types/security.ts';
import { getTypedOrderReview } from '../../../../source/utils/typedOrderReview.ts';
import { createDappSessions } from '../../../../source/wallet/dappSessions.ts';
import { assertProviderRequestBudget, DAPP_REQUEST_LIMITS } from '../../../../source/utils/requestPayloadBudget.ts';
import { createDappApprovalLifetime } from '../../../../source/utils/dappApprovalLifetime.ts';
import type { DappSessionEvent } from '../../../../source/wallet/dappSessions.ts';
import type { KeyringAccountType } from '../../../../source/types/network.ts';
import type { CustodySnapshot } from '../custody/types.ts';
import type { NativeConnectionHost, NativeRequestAuthenticationBinder } from './host.ts';
import type { NativeConnectionRepository } from './storage.ts';
import {
  openWalletConnectTransport,
  isWalletConnectCleanupFailure,
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
  NativeEncryptionReview,
  NativeSigningReview,
  NativeTransactionReview,
  NativeSmartTransactionReview,
  NativeMessageReviewError,
  NativeConnectionsSnapshot,
  NativeConnectionsView,
} from './types.ts';

const METHODS = Object.freeze([
  'eth_chainId',
  'net_version',
  'eth_accounts',
  'eth_requestAccounts',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'wallet_watchAsset',
  'wallet_getPermissions',
  'wallet_requestPermissions',
  'wallet_revokePermissions',
  ...DAPP_PUBLIC_RPC_METHODS,
  ...DAPP_SYSCOIN_READ_METHODS,
  ...DAPP_MODE_METHODS,
  ...SENTRY_DAPP_METHODS,
  ...PSBT_DAPP_METHODS,
  'wallet_getCapabilities',
  'wallet_getSmartAccountModules',
  'wallet_prepareSmartAccount',
  ...SMART_ACCOUNT_MODULE_REQUEST_METHODS,
  'eth_sendTransaction',
  'wallet_sendCalls',
  'wallet_getCallsStatus',
  'wallet_showCallsStatus',
  'eth_getEncryptionPublicKey',
  'eth_decrypt',
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
type ModeOwner = {
  connection: Connected;
  grant: NonNullable<ReturnType<Engine['get']>>;
  key: string;
  origin: string;
  sourceFamily: 'ethereum' | 'syscoin';
  targetFamily: 'ethereum' | 'syscoin';
  cleanup?: Promise<boolean>;
};
type MessageApproval = ReturnType<typeof createDappSigningApproval>;
type TransactionRequest = Readonly<{
  method: 'eth_sendTransaction';
  transaction: ReturnType<typeof normalizeDappTransaction>;
}>;
type CallsRequest = Readonly<{
  method: 'wallet_sendCalls';
  calls: DappCallsRequest;
  bundleId: string;
  reservationId: string;
}>;
type SigningRequest = DappMessageRequest | DappEncryptionRequest | TransactionRequest | CallsRequest | SmartAccountModuleRequest;
function isModuleRequest(request: SigningRequest): request is SmartAccountModuleRequest {
  return isSmartAccountModuleRequestMethod(request.method);
}
function isOperationRequest(request: SigningRequest): request is TransactionRequest | CallsRequest | SmartAccountModuleRequest {
  return isTransactionRequest(request) || isModuleRequest(request);
}
function isEncryptionRequest(request: SigningRequest): request is DappEncryptionRequest {
  return isDappEncryptionMethod(request.method);
}
function isTransactionRequest(
  request: SigningRequest
): request is TransactionRequest | CallsRequest {
  return (
    request.method === 'eth_sendTransaction' ||
    request.method === 'wallet_sendCalls'
  );
}
type PrivateSigningReview =
  | Omit<NativeEncryptionReview, 'revision' | 'needsAccountSwitch' | 'busy' | 'dispatched'>
  | Omit<
      NativeMessageReview,
      'revision' | 'needsAccountSwitch' | 'busy' | 'dispatched'
    >
  | Omit<
      NativeTransactionReview,
      'revision' | 'needsAccountSwitch' | 'busy' | 'dispatched'
    >
  | Omit<
      NativeSmartTransactionReview,
      'revision' | 'needsAccountSwitch' | 'busy' | 'dispatched'
    >;
type PendingSigning = {
  authenticationScope: NativePrivateAuthenticationScope;
  authentication: NativePrivateAuthentication | null;
  queueOrder: number;
  resumeId: string;
  handoff: NativeSigningHandoff;
  work?: Promise<void>;
  resultReady: boolean;
  id: string;
  wire: WalletConnectRequest;
  connection: Connected;
  session: WalletConnectSession;
  request: SigningRequest;
  accountId: string;
  networkId: string;
  networkFingerprint: string;
  accountXpub: string;
  approval: MessageApproval | undefined;
  review: PrivateSigningReview;
  encryption?: ReturnType<typeof prepareDappEncryptionApproval>;
  prepared?: NativePreparedConnectionTransaction;
  smart?: NativeSmartAccountOperation;
  unsubscribeSmart?: () => void;
  eoa?: NativeEoaCalls;
  unsubscribeEoa?: () => void;
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
  bindAuthentication: NativeRequestAuthenticationBinder;
  source: Source;
  activateAccount(
    accountId: string,
    expectedRevision: number,
    assertCurrent: () => void
  ): Promise<void>;
  openHost(): Promise<NativeConnectionHost>;
  preparePlatform(): Promise<void>;
  checkSite(origin: string): Promise<Readonly<{ isBlacklisted: boolean }>>;
  checkAddress(address: string): Promise<IBlacklistCheckResult>;
  projectId: string;
  metadata: Parameters<typeof openWalletConnectTransport>[0]['metadata'];
  /** Invoked only by the explicit returnToDapp view command after destination review. */
  openExternalUrl(url: string): Promise<void>;
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
      /^(?:eip155:\d+|bip122:[0-9a-f]{32}):[^:]+$/.test(value)
    );
    if (account) return account.slice(0, account.lastIndexOf(':'));
  }
  return undefined;
};

/** Native lifecycle and public view adapter. The common engine owns every grant. */
export class NativeConnectionsController {
  private callsStatus: Readonly<{
    id: string;
    origin: string;
    status: CallsBundleStatus;
  }> | null = null;
  private statusSession: WalletConnectSession | undefined;
  private statusResponse: ((shown: boolean) => Promise<void>) | undefined;
  private statusRefresh: { id: string; busy: boolean; check(): void; read(): Promise<CallsBundleStatus> } | undefined;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private host: NativeConnectionHost | undefined;
  private repository: NativeConnectionRepository | undefined;
  private transport: WalletConnectTransport | undefined;
  private transportGeneration = 0;
  private opening: Promise<void> | undefined;
  private openingTransport: Promise<void> | undefined;
  private restored = false;
  private transportOwner: object | undefined;
  private transportRetirement: Promise<void> = Promise.resolve();
  private publishedScope: { network: string; accounts: string } | undefined;
  private readonly disposal = new NativeOperationDrain();
  private requestRetirement: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly lifetime = new AbortController();
  private revision = 0;
  private actionEpoch = 0;
  private serial = 0;
  private action: AbortController | undefined;
  private pairing: WalletConnectPairing | undefined;
  private pairingAction: AbortController | undefined;
  private pairingTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly proposalTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private activeGrant: Connected | undefined;
  private activeProposalId: number | undefined;
  private readonly canceledPairings = new Map<string, WalletConnectPairing>();
  private status: 'ready' | 'pairing' | 'approving' | 'unavailable' = 'ready';
  private error: NativeConnectionError | null = null;
  private readonly connections = new Map<string, Connected>();
  private readonly proposals = new Map<number, WalletConnectProposal>();
  private readonly requests = new Map<string, PendingSigning>();
  private readonly controls: NativeDappControlRequests;
  private readonly preparations: NativeSmartPreparationRequests;
  private readonly preparationOwners = new WeakMap<WalletConnectRequest, { connection: Connected; session: WalletConnectSession; updating: boolean; check(): void }>();
  private readonly sentry: NativeSentryRequests;
  private readonly psbt: NativePsbtRequests;
  private readonly handoffs: NativeSigningHandoffs;
  private readonly reads = new Map<string, { wire: WalletConnectRequest; connection: Connected; lifetime: AbortController; check(): void }>();
  private readonly permissionRequests = new Map<string, Connected>();
  private readonly modeOwners = new WeakMap<WalletConnectRequest, ModeOwner>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private snapshot: NativeConnectionsSnapshot;
  readonly view: NativeConnectionsView;

  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
    this.handoffs = new NativeSigningHandoffs({ cancel: job => this.host!.cancelSigningHandoff(job),
      changed: () => { this.publish(); void this.controls?.prepare(); void this.sentry?.prepare(); void this.psbt?.prepare(); void this.prepareForegroundRequest(); } });
    this.controls = new NativeDappControlRequests({
      host: () => this.host!.controls,
      foreground: order => order < Math.min(this.handoffs.firstOrder, this.requests.values().next().value?.queueOrder ?? Infinity, this.sentry?.firstOrder ?? Infinity, this.psbt?.firstOrder ?? Infinity, this.preparations?.firstOrder ?? Infinity),
      changed: () => { this.publish(); void this.prepareForegroundRequest(); },
      checkSite: options.checkSite,
      respond: (wire, response, check) => this.transport!.respond(wire.session.binding, wire.id, response, check, () => {
        if ('result' in response) this.startModeRetirement(wire);
      }),
      retireCommitted: wire => this.finishModeRetirement(wire),
    });
    this.sentry = new NativeSentryRequests({
      host: () => this.host!.sentry,
      foreground: order => order < Math.min(this.handoffs.firstOrder, this.requests.values().next().value?.queueOrder ?? Infinity, this.controls.firstOrder, this.psbt?.firstOrder ?? Infinity, this.preparations?.firstOrder ?? Infinity),
      changed: () => { this.publish(); void this.prepareForegroundRequest(); },
      checkSite: options.checkSite,
      respond: (wire, response, check, handedOff) => this.transport!.respond(wire.session.binding, wire.id, response, check, handedOff),
    });
    this.psbt = new NativePsbtRequests({
      bindAuthentication: options.bindAuthentication,
      host: () => this.host!.psbt,
      foreground: order => order < Math.min(this.handoffs.firstOrder, this.requests.values().next().value?.queueOrder ?? Infinity, this.controls.firstOrder, this.sentry.firstOrder, this.preparations?.firstOrder ?? Infinity),
      changed: () => { this.publish(); void this.prepareForegroundRequest(); },
      checkSite: options.checkSite,
      respond: (wire, response, check, handedOff) => this.transport!.respond(wire.session.binding, wire.id, response, check, handedOff),
    });
    this.preparations = new NativeSmartPreparationRequests({
      bindAuthentication: options.bindAuthentication,
      host: () => this.host!,
      foreground: order => order < Math.min(this.handoffs.firstOrder, this.requests.values().next().value?.queueOrder ?? Infinity, this.controls.firstOrder, this.sentry.firstOrder, this.psbt.firstOrder),
      changed: () => { this.publish(); void this.controls.prepare(); void this.sentry.prepare(); void this.psbt.prepare(); void this.prepareForegroundRequest(); },
      checkSite: options.checkSite,
      connect: (wire, allocation, signal, check) => this.connectPreparedAccount(wire, allocation, signal, check),
      respond: (wire, response, check, dispatched) => this.transport!.respond(wire.session.binding, wire.id, response, check, dispatched),
    });
    this.snapshot = this.project();
    this.view = Object.freeze({
      isRequestAuthenticating: id => this.isRequestAuthenticating(id),
      approveSmartPreparation: async (id, revision, acknowledged) => {
        if (revision !== this.revision) return failure('REQUEST_EXPIRED');
        await this.preparations.approve(id, acknowledged);
      },
      confirmSmartPreparationPayer: async (id, revision, payerId) => {
        if (revision !== this.revision) return failure('REQUEST_EXPIRED');
        await this.preparations.confirmPayer(id, payerId);
      },
      retrySmartPreparationMetadata: async (id, revision) => {
        if (revision !== this.revision) return failure('REQUEST_EXPIRED');
        await this.preparations.retryMetadata(id);
      },
      rejectSmartPreparation: id => this.preparations.reject(id),
      approvePsbt: async (id, revision) => {
        if (revision !== this.revision) return failure('REQUEST_EXPIRED');
        await this.psbt.approve(id);
      },
      rejectPsbt: async id => { this.psbt.reject(id); },
      backgroundSigning: () => {
        this.preparations.clear();
        this.psbt.background();
        const message = this.requests.values().next().value;
        if (message && !this.handoffs.background(message.handoff)) void this.retireRequest(message);
      },
      cancelSigningHandoff: async () => {
        const descriptors = [this.psbt.cancelHandoff(), this.handoffs.cancelDapp()];
        const transport = this.transport;
        for (const descriptor of descriptors) {
          if (!descriptor || !transport || descriptor.scope.adapter !== this.transportGeneration) continue;
          const check = () => {
            this.check();
            const connection = [...this.connections.values()].find(value => JSON.stringify(value.session.binding) === JSON.stringify(descriptor.binding));
            if (this.transport !== transport || !connection || JSON.stringify(connection.engine.get(descriptor.binding.origin)) !== descriptor.scope.grant) failure('CONTEXT_CHANGED');
          };
          const wire = await transport.pending(descriptor.binding, descriptor.requestId, check); check();
          if (wire && JSON.stringify(wire) === descriptor.wire)
            await transport.respond(wire.session.binding, wire.id, { error: { code: 4001, message: 'User rejected' } }, check, () => {});
        }
      },
      resumeSigning: async id => {
        const psbt = this.psbt.descriptor(id), descriptor = psbt ?? this.handoffs.descriptor(id), transport = this.transport;
        if (!descriptor || !transport || descriptor.scope.adapter !== this.transportGeneration) return failure('REQUEST_EXPIRED');
        const currentDescriptor = () => psbt ? this.psbt.descriptor(id) : this.handoffs.descriptor(id);
        const check = () => {
          this.check();
          const scope = this.signingResumeScope(descriptor.binding, 'selected');
          if (this.transport !== transport || currentDescriptor() !== descriptor || !scope ||
              !sameSigningResumeOwner(descriptor.scope, scope) || scope.unlockGeneration <= descriptor.scope.unlockGeneration)
            failure('CONTEXT_CHANGED');
        };
        check();
        try {
          await (psbt ? this.psbt.drainSuspended(id) : this.handoffs.drain(id)); check();
          const wire = await transport.pending(descriptor.binding, descriptor.requestId, check); check();
          if (!wire || JSON.stringify(wire) !== descriptor.wire) return failure('REQUEST_EXPIRED');
          if (psbt) await this.queuePsbtRequest(wire, id);
          else await this.queueSigningRequest(wire, descriptor);
          if (currentDescriptor() === descriptor) return failure('REQUEST_EXPIRED');
        } catch (cause) {
          if (psbt) this.psbt.discardHandoff(descriptor);
          else this.handoffs.discard(descriptor);
          throw cause;
        }
      },
      approveSentry: async (id, revision, assent) => {
        if (revision !== this.revision) return failure('REQUEST_EXPIRED');
        await this.sentry.approve(id, assent);
      },
      rejectSentry: async id => { this.sentry.reject(id); },
      approveControl: async (id, revision) => {
        if (revision !== this.revision) return failure('REQUEST_EXPIRED');
        await this.controls.approve(id);
      },
      rejectControl: id => this.controls.reject(id),
      returnToDapp: async (id, revision) => {
        this.check();
        const connection = [...this.connections.values()].find(value => value.id === id);
        if (revision !== this.revision || this.disposed || this.options.source.getSnapshot().phase !== 'ready' || !connection?.engine.isConnected(connection.session.binding.origin)) return failure('REQUEST_EXPIRED');
        const target = createDappReturnTarget(connection.session.binding.origin, { validation: 'UNKNOWN', isScam: false });
        if (!target) return failure('SITE_MISMATCH');
        const site = await this.options.checkSite(target.origin);
        this.check();
        if (site.isBlacklisted) return failure('BLOCKED_SITE');
        if (revision !== this.revision || this.options.source.getSnapshot().phase !== 'ready' || this.connections.get(sessionKey(connection.session)) !== connection || !connection.engine.isConnected(target.origin)) return failure('CONTEXT_CHANGED');
        await this.options.openExternalUrl(target.url);
      },
      callsStatusShown: async (id) => {
        if (this.callsStatus?.id !== id) return;
        const respond = this.statusResponse;
        this.statusResponse = undefined;
        await respond?.(true);
      },
      refreshCallsStatus: async (id) => {
        const owner = this.statusRefresh;
        if (!owner || owner.id !== id) return failure('REQUEST_EXPIRED');
        if (owner.busy) return failure('BUSY');
        owner.busy = true;
        const finish = this.disposal.begin();
        try {
          owner.check();
          const status = await owner.read();
          owner.check();
          this.callsStatus = Object.freeze({ ...this.callsStatus!, status });
          this.publish();
        } catch (error) {
          if (this.statusRefresh === owner) {
            try { owner.check(); } catch { this.dismissStatus(); }
          }
          throw error;
        } finally {
          owner.busy = false;
          finish();
        }
      },
      dismissCallsStatus: (id) => {
        if (this.callsStatus?.id === id) this.dismissStatus();
      },
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
      previewEncryption: (id, revision) => this.previewEncryption(id, revision),
      approveRequest: (id, revision, acknowledgeWarning) =>
        this.perform(
          () => this.approveRequest(id, revision, acknowledgeWarning),
          { owner: this.requests.get(id) }
        ),
      retrySmartMetadata: (id, revision) => this.perform(
        () => this.retrySmartMetadata(id, revision),
        { owner: this.requests.get(id) }
      ),
      confirmSmartPayer: (id, revision, payerId) =>
        this.perform(
          async () => {
            const message = this.requests.get(id);
            if (
              !message ||
              revision !== this.revision ||
              (this.requests.values().next().value !== message || Math.min(this.controls.firstOrder, this.sentry.firstOrder, this.psbt.firstOrder, this.handoffs.firstOrder, this.preparations.firstOrder) < message.queueOrder) ||
              message.review.kind !== 'smart-transaction' ||
              message.review.error ||
              message.dispatched ||
              this.host!.context().activeAccountId !== message.accountId
            )
              return failure('REQUEST_EXPIRED');
            message.approval?.assertCurrent();
            message.smart?.confirmPayer(payerId);
          },
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
      chooseTransactionFee: (id, revision, choice) =>
        this.perform(() => this.chooseTransactionFee(id, revision, choice), {
          owner: this.requests.get(id),
        }),
      editApprovalAmount: (id, revision, amount) =>
        this.perform(() => this.editApprovalAmount(id, revision, amount), {
          owner: this.requests.get(id),
        }),
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
      if (phase !== 'ready') this.dismissStatus();
      if (phase !== 'ready' && (this.action || this.pairing)) this.cancel();
      this.revalidateSigningRequests();
      this.controls.revalidate(); this.sentry.revalidate(); this.psbt.revalidate(); this.preparations.revalidate(); this.revalidatePsbtHandoff();
      this.revalidateReads();
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
      for (const read of this.reads.values()) read.lifetime.abort();
      this.controls.clear(); this.sentry.clear(); this.psbt.clear(); this.preparations.clear(); this.handoffs.cancelDapp();
      this.restored = false;
      this.actionEpoch++;
      this.action?.abort();
      this.action = undefined;
      this.pairing = undefined;
      this.clearDeadlines();
      this.canceledPairings.clear();
      this.activeGrant = undefined;
      this.activeProposalId = undefined;
      this.transportOwner = undefined;
      const transport = this.transport;
      this.transport = undefined;
      this.connections.clear();
      this.proposals.clear();
      for (const message of [...this.requests.values()])
        void this.retireRequest(message, false);
      if (transport)
        void this.retireTransport(transport).catch(() => undefined);
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
  private supportedMethods(
    accountType?: string,
    accountId?: string
  ): readonly string[] {
    const scope = this.host && this.options.source.getSnapshot().phase === 'ready' ? this.chainScope() : undefined;
    return METHODS.filter((method) => {
      const hardware = accountType === 'Ledger' || accountType === 'Trezor';
      if (isDappEncryptionMethod(method) && !supportsDappEncryptionAccount({ type: accountType })) return false;
      if (hardware && (method === 'eth_signTypedData' || method === 'wallet_getSmartAccountModules' || isSmartAccountModuleRequestMethod(method))) return false;
      if (scope?.kind === 'syscoin') {
        if ((SENTRY_DAPP_METHODS as readonly string[]).includes(method)) return Object.values(SENTRY_NETWORKS).some(network => network.chainId === scope.chainId && network.genesisHash === scope.genesisHash);
        return isDappSyscoinRead(method) || (DAPP_MODE_METHODS as readonly string[]).includes(method) || isDappPermissionMethod(method) || (PSBT_DAPP_METHODS as readonly string[]).includes(method);
      }
      if (isDappSyscoinRead(method) || (SENTRY_DAPP_METHODS as readonly string[]).includes(method) || (PSBT_DAPP_METHODS as readonly string[]).includes(method)) return false;
      if (accountType === 'SmartAccount' && isDappMessageMethod(method))
        return (
          (method === 'personal_sign' || method === 'eth_signTypedData_v4') &&
          !!accountId &&
          this.host?.supportsSmartAccountMessages(accountId) === true
        );
      if (method === 'wallet_sendCalls')
        return (
          !accountType ||
          accountType === 'HDAccount' || accountType === 'Imported' || accountType === 'Ledger' || accountType === 'Trezor' ||
          (accountType === 'SmartAccount' &&
            !!accountId &&
            this.host?.supportsAtomicCalls(accountId) === true)
        );
      if (
        method === 'wallet_getCallsStatus' ||
        method === 'wallet_showCallsStatus'
      )
        return !accountType || accountType === 'SmartAccount' || accountType === 'HDAccount' || accountType === 'Imported' || accountType === 'Ledger' || accountType === 'Trezor';
      return true;
    });
  }
  private chainScope(context = this.host!.context()): DappChainScope {
    if (context.network.kind === 'ethereum') return { kind: 'ethereum', chainId: context.network.chainId };
    const network = this.host!.syscoin.registration();
    if (context.network.kind !== 'syscoin' || context.networkId !== network.id || context.network.chainId !== network.chainId || context.network.slip44 !== network.slip44) return failure('CONTEXT_CHANGED');
    return { kind: 'syscoin', chainId: network.chainId, slip44: network.slip44, genesisHash: network.genesisHash };
  }
  private accountAnchor(account: ReturnType<NativeConnectionHost['context']>['accounts'][number], scope: DappChainScope): string {
    return scope.kind === 'ethereum' ? account.address : this.host!.syscoin.anchor(account.xpub);
  }
  private permits(connection: Connected, wire: WalletConnectRequest, account: ReturnType<NativeConnectionHost['context']>['accounts'][number], scope: DappChainScope): boolean {
    const chain = dappCaipChain(scope), anchor = this.accountAnchor(account, scope), expected = `${chain}:${anchor}`;
    return wire.chainId === chain && Object.values(connection.session.namespaces).some(namespace => namespace.methods.includes(wire.method) && namespace.accounts.some(value => scope.kind === 'ethereum' ? value.toLowerCase() === expected.toLowerCase() : value === expected));
  }
  private canApprove(
    proposal: WalletConnectProposal,
    accountId?: string
  ): boolean {
    if (proposal.expiresAt !== null && proposal.expiresAt <= Date.now()) return false;
    if (
      proposal.verification.isScam ||
      proposal.verification.validation === 'INVALID'
    )
      return false;
    const context = this.host?.context();
    if (!context?.unlocked) return false;
    const scope = this.chainScope(context), chain = dappCaipChain(scope), family = dappNamespace(scope);
    const account = context.accounts.find((value) => value.id === accountId);
    if (accountId && !account) return false;
    const supported = this.supportedMethods(account?.type, account?.id);
    return Object.entries(proposal.requiredNamespaces).every(([name, raw]) => {
      const requirement = raw as {
        chains?: string[];
        methods?: string[];
        events?: string[];
      };
      return (
        (name === family || name === chain) &&
        (requirement.chains ?? [chain]).every((id) => id === chain) &&
        (requirement.methods ?? []).every((method) =>
          supported.includes(method)
        ) &&
        (requirement.events ?? []).every((event) => EVENTS.includes(event))
      );
    });
  }
  private proposalPermissions(proposal: WalletConnectProposal, context: ReturnType<NativeConnectionHost['context']>, account: ReturnType<NativeConnectionHost['context']>['accounts'][number]) {
    const scope = this.chainScope(context), chain = dappCaipChain(scope), family = dappNamespace(scope);
    const requested = [
      ...Object.entries(proposal.requiredNamespaces),
      ...Object.entries(proposal.optionalNamespaces),
    ].filter(([name]) => name === family || name === chain).map(([, value]) => value) as { methods?: string[]; events?: string[] }[];
    const supported = this.supportedMethods(account.type, account.id);
    return {
      methods: [...new Set(requested.flatMap(value => value.methods ?? []).filter(value => supported.includes(value)))],
      events: [...new Set(requested.flatMap(value => value.events ?? []).filter(value => EVENTS.includes(value)))],
    };
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
    const evm = context?.network.kind === 'ethereum' || context?.network.kind === 'syscoin';
    return Object.freeze({
      preparationReview: ready ? this.preparations?.review(this.revision) ?? null : null,
      controlReview: ready ? this.controls.review(this.revision) : null,
      psbtReview: ready ? this.psbt?.review(this.revision) ?? null : null,
      sentryReview: ready ? this.sentry?.review(this.revision) ?? null : null,
      callsStatus: ready ? this.callsStatus : null,
      revision: this.revision,
      status: ready ? this.status : 'locked',
      pairingExpiresAt: ready && this.pairing ? this.pairing.expiresAt : null,
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
                expiresAt: proposal.expiresAt,
                requiredMethods: Object.freeze(this.requiredMethods(proposal)),
                methodsByAccount: Object.freeze(context ? context.accounts.map(account => Object.freeze({
                  accountId: account.id,
                  methods: Object.freeze(this.proposalPermissions(proposal, context!, account).methods),
                  canApprove: this.canApprove(proposal, account.id),
                })) : []),
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
                    address: grant.chainId === context?.network.chainId && grant.chain === context.network.kind ? account?.address ?? null : null,
                    expiresAt: session.expiry * 1000,
                    methods: Object.freeze([...new Set(Object.values(session.namespaces).flatMap(namespace => namespace.methods))]),
                    returnTarget: createDappReturnTarget(session.binding.origin, { validation: 'UNKNOWN', isScam: false }),
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
    if (this.statusRefresh) {
      try { this.statusRefresh.check(); }
      catch { this.dismissStatus(); return; }
    }
    if (
      this.statusSession &&
      (this.connections.get(sessionKey(this.statusSession))?.session !==
        this.statusSession ||
        !this.connections
          .get(sessionKey(this.statusSession))
          ?.engine.isConnected(this.statusSession.binding.origin))
    ) {
      this.dismissStatus();
      return;
    }
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
      await this.requestRetirement;
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
        await this.requestRetirement;
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
        this.transport = transport; this.transportGeneration++;
        for (const session of sessions) this.connection(session);
        for (const event of events) this.onEvent(event);
        guard();
      } catch (error) {
        if (isWalletConnectCleanupFailure(error)) {
          this.transportRetirement = this.transportRetirement.then(() => {
            throw error;
          });
          void this.transportRetirement.catch(() => undefined);
          this.unavailable();
        }
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
        !!account && (network.kind === 'ethereum' || network.kind === 'syscoin'),
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
          const chainId = grant?.chain === 'ethereum' ? `eip155:${grant.chainId}` : sessionEventChain(selectedSession, message.name);
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
      if (this.pairing && this.pairing.expiresAt <= Date.now()) this.expirePairing(this.pairing);
      if (this.canceledPairings.has(event.proposal.pairingTopic) || event.proposal.expiresAt !== null && event.proposal.expiresAt <= Date.now()) {
        const transport = this.transport, owner = this.transportOwner;
        if (!transport) return;
        void transport.reject(event.proposal, {
          code: 5000,
          message: 'Connection cancelled',
        }).catch(() => {
          if (this.disposed || this.transportOwner !== owner) return;
          this.error = 'CONNECTION_UNAVAILABLE';
          this.publish();
        });
        return;
      }
      this.proposals.set(event.proposal.id, event.proposal);
      this.watchProposal(event.proposal);
      if (!this.action) this.status = 'ready';
    } else if (event.type === 'proposal-expired') {
      const proposal = this.proposals.get(event.id);
      if (proposal) this.expireProposal(proposal);
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
      for (const read of this.reads.values()) if (read.wire.id === event.id) read.lifetime.abort();
      this.controls.expire(event.id); this.preparations.expire(event.id); this.sentry.expire(event.id); this.psbt.expire(event.id); this.handoffs.expire(event.id);
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
    this.controls.revalidate(); this.sentry.revalidate(); this.psbt.revalidate(); this.preparations.revalidate(); this.revalidatePsbtHandoff();
    this.revalidateReads();
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
  private clearPairingDeadline() {
    if (this.pairingTimer !== undefined) clearTimeout(this.pairingTimer);
    this.pairingTimer = undefined;
    this.pairingAction = undefined;
  }
  private clearProposalDeadline(id: number) {
    const timer = this.proposalTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.proposalTimers.delete(id);
  }
  private clearDeadlines() {
    this.clearPairingDeadline();
    for (const id of this.proposalTimers.keys()) this.clearProposalDeadline(id);
  }
  private retireApproval(id: number) {
    if (this.activeProposalId !== id) return;
    this.actionEpoch++; this.action?.abort(); this.action = undefined;
    this.activeProposalId = undefined;
    const grant = this.activeGrant, owner = this.transportOwner; this.activeGrant = undefined;
    if (grant) void grant.engine.revoke(grant.session.binding.origin, { allowAlreadyDisconnected: true }).catch(() => {
      if (!this.disposed && this.transportOwner === owner) this.unavailable();
    });
    if (this.status !== 'unavailable') this.status = 'ready';
  }
  private expireProposal(proposal: WalletConnectProposal) {
    if (this.proposals.get(proposal.id) !== proposal) return;
    this.proposals.delete(proposal.id); this.clearProposalDeadline(proposal.id);
    this.retireApproval(proposal.id);
    this.error = 'REQUEST_EXPIRED'; this.publish();
  }
  private watchProposal(proposal: WalletConnectProposal) {
    this.clearProposalDeadline(proposal.id);
    if (proposal.expiresAt === null) return;
    const check = () => {
      if (this.disposed || this.proposals.get(proposal.id) !== proposal) return;
      const remaining = proposal.expiresAt! - Date.now();
      if (remaining <= 0) this.expireProposal(proposal);
      else this.proposalTimers.set(proposal.id, setTimeout(check, Math.min(remaining, 2_147_483_647)));
    };
    check();
  }
  private expirePairing(pairing: WalletConnectPairing) {
    if (this.pairing !== pairing) return;
    if (this.action === this.pairingAction) { this.actionEpoch++; this.action?.abort(); this.action = undefined; }
    this.pairing = undefined; this.clearPairingDeadline();
    this.canceledPairings.set(pairing.topic, pairing);
    for (const [id, proposal] of this.proposals) if (proposal.pairingTopic === pairing.topic) {
      this.proposals.delete(id); this.clearProposalDeadline(id); this.retireApproval(id);
    }
    if (this.status === 'pairing') this.status = 'ready';
    this.error = 'REQUEST_EXPIRED'; this.publish();
    const owner = this.transportOwner;
    void pairing.cancel().catch(() => { if (!this.disposed && this.transportOwner === owner) this.unavailable(); });
  }
  private watchPairing(pairing: WalletConnectPairing, action: AbortController) {
    const previous = this.pairing;
    if (previous && previous !== pairing && previous.topic !== pairing.topic) {
      this.canceledPairings.set(previous.topic, previous);
      const owner = this.transportOwner;
      void previous.cancel().catch(() => { if (!this.disposed && this.transportOwner === owner) this.unavailable(); });
    }
    this.clearPairingDeadline(); this.pairing = pairing; this.pairingAction = action;
    const check = () => {
      if (this.disposed || this.pairing !== pairing) return;
      const remaining = pairing.expiresAt - Date.now();
      if (remaining <= 0) this.expirePairing(pairing);
      else this.pairingTimer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    check();
  }
  private async pair(uri: string) {
    if (this.action) return failure('BUSY');
    if (this.canceledPairings.size >= DAPP_REQUEST_LIMITS.pendingRequests) {
      this.unavailable(); return failure('CONNECTION_UNAVAILABLE');
    }
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
      const pending = this.transport!.pair(uri, guard, (pairing) => {
        guard();
        if (!Number.isSafeInteger(pairing.expiresAt) || pairing.expiresAt <= Date.now()) failure('REQUEST_EXPIRED');
        this.canceledPairings.delete(pairing.topic);
        attemptedPairing = pairing;
        this.watchPairing(pairing, action);
        this.publish();
      });
      const pairing = await new Promise<WalletConnectPairing>((resolve, reject) => {
        const aborted = () => reject(new ConnectionActionError('CONTEXT_CHANGED'));
        action.signal.addEventListener('abort', aborted, { once: true });
        if (action.signal.aborted) aborted();
        pending.then(resolve, reject).finally(() => action.signal.removeEventListener('abort', aborted));
      });
      try {
        guard();
        if (!Number.isSafeInteger(pairing.expiresAt) || pairing.expiresAt <= Date.now()) failure('REQUEST_EXPIRED');
        this.watchPairing(pairing, action);
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
          if (this.pairing === attemptedPairing) { this.pairing = undefined; this.clearPairingDeadline(); }
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
    if (!this.canApprove(proposal, accountId))
      return failure('UNSUPPORTED_REQUEST');
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
        && (proposal.expiresAt === null || proposal.expiresAt > Date.now())
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
      const scope = this.chainScope(context), chain = dappCaipChain(scope), family = dappNamespace(scope);
      const { methods, events } = this.proposalPermissions(proposal, context, account);
      const session = await this.transport!.approve(
        proposal,
        {
          [family]: {
            chains: [chain],
            accounts: [`${chain}:${this.accountAnchor(account, scope)}`],
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
      this.clearProposalDeadline(id);
      this.pairing = undefined;
      this.clearPairingDeadline();
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
    this.clearProposalDeadline(id);
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
    if (await this.retireConnection(connected)) this.notifyRetiredConnection(connected);
  }
  private async retireConnection(connected: Connected): Promise<boolean> {
    const session = connected.session, key = sessionKey(session);
    if (this.connections.get(key) !== connected) return false;
    for (const message of [...this.requests.values()])
      if (message.connection === connected) void this.retireRequest(message);
    const revoking = connected.engine.revoke(session.binding.origin, {
      allowAlreadyDisconnected: true,
    });
    this.controls.revalidate(); this.sentry.revalidate(); this.psbt.revalidate(); this.preparations.revalidate(); this.revalidatePsbtHandoff(); this.revalidateReads();
    await revoking;
    if (this.connections.get(key) !== connected || connected.session !== session || connected.engine.get(session.binding.origin)) return false;
    this.connections.delete(key);
    this.publish();
    return true;
  }
  private notifyRetiredConnection(connected: Connected) {
    if (this.disposed || this.connections.has(sessionKey(connected.session)) || connected.engine.get(connected.session.binding.origin)) return;
    this.notifyRemoteDisconnect(connected);
  }
  private startModeRetirement(wire: WalletConnectRequest) {
    const owner = this.modeOwners.get(wire);
    if (!owner || owner.cleanup || owner.sourceFamily === owner.targetFamily || this.connections.get(owner.key) !== owner.connection || owner.connection.session.binding.origin !== owner.origin || owner.connection.engine.get(owner.origin) !== owner.grant) return;
    owner.cleanup = this.retireConnection(owner.connection).catch(cause => { this.unavailable(); throw cause; });
    void owner.cleanup.catch(() => undefined);
  }
  private async finishModeRetirement(wire: WalletConnectRequest) {
    const owner = this.modeOwners.get(wire);
    if (!owner) return;
    try {
      this.startModeRetirement(wire);
      if (await owner.cleanup) this.notifyRetiredConnection(owner.connection);
    } finally { this.modeOwners.delete(wire); }
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
  private pendingCount(connection?: Connected): number {
    return [...this.permissionRequests.values()].filter(value => !connection || value === connection).length +
      [...this.reads.values()].filter(value => !connection || value.connection === connection).length +
      [...this.requests.values()].filter(value => !connection || value.connection === connection).length +
      (connection ? this.preparations.count(connection.session.binding.topic) + this.controls.count(connection.session.binding.topic) + this.sentry.count(connection.session.binding.topic) + this.psbt.count(connection.session.binding.topic) + this.handoffs.count(connection.session.binding.topic) : this.preparations.size + this.controls.size + this.sentry.size + this.psbt.size + this.handoffs.size);
  }
  private hasPendingWire(wire: WalletConnectRequest): boolean {
    const key = `${sessionKey(wire.session)}:${wire.id}`;
    return this.permissionRequests.has(key) || this.reads.has(key) || this.preparations.has(wire) || this.controls.has(wire) || this.sentry.has(wire) || this.psbt.has(wire) || this.handoffs.has(wire) ||
      [...this.requests.values()].some(value => value.wire.id === wire.id && value.session.binding.topic === wire.session.binding.topic);
  }
  private async queueSmartPreparation(wire: WalletConnectRequest) {
    const connection = this.connections.get(sessionKey(wire.session)), host = this.host!, transport = this.transport!;
    const context = host.context(), source = this.options.source.getSnapshot(), session = connection?.session;
    const reject = (code: number, message: string) => transport.respond(wire.session.binding, wire.id, { error: { code, message } }, () => this.check(), () => {});
    if (!connection || !session || source.phase !== 'ready' || !context.unlocked || context.network.kind !== 'ethereum' ||
        JSON.stringify(session) !== JSON.stringify(wire.session) || wire.chainId !== `eip155:${context.network.chainId}` ||
        !Object.values(session.namespaces).some(namespace => namespace.methods.includes(wire.method) && namespace.accounts.some(account => account.startsWith(`${wire.chainId}:`))))
      return reject(4100, 'Smart account creation is not authorized for this session');
    const selected = context.accounts.find(account => account.id === context.activeAccountId);
    if (selected?.type === 'Ledger' || selected?.type === 'Trezor')
      return reject(4874, 'Hardware wallets cannot interact with this request. Please switch to a different account.');
    if (wire.freshness !== 'fresh') return reject(4001, 'Reissue a fresh smart account creation request');
    assertProviderRequestBudget({ method: wire.method, params: wire.params });
    if (this.hasPendingWire(wire)) return;
    if (this.pendingCount() >= DAPP_REQUEST_LIMITS.pendingRequests || this.pendingCount(connection) >= DAPP_REQUEST_LIMITS.requestsPerOrigin)
      return reject(-32005, 'Too many requests');
    const request = ((Array.isArray(wire.params) ? wire.params[0] : wire.params) || {}) as SmartAccountPreparationRequest;
    const fallbackLabel = `${new URL(session.binding.origin).hostname} Smart Account`.slice(0, 64);
    const label = typeof request.label === 'string' && request.label.trim() ? request.label.trim() : fallbackLabel;
    const network = JSON.stringify(context.network), generation = this.transportGeneration, wallet = host.walletBindingId;
    const identity = (value: WalletConnectSession) => { const { namespaces: _namespaces, ...rest } = value; return JSON.stringify(rest); };
    const owner = { connection, session, updating: false, check: () => {
      this.check();
      const next = host.context(), live = connection.session;
      if (this.host !== host || this.transport !== transport || this.transportGeneration !== generation || host.walletBindingId !== wallet ||
          this.options.source.getSnapshot().phase !== 'ready' || !next.unlocked || next.networkId !== context.networkId || JSON.stringify(next.network) !== network ||
          this.connections.get(sessionKey(wire.session)) !== connection || wire.expiresAt <= Date.now() || live.expiry * 1000 <= Date.now() ||
          (owner.updating ? identity(live) !== identity(owner.session) : JSON.stringify(live) !== JSON.stringify(owner.session)))
        failure('CONTEXT_CHANGED');
    } };
    this.preparationOwners.set(wire, owner);
    this.preparations.enqueue(wire, { label, authenticator: getRequestedSmartAccountAuthenticator(request) }, {
      order: ++this.serial, networkId: context.networkId, networkLabel: context.networkLabel, chainId: String(context.network.chainId),
      assertSessionCurrent: owner.check,
      assertCurrent: () => {
        owner.check();
        if (this.options.source.getSnapshot().revision !== source.revision || host.context().activeAccountId !== context.activeAccountId)
          failure('CONTEXT_CHANGED');
      },
    });
  }
  private async connectPreparedAccount(wire: WalletConnectRequest, allocation: NativeSmartCreationAllocation, signal: AbortSignal, assertCurrent: () => void): Promise<void> {
    const owner = this.preparationOwners.get(wire), transport = this.transport!, host = this.host!;
    if (!owner) return failure('REQUEST_EXPIRED');
    const origin = wire.session.binding.origin, connection = owner.connection;
    let grantRevocation: Promise<void> | undefined;
    const cancelGrant = () => {
      // The shared engine synchronously invalidates its pending grant before
      // joining the durable revocation; a held write cannot publish it later.
      grantRevocation ??= connection.engine.revoke(origin, { allowAlreadyDisconnected: true });
      void grantRevocation.catch(() => this.unavailable());
    };
    const check = () => { if (signal.aborted) return failure('REQUEST_EXPIRED'); assertCurrent(); owner.check(); allocation.assertCurrent(); };
    check();
    owner.updating = true;
    try {
      // Revoke before the protocol mutation. A lost update acknowledgement must
      // never leave the original account grant active or authorize the new one.
      await connection.engine.revoke(origin, { allowAlreadyDisconnected: true });
      check();
      const session = await transport.updatePreparedAccount(wire.session.binding, wire.id, allocation.account.address, signal, check, current => {
        owner.session = current;
        if (this.connections.get(sessionKey(wire.session)) === connection) connection.session = current;
      });
      owner.updating = false;
      check();
      if (JSON.stringify(connection.session) !== JSON.stringify(session)) return failure('CONTEXT_CHANGED');
      const context = host.context(), account = allocation.account;
      signal.addEventListener('abort', cancelGrant, { once: true });
      try {
        check();
        await connection.engine.connect({ host: origin, accountId: account.index, accountType: account.type as KeyringAccountType,
          chain: context.network.kind, chainId: allocation.chainId, date: Date.now() },
        { address: account.address, xpub: account.xpub, network: context.network });
        check();
      } finally { signal.removeEventListener('abort', cancelGrant); }
    } catch (error) {
      cancelGrant();
      await grantRevocation;
      this.notifyRemoteDisconnect(connection);
      throw error;
    } finally { owner.updating = false; }
  }
  private async queueControlRequest(wire: WalletConnectRequest) {
    const connection = this.connections.get(sessionKey(wire.session));
    const host = this.host!, origin = wire.session.binding.origin;
    const context = host.controls.context();
    const grant = connection?.engine.get(origin);
    const account = context?.accounts.find(entry => entry.slip44 === (grant?.chain === 'syscoin' ? grant.utxoAccount?.slip44 : 60) && entry.index === grant?.accountId && entry.type === grant?.accountType);
    const reject = (code: number, message: string) => this.transport!.respond(wire.session.binding, wire.id, { error: { code, message } }, () => this.check(), () => undefined);
    if (!connection || !grant || !account || !context || connection.session.binding.origin !== origin || this.options.source.getSnapshot().phase !== 'ready')
      return reject(4100, 'Account is unavailable');
    const mode = (DAPP_MODE_METHODS as readonly string[]).includes(wire.method);
    const networkControl = mode || wire.method === 'wallet_switchEthereumChain' || wire.method === 'wallet_addEthereumChain';
    // Network display changes keep the saved grant independent of the display account/family.
    // Asset admission retains the selected signer and selected-chain requirements.
    if (!networkControl) {
      const signer = host.context();
      if (!signer.unlocked || signer.activeAccountId !== account.id || signer.network.kind !== 'ethereum') return reject(4100, 'Account is unavailable');
      if (grant.chainId !== signer.network.chainId) return reject(4901, 'Requested chain is not selected');
    }
    if (grant.chain === 'syscoin') {
      if (!mode) return reject(4200, 'Unsupported method');
      const signer = host.context(), scope = this.chainScope(signer), granted = signer.accounts.find(value => value.id === account.id);
      if (!granted || scope.kind !== 'syscoin' || grant.chainId !== scope.chainId || grant.utxoAccount?.xpub !== granted.xpub || grant.utxoAccount.slip44 !== scope.slip44 || !this.permits(connection, wire, granted, scope)) return reject(4100, 'Method or account is not authorized');
    } else {
      if (wire.chainId !== `eip155:${grant.chainId}`) return reject(4901, 'Requested chain is not granted');
      if (!Object.values(connection.session.namespaces).some(namespace => namespace.methods.includes(wire.method) && namespace.accounts.some(value => value.toLowerCase() === `${wire.chainId}:${account.address}`.toLowerCase()))) return reject(4100, 'Method or account is not authorized');
    }
    if (this.hasPendingWire(wire)) return;
    if (this.pendingCount() >= DAPP_REQUEST_LIMITS.pendingRequests || this.pendingCount(connection) >= DAPP_REQUEST_LIMITS.requestsPerOrigin)
      return reject(-32005, 'Too many requests');
    let request;
    try { request = mode ? normalizeDappModeRequest(wire.method, wire.params) : normalizeDappWalletControl(wire.method as Parameters<typeof normalizeDappWalletControl>[0], wire.params); }
    catch (cause) { return reject(cause instanceof EthereumRpcErrorHandler ? cause.code : -32602, cause instanceof Error ? cause.message : 'Invalid wallet request'); }
    const session = connection.session;
    const assertSessionCurrent = () => {
      this.check();
      const phase = this.options.source.getSnapshot().phase;
      if (!['ready', 'authenticating'].includes(phase) || this.connections.get(sessionKey(session)) !== connection || connection.session !== session || connection.engine.get(origin) !== grant || wire.expiresAt <= Date.now() || session.expiry * 1000 <= Date.now()) failure('CONTEXT_CHANGED');
    };
    const assertCurrent = () => {
      assertSessionCurrent();
      const next = host.controls.context();
      if (this.options.source.getSnapshot().phase !== 'ready' || !next || next.revision !== context.revision || next.catalogueRevision !== context.catalogueRevision || next.activeAccountId !== context.activeAccountId || next.networkId !== context.networkId || !next.accounts.some(entry => entry.id === account.id && entry.address === account.address && entry.slip44 === account.slip44)) failure('CONTEXT_CHANGED');
    };
    if ('kind' in request) {
      const selected = host.context();
      if (selected.network.kind === request.kind && selected.network.chainId === request.chainId) {
        assertCurrent(); return this.transport!.respond(wire.session.binding, wire.id, { result: null }, assertCurrent, () => {});
      }
    }
    const networkFamily = host.context().network.kind;
    if (networkFamily !== 'ethereum' && networkFamily !== 'syscoin') return reject(4100, 'Account is unavailable');
    if ('kind' in request) this.modeOwners.set(wire, { connection, grant, origin, key: sessionKey(session), sourceFamily: networkFamily, targetFamily: request.kind });
    this.controls.enqueue(wire, request, { networkFamily, order: ++this.serial, accountId: account.id, networkId: context.networkId, accountLabel: account.label, address: account.address, networkLabel: context.networkLabel, chainId: String(grant.chainId), assertCurrent, assertSessionCurrent });
  }
  private signingResumeScope(binding: import('./storage.ts').NativeConnectionBinding, selection: 'granted' | 'selected'): SigningResumeScope | null {
    if (!this.transport || !this.host || this.options.source.getSnapshot().phase !== 'ready') return null;
    const context = this.host.context(), connection = [...this.connections.values()].find(value => JSON.stringify(value.session.binding) === JSON.stringify(binding));
    const grant = connection?.engine.get(binding.origin), account = context.accounts.find(value => value.index === grant?.accountId && value.type === grant?.accountType);
    if (!connection || !grant || !context.unlocked || !account || (selection === 'selected' && context.activeAccountId !== account.id) || !account.xpub) return null;
    try {
      const signing = grant.chain === 'syscoin' ? { trezor: account.type === 'Trezor', binding: account.xpub } : this.host.signingContext(account.id);
      return Object.freeze({ trezor: signing.trezor, signing: signing.binding, adapter: this.transportGeneration, wallet: this.host.walletBindingId, unlockGeneration: this.host.sessionGeneration(),
        accountId: account.id, address: account.address, type: account.type, xpub: account.xpub,
        registration: JSON.stringify(grant.chain === 'syscoin' ? this.host.syscoin.registration() : this.host.registration()), grant: JSON.stringify(grant) });
    } catch { return null; }
  }
  private revalidatePsbtHandoff() {
    const check = (descriptor: SigningHandoffDescriptor) => {
      if (descriptor.expiresAt <= Date.now() || descriptor.scope.adapter !== this.transportGeneration) return false;
      const connection = [...this.connections.values()].find(value => JSON.stringify(value.session.binding) === JSON.stringify(descriptor.binding));
      if (!connection || connection.session.expiry * 1000 <= Date.now() || JSON.stringify(connection.engine.get(descriptor.binding.origin)) !== descriptor.scope.grant) return false;
      if (this.options.source.getSnapshot().phase !== 'ready') return true;
      const scope = this.signingResumeScope(descriptor.binding, 'selected');
      return !!scope && sameSigningResumeOwner(descriptor.scope, scope);
    };
    this.psbt.revalidateSuspended(check); this.handoffs.revalidate(check);
  }
  private async queuePsbtRequest(wire: WalletConnectRequest, resumeId?: string) {
    const connection = this.connections.get(sessionKey(wire.session)), context = this.host!.context(), origin = wire.session.binding.origin;
    const grant = connection?.engine.get(origin), account = context.accounts.find(value => value.index === grant?.accountId && value.type === grant?.accountType);
    const reject = (code: number, message: string) => this.transport!.respond(wire.session.binding, wire.id, { error: { code, message } }, () => this.check(), () => {});
    if (!connection || connection.session.binding.origin !== origin || !grant || grant.chain !== 'syscoin' || !account || !context.unlocked || context.activeAccountId !== account.id || this.options.source.getSnapshot().phase !== 'ready') return reject(4100, 'Account is unavailable');
    const scope = this.chainScope(context);
    if (scope.kind !== 'syscoin' || scope.chainId !== grant.chainId || grant.utxoAccount?.slip44 !== scope.slip44 || grant.utxoAccount.xpub !== account.xpub || !this.permits(connection, wire, account, scope)) return reject(4100, 'Method or account is not authorized');
    if ((account.type !== 'HDAccount' && account.type !== 'Imported' && account.type !== 'Ledger' && account.type !== 'Trezor') || !this.supportedMethods(account.type, account.id).includes(wire.method)) return reject(4200, 'PSBT signing is unavailable for this account');
    if (account.type === 'Trezor' && wire.freshness !== 'fresh') return reject(4200, 'Reissue a fresh PSBT request with an explicit expiry');
    if (!resumeId && this.hasPendingWire(wire)) return;
    if (!resumeId && (this.pendingCount() >= DAPP_REQUEST_LIMITS.pendingRequests || this.pendingCount(connection) >= DAPP_REQUEST_LIMITS.requestsPerOrigin)) return reject(-32005, 'Too many requests');
    const selectedNetwork = this.host!.syscoin.registration(), network = JSON.stringify(selectedNetwork);
    const revision = this.options.source.getSnapshot().revision, session = connection.session;
    const check = () => {
      this.check(); const next = this.host!.context();
      if (this.options.source.getSnapshot().phase !== 'ready' || this.options.source.getSnapshot().revision !== revision || this.connections.get(sessionKey(session)) !== connection || connection.session !== session || connection.engine.get(origin) !== grant || !next.unlocked || next.activeAccountId !== account.id || next.networkId !== context.networkId || JSON.stringify(this.host!.syscoin.registration()) !== network || !next.accounts.some(value => value.id === account.id && value.xpub === account.xpub) || wire.expiresAt <= Date.now() || session.expiry * 1000 <= Date.now()) failure('CONTEXT_CHANGED');
    };
    const resumeScope = this.signingResumeScope(wire.session.binding, 'selected');
    if (!resumeScope) return reject(4100, 'Account is unavailable');
    const assertSessionCurrent = () => {
      this.check();
      if (this.connections.get(sessionKey(session)) !== connection || connection.session !== session || connection.engine.get(origin) !== grant ||
          resumeScope.adapter !== this.transportGeneration || wire.expiresAt <= Date.now() || session.expiry * 1000 <= Date.now()) failure('CONTEXT_CHANGED');
    };
    try {
      this.psbt.enqueue(wire, { order: ++this.serial, accountLabel: account.label, address: account.address,
        networkLabel: context.networkLabel, chainId: dappCaipChain(scope), symbol: selectedNetwork.symbol, decimals: selectedNetwork.decimals,
        resumeScope, assertCurrent: check, assertSessionCurrent }, resumeId);
    } catch { return reject(-32602, 'Supply one structured PSBT and asset payload'); }
  }
  private async queueSentryRequest(wire: WalletConnectRequest) {
    const connection = this.connections.get(sessionKey(wire.session)), context = this.host!.context(), origin = wire.session.binding.origin;
    const grant = connection?.engine.get(origin), account = context.accounts.find(value => value.index === grant?.accountId && value.type === grant?.accountType);
    const reject = (code: number, message: string) => this.transport!.respond(wire.session.binding, wire.id, { error: { code, message } }, () => this.check(), () => {});
    if (!connection || connection.session.binding.origin !== origin || !grant || grant.chain !== 'syscoin' || !account || !context.unlocked || context.activeAccountId !== account.id || this.options.source.getSnapshot().phase !== 'ready') return reject(4100, 'Account is unavailable');
    const scope = this.chainScope(context);
    if (scope.kind !== 'syscoin' || scope.chainId !== grant.chainId || grant.utxoAccount?.slip44 !== scope.slip44 || grant.utxoAccount.xpub !== account.xpub || !this.permits(connection, wire, account, scope)) return reject(4100, 'Method or account is not authorized');
    if (!this.supportedMethods(account.type, account.id).includes(wire.method)) return reject(4200, 'Unsupported method');
    if (!Array.isArray(wire.params) || wire.params.length !== 1) return reject(-32602, 'Supply one typed Sentry operation');
    assertProviderRequestBudget({ method: wire.method, params: wire.params });
    if (this.hasPendingWire(wire)) return;
    if (this.pendingCount() >= DAPP_REQUEST_LIMITS.pendingRequests || this.pendingCount(connection) >= DAPP_REQUEST_LIMITS.requestsPerOrigin) return reject(-32005, 'Too many requests');
    const revision = this.options.source.getSnapshot().revision, session = connection.session, network = JSON.stringify(this.host!.syscoin.registration());
    const assertGrantCurrent = () => {
      this.check(); const next = this.host!.context();
      if (this.options.source.getSnapshot().phase !== 'ready' || this.options.source.getSnapshot().revision !== revision || this.connections.get(sessionKey(session)) !== connection || connection.session !== session || connection.engine.get(origin) !== grant || !next.unlocked || next.activeAccountId !== account.id || next.networkId !== context.networkId || JSON.stringify(this.host!.syscoin.registration()) !== network || !next.accounts.some(value => value.id === account.id && value.xpub === account.xpub) || session.expiry * 1000 <= Date.now()) failure('CONTEXT_CHANGED');
    };
    const check = () => { assertGrantCurrent(); if (wire.expiresAt <= Date.now()) failure('CONTEXT_CHANGED'); };
    this.sentry.enqueue(wire, { order: ++this.serial, accountLabel: account.label, address: account.address, networkLabel: context.networkLabel, chainId: dappCaipChain(scope), assertCurrent: check, assertGrantCurrent });
  }
  private revalidateReads() {
    for (const read of this.reads.values()) {
      try { read.check(); } catch { read.lifetime.abort(); }
    }
  }
  private async respondPermissions(wire: WalletConnectRequest) {
    const connection = this.connections.get(sessionKey(wire.session));
    const origin = wire.session.binding.origin;
    const session = connection?.session;
    const sessionCheck = () => {
      this.check();
      if (!connection || connection.session !== session || session?.binding.origin !== origin || this.connections.get(sessionKey(session)) !== connection || wire.expiresAt <= Date.now() || session.expiry * 1000 <= Date.now()) failure('CONTEXT_CHANGED');
    };
    const respond = (response: { result: unknown } | { error: { code: number; message: string } }, check = sessionCheck) => this.transport!.respond(wire.session.binding, wire.id, response, check, () => undefined);
    if (!connection || session?.binding.origin !== origin || !Object.values(session.namespaces).some(namespace => namespace.methods.includes(wire.method) && namespace.accounts.some(value => value.startsWith(`${wire.chainId}:`)))) return respond({ error: { code: 4100, message: 'Method or chain is not authorized' } });
    let permissions;
    try { permissions = readDappPermissionRequest(wire.method as Parameters<typeof readDappPermissionRequest>[0], wire.params); }
    catch (cause) { return respond({ error: { code: cause instanceof EthereumRpcErrorHandler ? cause.code : -32602, message: cause instanceof Error ? cause.message : 'Invalid permission request' } }); }
    const key = `${sessionKey(wire.session)}:${wire.id}`;
    if (this.hasPendingWire(wire)) return;
    if (this.pendingCount() >= DAPP_REQUEST_LIMITS.pendingRequests || this.pendingCount(connection) >= DAPP_REQUEST_LIMITS.requestsPerOrigin) return respond({ error: { code: -32005, message: 'Too many requests' } });
    this.permissionRequests.set(key, connection);
    const finish = this.disposal.begin();
    try {
      sessionCheck();
      if (wire.method === 'wallet_revokePermissions') {
        if (!Object.keys(permissions).length) return await respond({ result: null });
        const revoking = connection.engine.revoke(origin, { allowAlreadyDisconnected: true });
        for (const message of [...this.requests.values()]) if (message.connection === connection) void this.retireRequest(message, false);
        for (const read of this.reads.values()) if (read.connection === connection) read.lifetime.abort();
        this.controls.revalidate(); this.sentry.revalidate(); this.psbt.revalidate(); this.preparations.revalidate(); this.revalidatePsbtHandoff();
        if (this.statusSession === session) this.dismissStatus();
        this.publish();
        try { await revoking; }
        catch { return await respond({ error: { code: -32603, message: 'Permission revocation failed' } }); }
        const revoked = () => { sessionCheck(); if (connection.engine.get(origin)) failure('CONTEXT_CHANGED'); };
        try { await respond({ result: null }, revoked); }
        finally {
          if (this.connections.get(sessionKey(session)) === connection) this.connections.delete(sessionKey(session));
          this.publish(); this.notifyRemoteDisconnect(connection);
        }
        return;
      }
      const sysGrant = connection.engine.get(origin);
      if (sysGrant?.chain === 'syscoin') {
        const context = this.host!.context(), revision = this.options.source.getSnapshot().revision;
        const account = context.accounts.find(value => value.index === sysGrant.accountId && value.type === sysGrant.accountType);
        const scope = context.network.kind === 'syscoin' && context.unlocked && this.options.source.getSnapshot().phase === 'ready' ? this.chainScope(context) : null;
        if (!account || !scope || scope.kind !== 'syscoin' || scope.chainId !== sysGrant.chainId || sysGrant.utxoAccount?.slip44 !== scope.slip44 || sysGrant.utxoAccount.xpub !== account.xpub || !this.permits(connection, wire, account, scope))
          return await respond(wire.method === 'wallet_getPermissions' ? { result: [] } : { error: { code: 4100, message: 'A new connection approval is required' } });
        const registration = JSON.stringify(this.host!.syscoin.registration());
        const check = () => { sessionCheck(); const current = this.host!.context();
          if (this.options.source.getSnapshot().phase !== 'ready' || this.options.source.getSnapshot().revision !== revision || connection.engine.get(origin) !== sysGrant || !current.unlocked || JSON.stringify(this.host!.syscoin.registration()) !== registration || !current.accounts.some(value => value.id === account.id && value.xpub === account.xpub)) failure('CONTEXT_CHANGED');
        };
        return await respond({ result: projectDappPermissions(origin, account.address, sysGrant.date, undefined) }, check);
      }
      const context = this.host!.controls.context(), revision = this.options.source.getSnapshot().revision;
      const grant = connection.engine.get(origin);
      const account = grant && context?.accounts.find(value => value.slip44 === 60 && value.index === grant.accountId && value.type === grant.accountType);
      const ceiling = grant?.chain === 'ethereum' && wire.chainId === `eip155:${grant.chainId}` && account && Object.values(session.namespaces).some(namespace => namespace.methods.includes(wire.method) && namespace.accounts.some(value => value.toLowerCase() === `${wire.chainId}:${account.address}`.toLowerCase()));
      if (!context || this.options.source.getSnapshot().phase !== 'ready' || !ceiling || !grant || !account) {
        return await respond(wire.method === 'wallet_getPermissions' ? { result: [] } : { error: { code: 4100, message: 'A new connection approval is required' } });
      }
      const check = () => {
        sessionCheck();
        const next = this.host!.controls.context();
        if (revision !== this.options.source.getSnapshot().revision || this.options.source.getSnapshot().phase !== 'ready' || !next || next.revision !== context.revision || next.catalogueRevision !== context.catalogueRevision || connection.engine.get(origin) !== grant || !next.accounts.some(value => value.id === account.id && value.address === account.address && value.slip44 === 60)) failure('CONTEXT_CHANGED');
      };
      // Like the extension's connected shortcut: existing authority is returned,
      // never replaced by the current display account or an unnegotiated chain.
      return await respond({ result: projectDappPermissions(origin, account.address, grant.date, [grant.chainId]) }, check);
    } finally { if (this.permissionRequests.get(key) === connection) this.permissionRequests.delete(key); finish(); }
  }
  private async respondRead(wire: WalletConnectRequest) {
    const connection = this.connections.get(sessionKey(wire.session));
    const context = this.host!.context(), origin = wire.session.binding.origin;
    const grant = connection?.engine.get(origin);
    const account = grant && context.accounts.find(value => value.index === grant.accountId && value.type === grant.accountType);
    const respond = (response: { result: unknown } | { error: { code: number; message: string; data?: string } }, check: () => void = () => this.check()) => this.transport!.respond(wire.session.binding, wire.id, response, check, () => undefined);
    if (!connection || connection.session.binding.origin !== origin || !grant || !account || !context.unlocked || this.options.source.getSnapshot().phase !== 'ready' || !connection.engine.isConnected(origin)) return respond({ error: { code: 4100, message: 'Account is unavailable' } });
    const scope = this.chainScope(context), syscoin = isDappSyscoinRead(wire.method);
    if (grant.chain !== scope.kind || grant.chainId !== scope.chainId || syscoin !== (scope.kind === 'syscoin')) return respond({ error: { code: 4901, message: 'Requested chain is not selected' } });
    if (scope.kind === 'syscoin' && (grant.utxoAccount?.slip44 !== scope.slip44 || grant.utxoAccount.xpub !== account.xpub)) return respond({ error: { code: 4100, message: 'Account is unavailable' } });
    if (!this.permits(connection, wire, account, scope)) return respond({ error: { code: wire.chainId === dappCaipChain(scope) ? 4100 : 4901, message: 'Method or account is not authorized' } });
    const key = `${sessionKey(wire.session)}:${wire.id}`;
    if (this.hasPendingWire(wire)) return;
    if (this.pendingCount() >= DAPP_REQUEST_LIMITS.pendingRequests || this.pendingCount(connection) >= DAPP_REQUEST_LIMITS.requestsPerOrigin) return respond({ error: { code: -32005, message: 'Too many requests' } });
    let request;
    try { request = syscoin ? normalizeDappSyscoinRead(wire.method, wire.params) : normalizeDappRpcRequest(wire.method, wire.params); }
    catch (cause) { return respond({ error: { code: cause instanceof EthereumRpcErrorHandler ? cause.code : -32602, message: cause instanceof Error ? cause.message : 'Invalid RPC read' } }); }
    const session = connection.session, revision = this.options.source.getSnapshot().revision, network = JSON.stringify(context.network), utxoNetwork = syscoin ? JSON.stringify(this.host!.syscoin.registration()) : null;
    const lifetime = new AbortController(), finish = this.disposal.begin();
    const check = () => {
      this.check(); const next = this.host!.context();
      if (lifetime.signal.aborted || wire.expiresAt <= Date.now() || session.expiry * 1000 <= Date.now() || revision !== this.options.source.getSnapshot().revision || this.options.source.getSnapshot().phase !== 'ready' || !next.unlocked || next.networkId !== context.networkId || JSON.stringify(next.network) !== network || this.connections.get(sessionKey(session)) !== connection || connection.session !== session || connection.engine.get(origin) !== grant || (utxoNetwork !== null && JSON.stringify(this.host!.syscoin.registration()) !== utxoNetwork) || !next.accounts.some(value => value.id === account.id && (syscoin || value.address === account.address) && value.xpub === account.xpub)) failure('CONTEXT_CHANGED');
    };
    const entry = { wire, connection, lifetime, check };
    const timer = setTimeout(() => lifetime.abort(), Math.max(0, Math.min(wire.expiresAt, session.expiry * 1000) - Date.now()));
    this.reads.set(key, entry);
    try {
      check(); const result = isDappSyscoinRead(request.method) ? await this.host!.syscoin.read(request as ReturnType<typeof normalizeDappSyscoinRead>, account, lifetime.signal, check) : await this.host!.reads.read(request as ReturnType<typeof normalizeDappRpcRequest>, lifetime.signal, check); check();
      await respond({ result }, check);
    } catch (cause) {
      check();
      await respond({ error: cause instanceof EthereumRpcErrorHandler ? { code: cause.code, message: cause.message.slice(0, 256), ...(typeof cause.data === 'string' ? { data: cause.data } : {}) } : { code: -32603, message: 'RPC read unavailable' } }, check);
    } finally { clearTimeout(timer); lifetime.abort(); if (this.reads.get(key) === entry) this.reads.delete(key); finish(); }
  }
  private async respond(request: WalletConnectRequest) {
    this.check();
    if (request.method === 'wallet_prepareSmartAccount') { await this.queueSmartPreparation(request); return; }
    if ((PSBT_DAPP_METHODS as readonly string[]).includes(request.method)) { await this.queuePsbtRequest(request); return; }
    if (isDappPermissionMethod(request.method)) {
      await this.respondPermissions(request);
      return;
    }
    if ((SENTRY_DAPP_METHODS as readonly string[]).includes(request.method)) { await this.queueSentryRequest(request); return; }
    if (isDappPublicRpcMethod(request.method) || isDappSyscoinRead(request.method)) {
      await this.respondRead(request);
      return;
    }
    if (isDappWalletControlMethod(request.method) || (DAPP_MODE_METHODS as readonly string[]).includes(request.method)) {
      await this.queueControlRequest(request);
      return;
    }
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
    let responseGuard = guard;
    if (
      isDappMessageMethod(request.method) || isDappEncryptionMethod(request.method) ||
      request.method === 'eth_sendTransaction' ||
      request.method === 'wallet_sendCalls' || isSmartAccountModuleRequestMethod(request.method)
    ) {
      await this.queueSigningRequest(request);
      return;
    }
    let result: unknown, error: { code: number; message: string } | undefined;
    if (!connected?.engine.isConnected(request.session.binding.origin))
      error = { code: 4100, message: 'Not connected' };
    else if (request.method === 'wallet_getCapabilities' || request.method === 'wallet_getSmartAccountModules') {
      try {
        if (request.method === 'wallet_getSmartAccountModules') responseGuard = () => {
          guard();
          if (!Number.isSafeInteger(request.expiresAt) || request.expiresAt <= Date.now() || this.options.source.getSnapshot().phase !== 'ready' || !this.host!.context().unlocked) failure('REQUEST_EXPIRED');
        };
        const query = request.method === 'wallet_getCapabilities' ? normalizeDappCapabilitiesRequest(request.params) : null;
        const account = connected.engine.getAccount(
          request.session.binding.origin
        );
        const nativeAccount = context.accounts.find(
          (entry) =>
            entry.index === grant?.accountId && entry.type === grant.accountType
        );
        const permitted =
          account &&
          nativeAccount &&
          grant?.chain === 'ethereum' &&
          session?.binding.origin === request.session.binding.origin &&
          request.chainId === `eip155:${grant.chainId}` &&
          Object.values(session.namespaces).some(
            (namespace) =>
              namespace.methods.includes(request.method) &&
              namespace.accounts.some(
                (id) =>
                  id.toLowerCase() ===
                  `${request.chainId}:${account.address}`.toLowerCase()
              )
          );
        if (
          !context.unlocked ||
          this.options.source.getSnapshot().phase !== 'ready' ||
          !permitted
        ) {
          error = {
            code: 4100,
            message: 'Method or account is not authorized',
          };
        } else {
          responseGuard();
          result = query === null ? this.host!.readSmartAccountModules(nativeAccount!.id, context.networkId, responseGuard) : projectDappCapabilities(query, {
            accountAddress: account.address,
            chain:
              context.network.kind === 'ethereum' &&
              context.network.chainId === grant.chainId
                ? {
                    chainId: context.network.chainId,
                    batchSupported:
                      nativeAccount!.type === 'HDAccount' || nativeAccount!.type === 'Imported' || nativeAccount!.type === 'Ledger' || nativeAccount!.type === 'Trezor' ||
                      nativeAccount!.type === 'SmartAccount' && this.host!.supportsAtomicCalls(nativeAccount!.id),
                    atomicSupported:
                      nativeAccount!.type === 'SmartAccount' &&
                      this.host!.supportsAtomicCalls(nativeAccount!.id),
                  }
                : null,
          });
        }
      } catch (cause) {
        if (cause instanceof EthereumRpcErrorHandler) error = { code: cause.code, message: cause.message };
        else if (request.method === 'wallet_getSmartAccountModules') error = { code: -32600, message: cause instanceof SmartAccountModulesProjectionError ? cause.message : 'Smart account modules are unavailable' };
        else throw cause;
      }
    } else if (
      request.method === 'wallet_getCallsStatus' ||
      request.method === 'wallet_showCallsStatus'
    ) {
      const expiresAt = request.expiresAt;
      const statusGuard = () => {
        guard();
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
          failure('REQUEST_EXPIRED');
      };
      responseGuard = statusGuard;
      try {
        statusGuard();
        const account = connected.engine.getAccount(
          request.session.binding.origin
        );
        const permitted =
          account &&
          (grant?.accountType === 'HDAccount' ||
            grant?.accountType === 'Imported' ||
            grant?.accountType === 'Ledger' ||
            grant?.accountType === 'Trezor' ||
            grant?.accountType === 'SmartAccount') &&
          grant.chain === 'ethereum' &&
          session &&
          session.binding.origin === request.session.binding.origin &&
          request.chainId === `eip155:${grant.chainId}` &&
          Object.values(session.namespaces).some(
            (namespace) =>
              namespace.methods.includes(request.method) &&
              namespace.accounts.some(
                (entry) =>
                  entry.toLowerCase() ===
                  `${request.chainId}:${account.address}`.toLowerCase()
              )
          );
        if (
          !context.unlocked ||
          this.options.source.getSnapshot().phase !== 'ready' ||
          !permitted
        )
          throw new EthereumRpcErrorHandler(
            4100,
            'Method or account is not authorized'
          );
        if (
          !Array.isArray(request.params) ||
          request.params.length !== 1 ||
          typeof request.params[0] !== 'string'
        )
          throw new EthereumRpcErrorHandler(
            -32602,
            'Expected a call bundle ID'
          );
        const bundleId = request.params[0];
        const hasLiveSequence = () => [...this.requests.values()].some((message) =>
          message.session.binding.origin === request.session.binding.origin &&
          message.request.method === 'wallet_sendCalls' && message.request.bundleId === bundleId);
        const readStatus = async (check: () => void) => {
          check();
          if (!hasLiveSequence()) await this.host!.recoverStoppedEoaCalls(
            request.session.binding.origin, bundleId, () => {
              check();
              if (hasLiveSequence()) throw new Error('Calls sequence is still active');
            });
          check();
          const value = await this.host!.readCallsStatus(request.session.binding.origin, bundleId, check);
          check();
          return value;
        };
        result = await readStatus(statusGuard);
        statusGuard();
        if (request.method === 'wallet_showCallsStatus') {
          if (this.callsStatus)
            throw new EthereumRpcErrorHandler(
              -32005,
              'A call status is already open'
            );
          const id = `status-${++this.serial}`;
          this.statusSession = session;
          this.callsStatus = Object.freeze({
            id,
            origin: request.session.binding.origin,
            status: result as CallsBundleStatus,
          });
          const refreshOwner: NonNullable<typeof this.statusRefresh> = {
            id,
            busy: false,
            check: () => {
              statusGuard();
              if (this.statusRefresh !== refreshOwner || this.callsStatus?.id !== id ||
                  this.options.source.getSnapshot().phase !== 'ready' || !this.host!.context().unlocked ||
                  !connected.engine.isConnected(request.session.binding.origin) || session.expiry * 1000 <= Date.now())
                failure('CONTEXT_CHANGED');
            },
            read: () => readStatus(refreshOwner.check),
          };
          this.statusRefresh = refreshOwner;
          this.statusResponse = async (shown) => {
            const assertStatusCurrent = () => {
              statusGuard();
              if (shown && this.callsStatus?.id !== id)
                failure('CONTEXT_CHANGED');
            };
            assertStatusCurrent();
            await this.transport!.respond(
              request.session.binding,
              request.id,
              shown
                ? { result: null }
                : {
                    error: {
                      code: 4001,
                      message: 'User rejected or request expired',
                    },
                  },
              assertStatusCurrent,
              () => undefined
            );
          };
          this.statusTimer = setTimeout(
            () => this.dismissStatus(),
            Math.max(0, request.expiresAt - Date.now())
          );
          this.publish();
          return;
        }
      } catch (cause) {
        const code =
          cause instanceof Error && 'code' in cause ? cause.code : undefined;
        error =
          typeof code === 'number' && Number.isSafeInteger(code)
            ? { code, message: (cause as Error).message }
            : { code: -32603, message: 'Call status is unavailable' };
      }
    } else if (request.chainId !== `eip155:${context.network.chainId}`)
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
      responseGuard,
      () => undefined
    );
  }
  private signingReview(): NativeSigningReview | null {
    const message = this.requests.values().next().value as
      | PendingSigning
      | undefined;
    if (!message || Math.min(this.controls.firstOrder, this.sentry.firstOrder, this.psbt.firstOrder, this.handoffs.firstOrder, this.preparations.firstOrder) < message.queueOrder) return null;
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
  private isRequestAuthenticating(id: string): boolean {
    const message = this.requests.get(id);
    if (!message) return this.psbt.isRequestAuthenticating(id) || this.preparations.isRequestAuthenticating(id);
    if (this.requests.values().next().value !== message ||
        Math.min(this.controls.firstOrder, this.sentry.firstOrder, this.psbt.firstOrder, this.handoffs.firstOrder, this.preparations.firstOrder) < message.queueOrder) return false;
    try {
      if (!this.requestConnectionCurrent(message)) return false;
      message.approval?.assertCurrent();
      return message.authenticationScope.isAuthenticating();
    } catch { return false; }
  }
  private requestAuthentication(message: PendingSigning): NativePrivateAuthentication {
    if (!message.authentication) return failure('REQUEST_EXPIRED');
    return message.authentication;
  }
  private dismissStatus() {
    if (!this.callsStatus && !this.statusResponse) return;
    const respond = this.statusResponse;
    this.statusResponse = undefined;
    this.statusRefresh = undefined;
    this.callsStatus = null;
    this.statusSession = undefined;
    clearTimeout(this.statusTimer);
    void respond?.(false).catch(() => undefined);
    this.publish();
  }
  private requestConnectionCurrent(message: PendingSigning): boolean {
    const snapshot = this.options.source.getSnapshot();
    const currentPhase =
      snapshot.phase === 'ready' ||
      (message.switching &&
        snapshot.phase === 'authenticating' &&
        snapshot.revision === message.switchRevision);
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
  private captureSigningHandoff(message: PendingSigning, scope: SigningResumeScope, resume: SigningHandoffDescriptor | null): NativeSigningHandoff {
    if (message.handoff) retireNativeSigningHandoff(message.handoff);
    const entry = { id: message.resumeId, wire: message.wire, scope, expiresAt: message.review.expiresAt, order: message.queueOrder,
      assertCurrent: () => { const approval = message.approval; if (!approval) return failure('REQUEST_EXPIRED'); approval.assertCurrent(); if (this.requests.get(message.id) !== message || !this.requestConnectionCurrent(message)) failure('CONTEXT_CHANGED'); },
      eligible: () => message.busy && !message.dispatched && !message.resultReady &&
        (message.eoa ? message.eoa.isAwaitingSignature() : !message.broadcastHash),
      drain: async () => { await message.work; await message.eoa?.drain(); }, retire: () => { void this.retireRequest(message, false); },
    };
    return resume ? this.handoffs.resume(entry, resume) : this.handoffs.capture(entry);
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
    if (this.requests.get(message.id) !== message) return this.requestRetirement;
    this.requests.delete(message.id);
    message.authenticationScope.retire();
    retireNativeSigningHandoff(message.handoff);
    const reservation = message.request.method === 'wallet_sendCalls' && !message.handoff.isSuspended()
      ? this.host?.calls
        .releaseSendCallsBundleReservation(
          message.session.binding.origin,
          message.request.bundleId,
          message.request.reservationId
        )
        .catch(() => undefined)
      : undefined;
    message.unsubscribeSmart?.();
    const smart = message.smart?.dispose();
    message.unsubscribeEoa?.();
    message.eoa?.dispose();
    message.encryption?.retire();
    message.approval?.dispose();
    clearTimeout(message.timer);
    const respondToRequest = !(
      !respond ||
      message.dispatched ||
      (message.broadcastHash && !message.eoa) ||
      this.disposed ||
      !this.transport
    );
    const guard = () => {
      this.check();
      if (
        this.connections.get(sessionKey(message.session))?.session !==
        message.session
      )
        failure('CONTEXT_CHANGED');
    };
    const retiring = Promise.allSettled([this.requestRetirement, smart, reservation]).then(async () => {
      if (!respondToRequest || !this.transport) return;
      await this.transport.respond(
        message.session.binding,
        message.wire.id,
        message.eoa && message.broadcastHash && message.request.method === 'wallet_sendCalls'
          ? { result: { id: message.request.bundleId, capabilities: {} } }
          : { error: { code: 4001, message: 'User rejected or request expired' } },
        guard,
        () => undefined
      )
        .catch(() => undefined);
    });
    this.requestRetirement = retiring;
    this.publish();
    void retiring.then(() => { void this.controls.prepare(); void this.sentry.prepare(); void this.psbt.prepare(); return this.prepareForegroundRequest(); });
    return retiring;
  }
  private async queueSigningRequest(wire: WalletConnectRequest, saved?: SigningHandoffDescriptor) {
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
      grant.chain !== 'ethereum' ||
      !connection.engine.isConnected(origin) ||
      !account ||
      !context.unlocked ||
      this.options.source.getSnapshot().phase !== 'ready' ||
      context.network.kind !== 'ethereum'
    )
      return reject(4100, 'Account is unavailable');
    if (wire.chainId !== `eip155:${context.network.chainId}` || grant.chainId !== context.network.chainId)
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
    let signing: ReturnType<NativeConnectionHost['signingContext']>;
    try { signing = this.host!.signingContext(account.id); } catch { return reject(4200, 'Account signing is unavailable'); }
    if (signing.trezor && wire.freshness !== 'fresh')
      return reject(4200, 'Reissue a fresh signing request with an explicit expiry');
    if (!this.supportedMethods(account.type, account.id).includes(wire.method))
      return reject(4200, 'Unsupported method');
    if (!saved && this.hasPendingWire(wire)) return;
    if (!saved && (this.pendingCount() >= DAPP_REQUEST_LIMITS.pendingRequests || this.pendingCount(connection) >= DAPP_REQUEST_LIMITS.requestsPerOrigin))
      return reject(-32005, 'Too many requests');
    const resumingEoaCalls = saved && wire.method === 'wallet_sendCalls' && account.type !== 'SmartAccount';
    const retainedContinuation = resumingEoaCalls ? this.handoffs.continuation(saved) : undefined;
    const retainedCalls = isNativeEoaCallsContinuation(retainedContinuation) ? retainedContinuation : undefined;
    if (resumingEoaCalls && !retainedCalls) return failure('REQUEST_EXPIRED');
    let request: SigningRequest | undefined;
    try {
      if (wire.method === 'eth_sendTransaction') {
        if (!Array.isArray(wire.params) || wire.params.length !== 1)
          throw new Error('Invalid transaction parameters');
        const transaction = normalizeDappTransaction(wire.params[0]);
        if (
          transaction.from !== undefined &&
          transaction.from.toLowerCase() !== account.address.toLowerCase()
        )
          throw new Error('Transaction signer does not match account');
        if (
          transaction.chainId !== undefined &&
          BigInt(transaction.chainId) !== BigInt(context.network.chainId)
        )
          throw new Error('Transaction chain does not match session');
        request = {
          method: 'eth_sendTransaction',
          transaction: { ...transaction, from: account.address },
        };
      } else if (wire.method === 'wallet_sendCalls') {
        if (!Array.isArray(wire.params) || wire.params.length !== 1)
          throw new EthereumRpcErrorHandler(
            -32602,
            'Expected one calls request'
          );
        const calls = normalizeDappCallsRequest(wire.params[0]);
        const supported =
          account.type === 'SmartAccount' &&
          this.host!.supportsAtomicCalls(account.id);
        assertDappCallsAtomicSupport(calls, supported);
        if (!supported && account.type !== 'HDAccount' && account.type !== 'Imported' && account.type !== 'Ledger' && account.type !== 'Trezor')
          throw new EthereumRpcErrorHandler(
            4200,
            'Smart atomic calls are unavailable for this account'
          );
        if (
          (calls.from &&
            calls.from.toLowerCase() !== account.address.toLowerCase()) ||
          (calls.chainId &&
            BigInt(calls.chainId) !== BigInt(context.network.chainId))
        )
          throw new EthereumRpcErrorHandler(
            4100,
            'The requested account or network is no longer selected'
          );
        if (supported) createSmartAccountCallsExecutions(calls.calls);
        request = {
          method: 'wallet_sendCalls',
          calls: Object.freeze({
            ...calls,
            from: account.address,
            chainId: String(context.network.chainId),
          }),
          bundleId: retainedCalls?.identity.bundleId ?? calls.id ?? this.host!.calls.generateWalletBundleId(),
          reservationId: retainedCalls?.identity.reservationId ?? this.host!.calls.generateWalletBundleId(),
        };
      } else if (isSmartAccountModuleRequestMethod(wire.method)) {
        if (account.type !== 'SmartAccount') throw new EthereumRpcErrorHandler(-32600, 'The connected account is not a smart account');
        request = normalizeSmartAccountModuleRequest(wire.method, wire.params);
      } else if (isDappEncryptionMethod(wire.method)) {
        request = readDappEncryptionRequest(wire.method, wire.params, account.address);
      } else {
        assertDappTypedDataValid(wire.method, wire.params);
        request = readDappMessageRequest(
          wire.method,
          wire.params,
          account.address
        );
      }
    } catch (error) {
      if (error instanceof EthereumRpcErrorHandler)
        return reject(error.code, error.message);
      if (error instanceof SmartAccountModuleRequestError)
        return reject(error.code, error.message);
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
      isOperationRequest(request) || isEncryptionRequest(request) ||
      request.method === 'personal_sign' ||
      request.version === 'V1'
        ? null
        : getTypedOrderReview(request.typedData);
    const expiresAt = Math.min(
      wire.expiresAt,
      Date.now() + MESSAGE_REVIEW_LIFETIME_MS,
      wire.session.expiry * 1000,
      saved?.expiresAt ?? Infinity
    );
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
      return reject(4001, 'Request expired');
    if (request.method === 'wallet_sendCalls' && retainedCalls === undefined) {
      const registry = this.host!.calls;
      const revision = this.options.source.getSnapshot().revision;
      const reserved = await registry.reserveSendCallsBundle(
        origin,
        request.bundleId,
        { atomic: account.type === 'SmartAccount', chainId: context.network.chainId, smartAccount: account.type === 'SmartAccount' },
        request.reservationId,
        account.address
      );
      if (!reserved)
        return reject(
          5720,
          'There is already a bundle submitted with this id (Duplicate ID).'
        );
      if (
        this.disposed ||
        this.options.source.getSnapshot().phase !== 'ready' ||
        this.options.source.getSnapshot().revision !== revision ||
        this.connections.get(sessionKey(wire.session)) !== connection ||
        connection.engine.get(origin) !== grant ||
        expiresAt <= Date.now()
      ) {
        await registry
          .releaseSendCallsBundleReservation(
            origin,
            request.bundleId,
            request.reservationId
          )
          .catch(() => undefined);
        if (!this.disposed)
          return reject(4001, 'Request expired or wallet context changed');
        return;
      }
    }
    const scope = this.signingResumeScope(wire.session.binding, 'granted');
    if (!scope || saved && (saved.wire !== JSON.stringify(wire) || !sameSigningResumeOwner(saved.scope, scope) || scope.unlockGeneration <= saved.scope.unlockGeneration)) return failure('REQUEST_EXPIRED');
    let iconRegistrationHash: string | undefined;
    try {
      const registration = this.host!.registration();
      if (registration.id === context.networkId && registration.chainId === String(context.network.chainId) && registration.rpcUrl === context.network.url)
        iconRegistrationHash = registration.registrationHash;
    } catch { /* Missing public icon scope leaves the generic icon. */ }
    const next = ++this.serial, queueOrder = saved?.order ?? next;
    const id = `request-${next}`;
    const message: PendingSigning = {
      authenticationScope: createNativePrivateAuthenticationScope(), authentication: null,
      queueOrder,
      resumeId: saved?.id ?? id,
      handoff: undefined as unknown as NativeSigningHandoff,
      resultReady: false,
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
        registrationHash: iconRegistrationHash,
        chainId: String(context.network.chainId),
        expiresAt,
        error,
        advisories: Object.freeze([]),
        requiresWarningAcknowledgement: false,
        ...(isOperationRequest(request)
          ? {
              kind: 'transaction' as const,
              feeComparison: null,
              feeChoice: null,
              method: request.method,
              transaction: null,
              maximumFeeUnits: null,
              maximumTotalUnits: null,
              symbol: context.network.currency,
              decimals: 18,
              broadcastHash: null,
              approval: null,
            }
          : isEncryptionRequest(request)
          ? { kind: 'encryption' as const, method: request.method, ciphertext: request.method === 'eth_decrypt' ? request.ciphertext : null }
          : {
              kind: 'message' as const,
              smartAccount: account.type === 'SmartAccount',
              method: request.method,
              message: personal?.message ?? null,
              typedData:
                request.method === 'personal_sign'
                  ? null
                  : JSON.stringify(request.typedData, null, 2),
              order: order
                ? Object.freeze({
                    ...order,
                    warnings: Object.freeze([...order.warnings]),
                  })
                : null,
            }),
      }),
      timer: setTimeout(() => {
        void this.retireRequest(message);
      }, Math.max(0, expiresAt - Date.now())),
    };
    let handoffAdopted = false;
    try {
      message.handoff = this.captureSigningHandoff(message, scope, saved ?? null);
      if (saved) {
        const waiting = [...this.requests]; this.requests.clear(); this.requests.set(id, message);
        for (const [key, value] of waiting) this.requests.set(key, value);
      } else this.requests.set(id, message);
      message.approval = this.captureSigningApproval(message);
      message.authentication = this.options.bindAuthentication(message.authenticationScope, () => {
        if (this.requests.get(message.id) !== message || !this.requestConnectionCurrent(message)) return failure('REQUEST_EXPIRED');
        message.approval?.assertCurrent();
      });
      if (saved) this.handoffs.discard(saved, false);
      message.approval.assertCurrent();
      handoffAdopted = true;
      this.publish();
      const site = await this.options.checkSite(origin);
      message.approval.assertCurrent();
      if (site.isBlacklisted)
        message.review = Object.freeze({
          ...message.review,
          error: 'BLOCKED_SITE',
        });
      if (isOperationRequest(request)) {
        await this.requestRetirement;
        message.approval.assertCurrent();
        if (
          this.requests.values().next().value === message &&
          Math.min(this.controls.firstOrder, this.sentry.firstOrder, this.psbt.firstOrder, this.handoffs.firstOrder, this.preparations.firstOrder) > message.queueOrder &&
          context.activeAccountId === account.id &&
          !message.review.error
        )
          await this.prepareTransactionReview(message);
        message.busy = false;
        this.publish();
        return;
      }
      if (isEncryptionRequest(request)) {
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
      if (
        handoffAdopted && isOperationRequest(message.request) &&
        this.requestConnectionCurrent(message)
      ) {
        message.prepared = undefined;
        message.unsubscribeSmart?.();
        await message.smart?.dispose();
        message.busy = false;
        message.review = Object.freeze({
          ...message.review,
          error: 'TRANSACTION_UNAVAILABLE',
        });
        this.publish();
        return;
      }
      if (message.handoff) retireNativeSigningHandoff(message.handoff);
      try { if (saved) this.handoffs.discard(saved); }
      finally {
        clearTimeout(message.timer);
        message.approval?.dispose();
        await this.retireRequest(message);
      }
    }
  }
  private async prepareForegroundRequest(): Promise<void> {
    await this.requestRetirement;
    try { await this.handoffs.retired(); } catch { this.unavailable(); return; }
    if (!this.disposed) { void this.controls.prepare(); void this.sentry.prepare(); void this.psbt.prepare(); }
    const message = this.requests.values().next().value;
    if (
      !message ||
      Math.min(this.controls.firstOrder, this.sentry.firstOrder, this.psbt.firstOrder, this.handoffs.firstOrder, this.preparations.firstOrder) < message.queueOrder ||
      message.busy ||
      message.prepared ||
      message.smart ||
      message.review.error ||
      !isOperationRequest(message.request) ||
      this.disposed ||
      this.options.source.getSnapshot().phase !== 'ready' ||
      this.host?.context().activeAccountId !== message.accountId
    )
      return;
    message.busy = true;
    this.publish();
    try {
      await this.prepareTransactionReview(message);
      message.busy = false;
      this.publish();
    } catch {
      if (this.requests.get(message.id) === message) {
        message.busy = false;
        message.review = Object.freeze({
          ...message.review,
          error: 'TRANSACTION_UNAVAILABLE',
        });
        this.publish();
      }
    }
  }
  private async prepareEoaCallsReview(message: PendingSigning) {
    if (message.request.method !== 'wallet_sendCalls' || !message.approval) throw new Error('Invalid calls request');
    if (message.eoa) return;
    const approval = message.approval;
    const request = message.request;
    let advisories: NativeTransactionReview['advisories'] = [];
    let warning = false;
    const operation = createNativeEoaCalls({
      continuation: captureNativeSigningContinuation(message.handoff, () => createNativeEoaCallsContinuation({
        calls: request.calls, origin: message.session.binding.origin, bundleId: request.bundleId, reservationId: request.reservationId,
      })),
      calls: request.calls, origin: message.session.binding.origin,
      bundleId: request.bundleId, reservationId: request.reservationId,
      expiresAt: message.requestExpiresAt, registry: this.host!.calls,
      assertCurrent: approval.assertCurrent,
      onBroadcast: (hash) => { message.broadcastHash = hash; },
      persistStopped: (submissionId, attempt) =>
        this.host!.recordStoppedEoaCalls({
          origin: message.session.binding.origin,
          bundleId: request.bundleId,
          reservationId: request.reservationId,
          submissionId,
          attempt,
        }),
      prepare: async (transaction) => {
        approval.assertCurrent();
        advisories = [];
        warning = false;
        const handoff: NativeSigningHandoff = Object.freeze({ ...message.handoff,
          beforeSignature: () => { completeNativeSigningOwnerStep(message.handoff, false); operation.completeSignature(); } });
        const prepared = await this.host!.prepareTransaction({ accountId: message.accountId,
          networkId: message.networkId, transaction, approval, handoff }, approval.assertCurrent, this.requestAuthentication(message));
        approval.assertCurrent();
        if ('operation' in prepared) { await prepared.operation.dispose(); throw new Error('Expected an EOA review'); }
        const result = await reviewDappAddressAdvisories({
          targets: getBlacklistTargetsForEvmCall({ data: prepared.transaction.data,
            to: prepared.transaction.to ?? undefined, tokenStandard: prepared.approval?.standardVerified
              ? prepared.approval.tokenStandard : undefined }).map(({ address, type, method }) => ({ address, field: method ?? type })),
          checkAddress: this.options.checkAddress, assertCurrent: approval.assertCurrent,
          onWarning: (entry) => {
            advisories = [entry]; warning = true;
            message.review = Object.freeze({ ...message.review, advisories, requiresWarningAcknowledgement: true });
            this.publish();
          },
        });
        approval.assertCurrent();
        advisories = Object.freeze(result.addresses);
        warning = Boolean(result.warning);
        return prepared;
      },
    });
    message.eoa = operation;
    const publish = () => {
      if (this.requests.get(message.id) !== message || message.eoa !== operation) return;
      const snapshot = operation.getSnapshot();
      const prepared = snapshot.prepared;
      message.busy = snapshot.phase === 'preparing' || snapshot.phase === 'submitting';
      message.review = Object.freeze({ ...message.review, kind: 'transaction', method: 'wallet_sendCalls',
        feeComparison: prepared?.feeComparison ?? null,
        feeChoice: message.review.kind === 'transaction' && prepared?.transaction === message.review.transaction
          ? message.review.feeChoice : null,
        transaction: prepared?.transaction ?? null, maximumFeeUnits: prepared?.maximumFeeUnits ?? null,
        maximumTotalUnits: prepared?.maximumTotalUnits ?? null, approval: prepared?.approval ?? null, assetTransfer: prepared?.assetTransfer ?? null,
        symbol: this.host!.context().network.currency, decimals: 18, broadcastHash: message.broadcastHash ?? null,
        expiresAt: message.requestExpiresAt, advisories, requiresWarningAcknowledgement: warning,
        batch: Object.freeze({ phase: snapshot.phase, index: snapshot.index,
          calls: Object.freeze(request.calls.calls.map((call, index) => Object.freeze({
            to: call.to ?? null, value: call.value, status: snapshot.progress[index]?.status ?? 'pending',
            ...(snapshot.progress[index]?.hash ? { hash: snapshot.progress[index]!.hash } : {}),
          }))),
        }),
      });
      this.publish();
    };
    message.unsubscribeEoa = operation.subscribe(publish);
    await operation.start();
    approval.assertCurrent();
    publish();
  }
  private async prepareTransactionReview(message: PendingSigning) {
    if (
      !isOperationRequest(message.request) ||
      message.review.kind === 'message'
    )
      throw new Error('Invalid transaction request');
    const approval = message.approval;
    if (!approval) throw new Error('Missing request approval');
    approval.assertCurrent();
    if (message.request.method === 'wallet_sendCalls' &&
      this.host!.context().accounts.find((account) => account.id === message.accountId)?.type !== 'SmartAccount') {
      await this.prepareEoaCallsReview(message);
      return;
    }
    message.unsubscribeSmart?.();
    await message.smart?.dispose();
    approval.assertCurrent();
    message.smart = undefined;
    message.unsubscribeSmart = undefined;
    const prepared =
      isModuleRequest(message.request)
        ? await this.host!.prepareModuleChange({
            accountId: message.accountId,
            networkId: message.networkId,
            request: message.request,
            approval,
            handoff: message.handoff,
          }, approval.assertCurrent, this.requestAuthentication(message))
        : message.request.method === 'wallet_sendCalls'
        ? await this.host!.prepareCalls(
            {
              accountId: message.accountId,
              networkId: message.networkId,
              calls: message.request.calls,
              origin: message.session.binding.origin,
              bundleId: message.request.bundleId,
              reservationId: message.request.reservationId,
              approval,
              handoff: message.handoff,
            },
            approval.assertCurrent, this.requestAuthentication(message)
          )
        : await this.host!.prepareTransaction(
            {
              accountId: message.accountId,
              networkId: message.networkId,
              transaction: message.request.transaction,
              approval,
              handoff: message.handoff,
            },
            approval.assertCurrent, this.requestAuthentication(message)
          );
    try {
      approval.assertCurrent();
    } catch (error) {
      if ('operation' in prepared) await prepared.operation.dispose();
      throw error;
    }
    if ('operation' in prepared) {
      const operation = prepared.operation;
      message.smart = operation;
      message.prepared = undefined;
      let reviewReady = false;
      const publishOperation = () => {
        if (
          !reviewReady ||
          this.requests.get(message.id) !== message ||
          message.smart !== operation
        )
          return;
        const snapshot = operation.getSnapshot();
        if (snapshot.transactionHash)
          message.broadcastHash = snapshot.transactionHash;
        message.review = Object.freeze({
          ...message.review,
          kind: 'smart-transaction',
          method: message.request.method as
            | 'eth_sendTransaction'
            | 'wallet_sendCalls'
            | SmartAccountModuleRequest['method'],
          operation: snapshot,
          batchApprovals: prepared.batchApprovals,
          approval: prepared.approval,
          assetTransfer: prepared.assetTransfer,
          batchAssetTransfers: prepared.batchAssetTransfers,
        });
        this.publish();
      };
      message.unsubscribeSmart = operation.subscribe(publishOperation);
      await operation.prepare();
      approval.assertCurrent();
      if (operation.getSnapshot().phase !== 'authorize')
        throw new Error('Smart operation unavailable');
      const preparedScope = this.signingResumeScope(message.wire.session.binding, 'selected');
      if (!preparedScope) throw new Error('Smart operation context changed');
      this.handoffs.bindPreparedScope(message.handoff, preparedScope);
      if (isModuleRequest(message.request)) {
        const intent = operation.getSnapshot().intent;
        if (intent.kind !== 'modules' || intent.command.draft.kind !== (message.request.action === 'install' ? 'install-custom' : 'uninstall')) throw new Error('Module review changed');
        reviewReady = true; publishOperation();
        return;
      }
      const transactions =
        message.request.method === 'wallet_sendCalls'
          ? message.request.calls.calls
          : [message.request.transaction];
      const advisories = await reviewDappAddressAdvisories({
        targets: transactions.flatMap((transaction, index) => {
          const summary =
            message.request.method === 'wallet_sendCalls'
              ? prepared.batchApprovals?.[index]
              : prepared.approval;
          return getBlacklistTargetsForEvmCall({
            data: transaction.data ?? '0x',
            to: transaction.to,
            tokenStandard: summary?.standardVerified
              ? summary.tokenStandard
              : undefined,
          }).map(({ address, type, method }) => ({
            address,
            field:
              transactions.length > 1
                ? `Call ${index + 1}: ${method ?? type}`
                : method ?? type,
          }));
        }),
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
      message.review = Object.freeze({
        ...message.review,
        advisories: Object.freeze(advisories.addresses),
        requiresWarningAcknowledgement: Boolean(advisories.warning),
      });
      reviewReady = true; publishOperation();
      return;
    }
    const remaining =
      prepared.expiresAtMonotonicMilliseconds - Math.floor(performance.now());
    if (remaining <= 0) throw new Error('Transaction fee review expired');
    const advisories = await reviewDappAddressAdvisories({
      targets: getBlacklistTargetsForEvmCall({
        data: prepared.transaction.data,
        to: prepared.transaction.to ?? undefined,
        tokenStandard: prepared.approval?.standardVerified
          ? prepared.approval.tokenStandard
          : undefined,
      }).map(({ address, type, method }) => ({
        address,
        field: method ?? type,
      })),
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
    if (
      prepared.expiresAtMonotonicMilliseconds <= Math.floor(performance.now())
    )
      throw new Error('Transaction fee review expired');
    const expiresAt = Math.min(
      message.requestExpiresAt,
      Date.now() +
        Math.max(
          0,
          prepared.expiresAtMonotonicMilliseconds -
            Math.floor(performance.now())
        )
    );
    message.prepared = prepared;
    message.review = Object.freeze({
      ...message.review,
      transaction: prepared.transaction,
      feeComparison: prepared.feeComparison,
      feeChoice: null,
      maximumFeeUnits: prepared.maximumFeeUnits,
      maximumTotalUnits: prepared.maximumTotalUnits,
      approval: prepared.approval,
      ...("assetTransfer" in prepared ? { assetTransfer: prepared.assetTransfer } : {}),
      expiresAt,
      advisories: Object.freeze(advisories.addresses),
      requiresWarningAcknowledgement: Boolean(advisories.warning),
    });
    clearTimeout(message.timer);
    message.timer = setTimeout(() => {
      void this.retireRequest(message);
    }, Math.max(0, expiresAt - Date.now()));
  }
  private async chooseTransactionFee(
    id: string,
    revision: number,
    choice: EvmDappFeeChoice
  ) {
    const message = this.requests.get(id);
    if (choice !== 'dapp' && choice !== 'network')
      return failure('UNSUPPORTED_REQUEST');
    if (
      !message ||
      revision !== this.revision ||
      (this.requests.values().next().value !== message || Math.min(this.controls.firstOrder, this.sentry.firstOrder, this.psbt.firstOrder, this.handoffs.firstOrder, this.preparations.firstOrder) < message.queueOrder) ||
      message.review.kind !== 'transaction' ||
      message.dispatched ||
      (message.broadcastHash && !message.eoa)
    )
      return failure('REQUEST_EXPIRED');
    if (message.busy || this.action) return failure('BUSY');
    if (
      message.review.error ||
      this.host!.context().activeAccountId !== message.accountId ||
      !isTransactionRequest(message.request)
    )
      return failure('UNSUPPORTED_REQUEST');
    const prepared = message.eoa?.getSnapshot().prepared ?? message.prepared;
    const approval = message.approval;
    if (
      !prepared ||
      !approval ||
      !message.review.transaction ||
      prepared.transaction !== message.review.transaction ||
      prepared.expiresAtMonotonicMilliseconds <= performance.now()
    )
      return failure('REQUEST_EXPIRED');
    approval.assertCurrent();
    const fields = selectEvmDappFeeChoice(
      prepared.transaction,
      prepared.feeComparison,
      choice
    );
    message.busy = true;
    this.publish();
    try {
      if (message.eoa) {
        const state = message.eoa.getSnapshot();
        await message.eoa.requote(state.revision, fields);
      } else {
        if (message.request.method !== 'eth_sendTransaction')
          return failure('UNSUPPORTED_REQUEST');
        const transaction: ReturnType<typeof normalizeDappTransaction> = {
          ...message.request.transaction,
          ...fields,
        };
        delete transaction.gas;
        message.prepared = undefined;
        message.request = { ...message.request, transaction };
        await this.prepareTransactionReview(message);
      }
      approval.assertCurrent();
      if (message.review.kind === 'transaction') {
        const updated = message.eoa?.getSnapshot().prepared ?? message.prepared;
        const honored = updated &&
          evmDappFeeChoiceMatches(updated.transaction, fields);
        message.review = Object.freeze({
          ...message.review,
          feeChoice: honored ? choice : null,
        });
      }
      message.busy = false;
      this.publish();
    } catch (error) {
      if (this.requestConnectionCurrent(message)) {
        message.busy = false;
        if (!message.eoa)
          message.review = Object.freeze({
            ...message.review,
            error: 'TRANSACTION_UNAVAILABLE',
          });
        this.publish();
      } else await this.retireRequest(message);
      throw error;
    }
  }
  private async editApprovalAmount(
    id: string,
    revision: number,
    amount: string
  ) {
    const message = this.requests.get(id);
    if (
      !message ||
      revision !== this.revision ||
      (this.requests.values().next().value !== message || Math.min(this.controls.firstOrder, this.sentry.firstOrder, this.psbt.firstOrder, this.handoffs.firstOrder, this.preparations.firstOrder) < message.queueOrder) ||
      message.request.method !== 'eth_sendTransaction' ||
      message.review.kind === 'message' ||
      message.dispatched ||
      message.broadcastHash
    )
      return failure('REQUEST_EXPIRED');
    if (message.busy || this.action) return failure('BUSY');
    if (message.smart && message.smart.getSnapshot().phase !== 'authorize')
      return failure('UNSUPPORTED_REQUEST');
    const summary =
      message.review.kind === 'smart-transaction'
        ? message.review.approval
        : message.prepared?.approval;
    if (
      !summary?.canEditAmount ||
      !summary.token ||
      summary.amountUnits === undefined ||
      message.review.error
    )
      return failure('UNSUPPORTED_REQUEST');
    const effective = getEffectiveApprovalData({
      tokenStandard: summary.tokenStandard,
      approvalType: summary.approvalType,
      customAmount: amount,
      data: message.request.transaction.data,
      decimals: summary.token.decimals,
      decodedTx: {
        method: summary.method,
        inputs: [summary.authority, summary.amountUnits],
        names: ['spender', 'amount'],
        types: ['address', 'uint256'],
      },
      isCustom: true,
    });
    if (!effective) return failure('UNSUPPORTED_REQUEST');
    message.approval?.assertCurrent();
    message.prepared = undefined;
    message.busy = true;
    message.request = {
      ...message.request,
      transaction: { ...message.request.transaction, data: effective.data },
    };
    this.publish();
    try {
      await this.prepareTransactionReview(message);
      message.busy = false;
      this.publish();
    } catch (error) {
      if (this.requestConnectionCurrent(message)) {
        message.busy = false;
        message.review = Object.freeze({
          ...message.review,
          error: 'TRANSACTION_UNAVAILABLE',
        });
        this.publish();
      } else await this.retireRequest(message);
      throw error;
    }
  }
  private encryptionApproval(message: PendingSigning) {
    if (!isEncryptionRequest(message.request) || !message.approval) return failure('UNSUPPORTED_REQUEST');
    if (!message.encryption) {
      const approval = message.approval;
      message.encryption = prepareDappEncryptionApproval({
        account: { type: this.host!.context().accounts.find(account => account.id === message.accountId)?.type },
        request: message.request as DappEncryptionRequest,
        approval,
        sdk: this.host!.encryptionSdk({ accountId: message.accountId, networkId: message.networkId, approval }, this.requestAuthentication(message)),
        assertCurrent: () => { approval.assertCurrent(); if (!this.requestConnectionCurrent(message) || this.host!.context().activeAccountId !== message.accountId) failure('CONTEXT_CHANGED'); },
        checkDocument: async () => { approval.assertCurrent(); },
        deliver: async (result, assertCurrent, onDispatch) => {
          await this.transport!.respond(message.session.binding, message.wire.id, { result }, assertCurrent, () => {
            onDispatch();
            message.dispatched = true;
          });
        },
      });
    }
    return message.encryption;
  }
  private async previewEncryption(id: string, revision: number): Promise<string> {
    const message = this.requests.get(id);
    if (!message || revision !== this.revision || this.requests.values().next().value !== message ||
      Math.min(this.controls.firstOrder, this.sentry.firstOrder, this.psbt.firstOrder, this.handoffs.firstOrder, this.preparations.firstOrder) < message.queueOrder ||
      message.review.error || message.dispatched || this.host!.context().activeAccountId !== message.accountId) return failure('REQUEST_EXPIRED');
    if (message.busy || this.action) return failure('BUSY');
    message.busy = true;
    this.publish();
    try { return await this.encryptionApproval(message).preview(); }
    finally { if (this.requests.get(id) === message) { message.busy = false; this.publish(); } }
  }
  private approveRequest(id: string, revision: number, acknowledgeWarning: boolean): Promise<void> {
    const message = this.requests.get(id);
    const work = this.performApproveRequest(id, revision, acknowledgeWarning);
    if (message) message.work = work;
    return work;
  }
  private moduleResult(message: PendingSigning) {
    if (!isModuleRequest(message.request)) throw new Error('Invalid module response');
    const snapshot = message.smart?.getSnapshot();
    if (!snapshot || snapshot.phase !== 'complete' || !snapshot.transactionHash || snapshot.intent.kind !== 'modules' ||
        snapshot.intent.command.draft.kind !== (message.request.action === 'install' ? 'install-custom' : 'uninstall')) throw new Error('Module operation ended');
    if (snapshot.metadataRefresh !== 'complete') return null;
    return { action: message.request.action, address: snapshot.intent.command.targetAddress, success: true };
  }
  private async deliverSigningResult(message: PendingSigning, result: unknown): Promise<void> {
    const approval = message.approval;
    if (!approval) return failure('REQUEST_EXPIRED');
    approval.assertCurrent();
    message.resultReady = true;
    await this.transport!.respond(message.session.binding, message.wire.id, { result }, approval.assertCurrent, () => {
      message.dispatched = true;
      queueMicrotask(() => { if (this.requests.get(message.id) === message) this.publish(); });
    });
    await this.retireRequest(message, false);
  }
  private retrySmartMetadata(id: string, revision: number): Promise<void> {
    const message = this.requests.get(id);
    const work = this.performRetrySmartMetadata(id, revision);
    if (message) message.work = work;
    return work;
  }
  private async performRetrySmartMetadata(id: string, revision: number): Promise<void> {
    const message = this.requests.get(id);
    if (!message || revision !== this.revision || this.requests.values().next().value !== message ||
        Math.min(this.controls.firstOrder, this.sentry.firstOrder, this.psbt.firstOrder, this.handoffs.firstOrder, this.preparations.firstOrder) < message.queueOrder ||
        !isModuleRequest(message.request) || message.dispatched || message.resultReady || message.review.error ||
        this.host!.context().activeAccountId !== message.accountId || !message.smart || message.smart.getSnapshot().phase !== 'complete')
      return failure('REQUEST_EXPIRED');
    if (message.busy || this.action) return failure('BUSY');
    const approval = message.approval;
    if (!approval) return failure('REQUEST_EXPIRED');
    approval.assertCurrent();
    message.busy = true;
    this.publish();
    try {
      await message.smart.retryMetadata();
      approval.assertCurrent();
      const result = this.moduleResult(message);
      if (result) await this.deliverSigningResult(message, result);
      else { message.busy = false; this.publish(); }
    } catch (error) {
      if (this.requests.get(id) === message) {
        message.busy = false;
        message.review = Object.freeze({ ...message.review, error: 'DELIVERY_UNCERTAIN' });
        approval.dispose();
        this.publish();
      }
      throw error;
    }
  }
  private async performApproveRequest(
    id: string,
    revision: number,
    acknowledgeWarning: boolean
  ) {
    const message = this.requests.get(id);
    if (
      !message ||
      revision !== this.revision ||
      (this.requests.values().next().value !== message || Math.min(this.controls.firstOrder, this.sentry.firstOrder, this.psbt.firstOrder, this.handoffs.firstOrder, this.preparations.firstOrder) < message.queueOrder)
    )
      return failure('REQUEST_EXPIRED');
    if (message.dispatched) return failure('REQUEST_EXPIRED');
    if (message.busy || this.action) return failure('BUSY');
    if (
      typeof acknowledgeWarning !== 'boolean' ||
      message.review.error ||
      (message.review.requiresWarningAcknowledgement && !acknowledgeWarning &&
        !(message.review.kind === 'transaction' && message.review.batch?.phase === 'failed')) ||
      (isModuleRequest(message.request) && message.request.action === 'install' && !acknowledgeWarning) ||
      this.host!.context().activeAccountId !== message.accountId
    )
      return failure('UNSUPPORTED_REQUEST');
    if (isModuleRequest(message.request) && message.smart?.getSnapshot().phase !== 'authorize') return failure('REQUEST_EXPIRED');
    const approval = message.approval;
    if (!approval) return failure('REQUEST_EXPIRED');
    approval.assertCurrent();
    message.busy = true;
    this.publish();
    try {
      let result: unknown;
      if (isEncryptionRequest(message.request)) {
        await this.encryptionApproval(message).approve();
        await this.retireRequest(message, false);
        return;
      }
      if (isOperationRequest(message.request)) {
        if (message.eoa) {
          const state = message.eoa.getSnapshot();
          if (state.phase === 'failed') await message.eoa.start();
          else await message.eoa.approve(state.revision);
          approval.assertCurrent();
          const next = message.eoa.getSnapshot();
          if (next.phase !== 'complete' && next.phase !== 'unknown') {
            message.busy = false;
            this.publish();
            return;
          }
          if (message.request.method !== 'wallet_sendCalls') throw new Error('Invalid calls response');
          result = { id: message.request.bundleId, capabilities: {} };
        } else if (message.smart) {
          if (isModuleRequest(message.request)) {
            const snapshot = message.smart.getSnapshot();
            if (snapshot.phase !== 'authorize' || snapshot.intent.kind !== 'modules') return failure('REQUEST_EXPIRED');
            const kind = snapshot.intent.command.draft.kind;
            if (kind === 'install-custom') await message.smart.authorizeModuleChange(snapshot.revision, { kind, riskAcknowledged: true });
            else await message.smart.authorizeModuleChange(snapshot.revision, { kind });
          } else await message.smart.authorize(message.smart.getSnapshot().revision);
          approval.assertCurrent();
          const snapshot = message.smart.getSnapshot();
          if (snapshot.phase === 'authorize') {
            message.busy = false;
            this.publish();
            return;
          }
          if (snapshot.phase !== 'complete' || !snapshot.transactionHash)
            throw new Error('Smart operation ended');
          if (isModuleRequest(message.request)) {
            const confirmed = this.moduleResult(message);
            if (!confirmed) { message.busy = false; this.publish(); return; }
            result = confirmed;
          } else
          result =
            message.request.method === 'wallet_sendCalls'
              ? { id: message.request.bundleId, capabilities: {} }
              : snapshot.transactionHash;
        } else {
          if (!message.prepared) return failure('REQUEST_EXPIRED');
          result = await message.prepared.submit(
            approval.assertCurrent,
            (hash) => {
              message.broadcastHash = hash;
              if (message.review.kind === 'transaction')
                message.review = Object.freeze({
                  ...message.review,
                  broadcastHash: hash,
                });
              this.publish();
            }, { kind: 'transaction' }
          );
        }
      } else {
        result = await this.host!.signMessage({
          accountId: message.accountId,
          networkId: message.networkId,
          request: message.request,
          approval,
          handoff: message.handoff,
        }, this.requestAuthentication(message));
      }
      await this.deliverSigningResult(message, result);
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
      if (isEncryptionRequest(message.request) && this.requestConnectionCurrent(message) && approval.isCurrent()) {
        message.busy = false;
        this.publish();
      } else await this.retireRequest(message);
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
      (this.requests.values().next().value !== message || Math.min(this.controls.firstOrder, this.sentry.firstOrder, this.psbt.firstOrder, this.handoffs.firstOrder, this.preparations.firstOrder) < message.queueOrder)
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
      await this.options.activateAccount(
        message.accountId,
        expectedRevision,
        guard
      );
      guard();
      message.approval = this.captureSigningApproval(message);
      message.switching = false;
      message.switchRevision = undefined;
      // No signer exists before this explicit switch's new approval. Capture
      // its initial handoff now, without changing the original request bound.
      if (message.smart || message.prepared || message.eoa || message.dispatched || message.broadcastHash || message.resultReady || message.handoff.isSuspended()) return failure('REQUEST_EXPIRED');
      const scope = this.signingResumeScope(message.wire.session.binding, 'selected');
      if (!scope) return failure('REQUEST_EXPIRED');
      message.handoff = this.captureSigningHandoff(message, scope, null);
      if (isOperationRequest(message.request))
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
    this.clearPairingDeadline();
    if (pairing) {
      this.canceledPairings.set(pairing.topic, pairing);
      for (const [id, proposal] of this.proposals)
        if (proposal.pairingTopic === pairing.topic) { this.proposals.delete(id); this.clearProposalDeadline(id); }
      void pairing.cancel().catch(() => {
        this.error = 'CONNECTION_UNAVAILABLE';
        this.publish();
      });
    }
    if (this.status !== 'unavailable') this.status = 'ready';
    this.publish();
  }
  async dispose(): Promise<void> {
    return this.disposal.close(() => {
      this.dismissStatus();
      this.disposed = true;
      this.clearDeadlines(); this.canceledPairings.clear();
      for (const read of this.reads.values()) read.lifetime.abort();
      this.controls.clear(); this.sentry.clear(); this.psbt.clear(); this.preparations.clear(); this.handoffs.cancelDapp();
      for (const message of [...this.requests.values()])
        void this.retireRequest(message, false);
      this.transportOwner = undefined;
      this.lifetime.abort();
      this.action?.abort();
      this.unsubscribe();
      this.publish();
    }, [async () => {
      await Promise.all([this.controls.dispose(), this.sentry.dispose(), this.psbt.dispose(), this.preparations.dispose(), this.handoffs.retired()]);
      await this.requestRetirement;
      await this.opening?.catch(() => undefined);
      await this.openingTransport?.catch(() => undefined);
      try {
        await this.transportRetirement;
        await this.transport?.close();
      } finally {
        this.connections.clear();
        this.proposals.clear();
      }
    }]);
  }
}
