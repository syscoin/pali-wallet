import type { NativeSmartCreationAllocation } from '../src/smartAccount/preparation.ts';
import { getSmartAccountModulesProjection } from '../../../source/shared/smartAccountModules.ts';
import { SMART_ACCOUNT_MODULE_REQUEST_METHODS, type SmartAccountModuleRequest } from '../../../source/shared/smartAccountModuleRequest.ts';
import { buildNativeSmartModuleCommand } from '../src/smartAccount/modules.ts';
import { freshSmartOperationDeadline } from './nonSuiteSigningHandoff.ts';
import type { NativeSigningHandoff } from '../src/connections/signingHandoff.ts';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import { dappCaipChain, DAPP_MODE_METHODS } from '../../../source/shared/dappChainScope.ts';
import { DAPP_SYSCOIN_READ_METHODS } from '../../../source/shared/dappSyscoinReads.ts';
import { SENTRY_DAPP_METHODS, type NativeSentryDetails, type NativeSentryAssent } from '../src/connections/sentryRequests.ts';
import { PSBT_DAPP_METHODS } from '../src/connections/psbtRequests.ts';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { UTXO_ADDRESSES, XPUB } from './publicWatchFixtures.ts';
import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import { DAPP_PUBLIC_RPC_METHODS } from '../../../source/shared/dappRpcReads.ts';
import { EthereumRpcErrorHandler } from '../../../source/helpers/errors/errorClassesHandlers.ts';
import type { EvmDappFeeComparison } from '../../../source/shared/evmDappFeePolicy.ts';
import { createSmartAccountCallsExecutions } from '../../../source/shared/dappCalls.ts';
import { NativeSmartAccountOperation } from '../src/smartAccount/operation.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { NativeConnectionsController } from '../src/connections/controller.ts';
import type { NativeConnectionHost } from '../src/connections/host.ts';
import type {
  WalletConnectTransportEvent,
  WalletConnectRequest,
  WalletConnectSession,
  WalletConnectProposal,
  WalletConnectVerification,
} from '../src/connections/walletConnect.ts';
import { openWalletConnectTransport } from '../src/connections/walletConnect.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';
import type { INetwork, KeyringAccountType } from '../../../source/types/network.ts';
import { openNativeConnectionRepository } from '../src/connections/storage.ts';
import { captureEvmFeeApproval } from '../../../source/shared/evmFeeApproval.ts';
import type { NativeSigningReview } from '../src/connections/types.ts';
import { snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { Interface } from 'ethers/abi';
import { summarizeApproval, type ApprovalContractMetadata } from '../../../source/shared/approval.ts';
const ROTATED_SYSCOIN_ADDRESS = parseUtxoPublicIdentifier(XPUB, 'syscoin').address;
const externalPsbt = new syscoinUtils.bitcoinjs.Psbt();
externalPsbt.addInput({ hash: 'ab'.repeat(32), index: 0 });
externalPsbt.addOutput({ script: Buffer.from('51', 'hex'), value: BigInt(900) });
const EXTERNAL_PSBT = PsbtUtils.toPali(externalPsbt);

const messageText = (review: NativeSigningReview | null) => {
  assert.ok(review?.kind === 'message');
  return review.message;
};

const TOPIC = 'a1'.repeat(32),
  PEER = 'b2'.repeat(32),
  PAIRING = 'c3'.repeat(32);
const UNKNOWN = Object.freeze({
  validation: 'UNKNOWN' as const,
  isScam: false,
});
const ADDRESS = '0x' + '11'.repeat(20),
  ORIGIN = 'https://reported.example';
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(
  options: {
    utxo?: boolean;
    hardware?: 'Ledger' | 'Trezor';
    capabilities?: boolean;
    moduleInventory?: boolean;
    moduleChanges?: boolean;
    smartCreation?: boolean;
    feeComparison?: EvmDappFeeComparison;
    minimumGasLimit?: string;
    batch?: boolean;
    smart?: boolean;
    imported?: boolean;
    smartMessages?: boolean;
    smartTrezor?: boolean;
    secondAccount?: boolean;
    restoring?: boolean;
    openFailures?: number;
    inventoryFailures?: number;
    loadSdk?: Parameters<typeof openWalletConnectTransport>[0]['loadSdk'];
    checkSite?: ConstructorParameters<typeof NativeConnectionsController>[0]['checkSite'];
  } = {}
) {
  const { secondAccount = false, smart = false, smartMessages = false } = options;
  const firstAccountType = options.hardware ?? (smart ? 'SmartAccount' : options.imported ? 'Imported' : 'HDAccount');
  const utxoAccountType = options.hardware ?? 'HDAccount';
  const utxoAccountId = options.hardware ? `${options.hardware.toLowerCase()}:57:0` : 'hd:57:0';
  const firstAccountId = options.hardware ? `${options.hardware.toLowerCase()}:60:0` : smart ? 'smart:60:0' : options.imported ? 'imported:60:0' : 'hd:60:0';
  let snapshot: CustodySnapshot = {
    phase: 'ready',
    revision: 1,
    presence: 'existing',
    backup: 'confirmed',
    account: { network: 'ethereum', address: ADDRESS },
    error: null,
  };
  const listeners = new Set<() => void>();
  const rows = new Map<string, unknown>();
  const signatures: unknown[] = [];
  const transactions: unknown[] = [];
  const controlCommits: unknown[] = [], externalUrls: string[] = [];
  let controlWait: Promise<void> = Promise.resolve();
  let controlFailure: Error | undefined;
  let afterControlCommit: (() => void) | undefined;
  let sentryWait: Promise<void> = Promise.resolve();
  let receivingAddress: string = UTXO_ADDRESSES.syscoin;
  const sentryRequests: unknown[] = [], sentryAssents: NativeSentryAssent[] = [];
  const psbtRequests: unknown[] = [], psbtApprovals: unknown[] = [];
  let signingHandoff: NativeSigningHandoff | undefined;
  let smartSigningBinding: string | undefined;
  let registrationSuffix = '';
  let psbtWait = Promise.resolve(), psbtSignWait = Promise.resolve(), psbtDisposals = 0;
  let psbtHandoff: NativeSigningHandoff | undefined, pendingOverride: 'missing' | 'method' | 'fresh' | null = null, pendingReads = 0;
  const wireAdmissions = new Map<number, WalletConnectRequest>(), canceledPsbtJobs: object[] = [];
  let readWait: Promise<void> = Promise.resolve();
  let readError: Error | undefined;
  const readRequests: unknown[] = [];
  const moduleInventoryReads: { accountId: string; networkId: string }[] = [];
  const moduleChangeRequests: SmartAccountModuleRequest[] = [];
  let creationAllocation: NativeSmartCreationAllocation | undefined;
  const creationRequests: unknown[] = [], preparedAccountUpdates: string[] = [];
  const creationGrantPublications: number[] = [];
  let creationUpdateFailure = false;
  let beforeCreationGrant = () => {};
  let moduleMetadataUnavailable = false, moduleMetadataReads = 0;
  let moduleMetadataWait = Promise.resolve();
  let signWait: Promise<void> = Promise.resolve();
  let storageWait: Promise<void> = Promise.resolve();
  let permissionPublished: ((hasGrant: boolean) => void) | undefined;
  let permissionSettlement: (() => Promise<void>) | undefined;
  let preparationError: Error | undefined;
  let beforePreparedReturn: (() => void) | undefined;
  let smartDisposals = 0;
  let preparationWait: Promise<void> = Promise.resolve();
  let approvalMetadata: ApprovalContractMetadata | undefined;
  const preparedTransactions: Record<string, unknown>[] = [];
  let activationWait: Promise<void> = Promise.resolve();
  let siteBlocked = false;
  let siteWait: Promise<void> = Promise.resolve();
  let blacklistedAddress = false;
  let selectedAccountId = options.utxo ? utxoAccountId : firstAccountId;
  const responses: unknown[] = [],
    emissions: unknown[] = [],
    emissionScopes: string[] = [],
    cancelledTopics: string[] = [];
  let event!: (event: WalletConnectTransportEvent) => void;
  let closed = 0,
    pairCanceled = 0,
    opened = 0,
    approved = 0;
  let openWait: Promise<void> = Promise.resolve();
  let approveWait: Promise<void> = Promise.resolve();
  let responseWait: Promise<void> = Promise.resolve();
  let responseFailure: Error | undefined;
  let dispatchWait: Promise<void> = Promise.resolve();
  let dispatchFailure: Error | undefined;
  let callsStatusError: Error | undefined;
  let callsStatusWait: Promise<void> = Promise.resolve();
  const callsStatusReads: { origin: string; id: string }[] = [];
  const callsRecoveries: { origin: string; id: string }[] = [];
  const callsStatusChains: number[] = [];
  const callsStatusReceipts = new Map<number, ReadonlyMap<string, unknown>>();
  const handedOff: unknown[] = [];
  const remoteDisconnects: unknown[] = [];
  let emissionWait: Promise<void> = Promise.resolve();
  let pairWait: Promise<void> = Promise.resolve();
  let disconnectWait: Promise<void> = Promise.resolve();
  let rejectFailure: Error | undefined;
  let pairFailure: { error: Error; beforeHandle: boolean } | undefined;
  let selectedChainId = 1;
  let selectedUtxo = options.utxo ?? false, defaultEvmAccountId = firstAccountId;
  let pairingExpiry = Date.now() + 300000;
  let openFailures = options.openFailures ?? 0;
  let inventoryFailures = options.inventoryFailures ?? 0;
  let closeWait: Promise<void> = Promise.resolve();
  let closeFailure: Error | undefined;
  const transportEvents: ((event: WalletConnectTransportEvent) => void)[] = [];
  const network = {
    kind: 'ethereum',
    chainId: 1,
    slip44: 60,
    currency: 'eth',
    label: 'Ethereum',
    url: 'https://rpc.invalid',
  } as const;
  const storage: KeyringStoragePort = {
    get: async (key) => structuredClone(rows.get(key)),
    set: async (key, value) => {
      rows.set(key, value);
    },
    deleteItem: async (key) => {
      rows.delete(key);
    },
    createManyIfAbsent: async (values, guard) => {
      guard?.();
      if (Object.keys(values).some((key) => rows.has(key))) return false;
      for (const [key, value] of Object.entries(values))
        rows.set(key, structuredClone(value));
      return true;
    },
    compareAndSet: async (key, expected, value, _remove, guard) => {
      await storageWait;
      guard?.();
      if (JSON.stringify(rows.get(key)) !== JSON.stringify(expected))
        return false;
      rows.set(key, structuredClone(value));
      return true;
    },
    compareAndSetMany: async (changes, guard) => {
      guard();
      if (
        changes.some(
          ({ key, expected }) =>
            JSON.stringify(rows.get(key)) !== JSON.stringify(expected)
        )
      )
        return false;
      for (const { key, value } of changes) {
        if (value === undefined) rows.delete(key);
        else rows.set(key, structuredClone(value));
      }
      return true;
    },
  };
  const host: Omit<NativeConnectionHost, 'repository' | 'calls'> = {
    async allocateSmartAccount(input, signal, check, onCommitted) {
      assert(options.smartCreation, 'Creation is outside this fixture'); check();
      assert.equal(creationAllocation, undefined, 'An allocated account cannot be replaced');
      assert.equal(input.target.id, 'ecdsa'); creationRequests.push(input);
      const account = Object.freeze({ id: 'smart:60:7', index: 7, type: 'SmartAccount' as const,
        address: '0x' + '77'.repeat(20), xpub: 'new-smart-public-address', label: input.label });
      const allocation = Object.freeze({ account, networkId: input.networkId, chainId: selectedChainId, target: input.target,
        assertCurrent() { assert(!signal.aborted && snapshot.phase === 'ready' && selectedAccountId === account.id && selectedChainId === allocation.chainId); } });
      onCommitted(allocation);
      creationAllocation = allocation; selectedAccountId = account.id;
      snapshot = { ...snapshot, revision: snapshot.revision + 1, account: { network: 'ethereum', address: account.address } };
      for (const listener of listeners) listener();
      allocation.assertCurrent(); return allocation;
    },
    async prepareSmartAccountCreationOperation() { throw Error('Configured creation operations are outside this controller fixture'); },
    signingContext: (accountId) => ({ trezor: options.hardware === 'Trezor' || options.smartTrezor === true, binding: smart ? smartSigningBinding ?? accountId : accountId }),
    registration: () => createNativeNetwork({ id: 'ethereum', name: network.label + registrationSuffix, kind: 'evm', chainId: String(selectedChainId), slip44: 60, rpcUrl: network.url, symbol: network.currency, decimals: 18, testnet: false }),
    async cancelSigningHandoff(job) { canceledPsbtJobs.push(job); },
    syscoin: {
      registration: () => { if (!selectedUtxo || snapshot.phase !== 'ready') throw new Error('CONTEXT_CHANGED'); return getUtxoNetwork('syscoin'); },
      anchor: () => UTXO_ADDRESSES.syscoin,
      async read(request, owner, signal, check) { readRequests.push(request); await readWait; check(); if (signal.aborted) throw new Error('CANCELLED'); return request.method === 'sys_getPublicKey' ? owner.xpub : request.method === 'sys_requestAccounts' ? [owner.address] : 'syscoin-read'; },
    },
    sentry: { revalidate() {}, async prepare(request, signal, check, assertGrant) {
      assertGrant();
      check(); sentryRequests.push(request); await sentryWait; check();
      const node = { proTxHash: 'ab'.repeat(32), service: 'sentry.example:8369', nevmAddress: '', collateralOutpoint: { txid: 'cd'.repeat(32), vout: 0 } };
      const approval = { id: 'private-sentry-approval', network: 'mainnet', origin: request.origin, serviceUrl: 'https://sentry.example', node };
      const details = (request.method === 'sys_linkSentryNode' ? { kind: 'link', approval } : request.method === 'sys_signSentryVote' ? { kind: 'vote', approval: { ...approval, nodes: [], missingVotingKeys: [] } } : { kind: 'operation', approval: { ...approval, keys: [] } }) as NativeSentryDetails;
      return { details, disclose: check, assertCurrent: () => { check(); if (signal.aborted) throw new Error('CANCELLED'); }, async approve(assent, guard) { check(); guard(); sentryAssents.push(assent); return { method: request.method }; }, dispose() {} };
    } },
    psbt: { async cancelHandoff(job) { canceledPsbtJobs.push(job); }, async prepare(request, signal, check, handoff) {
      psbtHandoff = handoff;
      psbtRequests.push(request); await psbtWait;
      let disposed = false;
      const current = () => { check(); if (disposed || signal.aborted) throw Error('CANCELLED'); };
      return { review: { method: request.method, origin: request.origin, feeSatoshis: '100', unsignedHash: 'ab'.repeat(32),
        transactionType: 'bitcoin', transactionOptions: { rbf: false }, complete: false, inputs: [], outputs: [], sentry: null },
        assertCurrent: current, disposition: () => ({ transactionNotBroadcast: true }),
        async approve() { current(); psbtApprovals.push(request); await psbtSignWait; current(); if (options.hardware === 'Trezor') handoff.beforeSignature(); return request.method === 'sys_sign' ? request.psbt : { txid: 'ef'.repeat(32) }; },
        dispose() { disposed = true; psbtDisposals++; } };
    } },
    reads: { async read(request, signal, check) { readRequests.push(request); await readWait; check(); if (signal.aborted) throw new Error('ABORTED'); if (readError) throw readError; return '0x42'; } },
    controls: {
      context: () => snapshot.phase === 'ready' ? ({ revision: snapshot.revision, catalogueRevision: snapshot.revision, activeAccountId: selectedAccountId, networkId: selectedUtxo ? 'syscoin' : 'ethereum', networkLabel: selectedUtxo ? 'Syscoin' : 'Ethereum', accounts: [
        { id: firstAccountId, index: 0, type: firstAccountType, address: ADDRESS, slip44: 60, label: 'Account 1' },
        ...(secondAccount ? [{ id: 'hd:60:1', index: 1, type: 'HDAccount' as const, address: '0x' + '22'.repeat(20), slip44: 60, label: 'Account 2' }] : []),
        { id: utxoAccountId, index: 0, type: utxoAccountType, address: receivingAddress, slip44: 57, label: 'Syscoin account' },
      ] }) : null,
      async prepare(request, _owner, signal, check) {
        const chain = selectedChainId;
        const current = () => { check(); if (signal.aborted || selectedChainId !== chain) throw new Error('CONTROL_CHANGED'); };
        current();
        return {
          details: request.method === 'wallet_watchAsset'
            ? { kind: 'watch-asset', type: request.type, address: request.address, name: 'Observed token', symbol: 'OBS', decimals: 18, ...(request.tokenId ? { tokenId: request.tokenId } : {}) }
            : { kind: request.method === 'wallet_switchEthereumChain' || 'kind' in request ? 'network-switch' : 'network-add', chainId: String(request.chainId), name: 'Observed chain', rpcUrl: 'https://observed.example', symbol: 'ETH' },
          assertCurrent: current,
          async commit(checkRequest, onNetworkCommitted) {
            current(); await controlWait; checkRequest();
            if (controlFailure) throw controlFailure;
            controlCommits.push(request);
            if (request.method === 'wallet_switchEthereumChain' || 'kind' in request) {
              selectedChainId = request.chainId; selectedUtxo = 'kind' in request && request.kind === 'syscoin'; selectedAccountId = selectedUtxo ? utxoAccountId : defaultEvmAccountId;
              snapshot = { ...snapshot, revision: snapshot.revision + 1 };
              for (const listener of listeners) listener();
              onNetworkCommitted();
            }
            afterControlCommit?.();
            return { result: request.method === 'wallet_watchAsset' ? true : null, assertCurrent: checkRequest };
          },
          dispose() {},
        };
      },
    },
    walletBindingId: 'd4'.repeat(32),
    supportsAtomicCalls: () => Boolean(options.smart && options.batch),
    supportsSmartAccountMessages: () => Boolean(options.smart && options.smartMessages),
    readSmartAccountModules(accountId, networkId, check) {
      check(); moduleInventoryReads.push({ accountId, networkId });
      assert.equal(accountId, firstAccountId); assert.equal(networkId, 'ethereum');
      return getSmartAccountModulesProjection({ address: ADDRESS, isSmartAccount: smart,
        smartAccount: { chainId: 1, contractVersion: 'fixture', isDeployed: true, deploymentSalt: '0x00',
          auth: { module: 'ecdsa', validator: '0x' + '33'.repeat(20), data: '0x1234' },
          installedModules: [{ id: 'ecdsa', address: '0x' + '33'.repeat(20), type: 'validator', data: '0x1234', config: { owners: [ADDRESS], threshold: 1 } }] } }, selectedChainId);
    },
    async prepareModuleChange(input, check) {
      signingHandoff = input.handoff;
      check(); await preparationWait; check(); input.approval.assertCurrent();
      assert(options.smart && options.moduleChanges); assert.equal(input.accountId, selectedAccountId);
      moduleChangeRequests.push(input.request);
      const active = '0x' + '33'.repeat(20), target = input.request.module.address ?? '';
      const command = buildNativeSmartModuleCommand({ accountAddress: ADDRESS, metadata: {
        chainId: 1, contractVersion: 'fixture', isDeployed: true, deploymentSalt: '0x00',
        auth: { module: 'ecdsa', validator: active, data: '0x1234' },
        installedModules: [{ id: 'ecdsa', address: active, type: 'validator', data: '0x1234', config: { owners: [ADDRESS], threshold: 1 } },
          ...(input.request.action === 'uninstall' && target !== active ? [{ id: 'custom' as const, address: target, type: 'validator' as const, data: '0x', config: { name: 'Installed module', initData: '0x', moduleType: 1 } }] : [])],
      }, draft: input.request.action === 'install'
        ? { kind: 'install-custom', address: target, name: input.request.module.name ?? 'Public module', initData: input.request.module.initData || '0x' }
        : { kind: 'uninstall', address: target }, isAlgorithmAvailable: module => module.id === 'ecdsa', removalPolicy: 'active-composite', deploymentAdmission: 'constructor-or-deployed' });
      const intent = Object.freeze({ kind: 'modules' as const, command });
      const transaction = snapshotPreparedEvmTransaction({ from: '0x' + '33'.repeat(20), to: '0x' + '44'.repeat(20),
        chainId: '1', value: '0', data: '0x1234', nonce: '9', gasLimit: '50000', type: 2, accessList: [], maxFeePerGas: '10', maxPriorityFeePerGas: '1' });
      const operation = new NativeSmartAccountOperation({ background() {}, authorizationExpiresAt: Math.min(input.handoff.expiresAt, freshSmartOperationDeadline()),
        account: ADDRESS, intent, network: { id: 'ethereum', chainId: '1', rpcUrl: 'https://rpc.example', registrationHash: '0x' + '55'.repeat(32) } as never,
        assertCurrent: () => { check(); input.approval.assertCurrent(); },
        async prepare() { return { kind: 'authorization', intent, operation: { executions: command.executions.map(value => ({ ...value })), actionHash: '0x' + '66'.repeat(32),
          userOperation: { nonce: '7', initCode: '0x', callData: '0x', accountGasLimits: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '01', preVerificationGas: '1', gasFees: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '03' } } as never }; },
        async sign(_prepared, guard) { await signWait; guard(); if (options.smartTrezor) input.handoff.beforeSignature(); signatures.push(intent); return '0x1234'; },
        async submit(_prepared, _signature, _signal, guard, reviewPayer, onBroadcast) {
          await reviewPayer({ transaction, maximumFeeUnits: '500000', coveredFeeUnits: '0', maximumTotalUnits: '500000', purpose: 'submit-operation' }, guard);
          guard(); transactions.push(intent); const hash = '0x' + '34'.repeat(32); onBroadcast(hash, 'submit-operation'); return hash;
        },
        async refreshMetadata(_signal, guard) { moduleMetadataReads++; await moduleMetadataWait; guard(); if (moduleMetadataUnavailable) throw Error('Canonical module state unavailable'); },
      });
      const dispose = operation.dispose.bind(operation);
      operation.dispose = () => { smartDisposals++; return dispose(); };
      beforePreparedReturn?.(); check();
      return { operation, approval: null };
    },
    async prepareCalls(input, check) {
      check(); await preparationWait; check();
      assert(options.batch && options.smart);
      const intent = { kind: 'dapp-batch' as const, calls: input.calls.calls };
      const transaction = snapshotPreparedEvmTransaction({ from: '0x' + '33'.repeat(20), to: '0x' + '44'.repeat(20),
        chainId: '1', value: '0', data: '0x1234', nonce: '0', gasLimit: '50000', type: 2, accessList: [], maxFeePerGas: '10', maxPriorityFeePerGas: '1' });
      const operation = new NativeSmartAccountOperation({ background() {}, authorizationExpiresAt: Math.min(input.handoff.expiresAt,freshSmartOperationDeadline()),
        account: ADDRESS, intent, network: { id: 'ethereum', chainId: '1', rpcUrl: 'https://rpc.example', registrationHash: '0x' + '55'.repeat(32) } as never,
        assertCurrent: () => { check(); input.approval.assertCurrent(); },
        async prepare() { return { kind: 'authorization', intent, operation: { executions: createSmartAccountCallsExecutions(intent.calls), actionHash: '0x' + '66'.repeat(32),
          userOperation: { nonce: '0', initCode: '0x', callData: '0x', accountGasLimits: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '01', preVerificationGas: '1', gasFees: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '03' } } as never }; },
        async sign(_prepared, guard) { await signWait; guard(); signatures.push(intent); return '0x1234'; },
        async submit(_prepared, _signature, _signal, guard, reviewPayer, onBroadcast) {
          await reviewPayer({ transaction, maximumFeeUnits: '500000', coveredFeeUnits: '0', maximumTotalUnits: '500000', purpose: 'submit-operation' }, guard);
          guard(); transactions.push(intent); const hash = '0x' + '34'.repeat(32); onBroadcast(hash, 'submit-operation'); return hash;
        },
      });
      return { operation, approval: null, batchApprovals: intent.calls.map(call => summarizeApproval(call.data, call.to!, approvalMetadata)) };
    },
    async readCallsStatus(origin, id, guard) {
      callsStatusReads.push({ origin, id });
      await callsStatusWait;
      guard();
      if (callsStatusError) throw callsStatusError;
      return (await restoredRepository).calls.resolveCallsStatus({
        assertCurrent: guard,
        forChain(chainId) {
          callsStatusChains.push(chainId);
          const receipts = callsStatusReceipts.get(chainId);
          return receipts
            ? {
                async getTransactionReceipt(hash) {
                  return receipts.get(hash) ?? null;
                },
                async getBlockHash() {
                  return '0x' + 'ab'.repeat(32);
                },
              }
            : null;
        },
      }, origin, id);
    },
    assertOwner() {},
    verifyPersonalMessage() { throw new Error('Public recovery is outside this fixture'); },
    sessionGeneration: () => snapshot.revision,
    encryptionSdk(input) {
      input.approval.assertCurrent();
      assert.equal(input.accountId, selectedAccountId);
      return {
        getEncryptedPubKey() { input.approval.assertCurrent(); signatures.push('encryption-key'); return 'public-encryption-key'; },
        decryptMessage(params) { input.approval.assertCurrent(); signatures.push(params); return '  public plaintext\n'; },
      };
    },
    async signMessage(input) {
      signingHandoff = input.handoff;
      input.approval.assertCurrent();
      assert.equal(input.accountId, selectedAccountId);
      signatures.push(input.request);
      await signWait;
      input.approval.assertCurrent();
      if (options.hardware || options.smartTrezor) input.handoff.beforeSignature();
      return options.smart ? '0x' + '33'.repeat(20) + '12'.repeat(65) : '0x' + '12'.repeat(65);
    },
    async recordStoppedEoaCalls() {},
    async recoverStoppedEoaCalls(origin, id, assertStopped) { assertStopped(); callsRecoveries.push({ origin, id }); },
    async prepareTransaction(input, check) {
      signingHandoff = input.handoff;
      check();
      await preparationWait;
      check();
      if (preparationError) throw preparationError;
      input.approval.assertCurrent();
      assert.equal(input.accountId, selectedAccountId);
      const value = input.transaction as Record<string, unknown>;
      preparedTransactions.push(value);
      if (options.smart) {
        const intent = { kind: 'dapp-call' as const, recipient: String(value.to), amountUnits: BigInt(value.value as string ?? '0').toString(), data: String(value.data ?? '0x') };
        const transaction = snapshotPreparedEvmTransaction({ from: '0x' + '33'.repeat(20), to: '0x' + '44'.repeat(20),
          chainId: '1', value: '0', data: '0x1234', nonce: '0', gasLimit: '50000', type: 2, accessList: [], maxFeePerGas: '10', maxPriorityFeePerGas: '1' });
        const operation = new NativeSmartAccountOperation({ background() {}, authorizationExpiresAt: Math.min(input.handoff.expiresAt,freshSmartOperationDeadline()),
          account: ADDRESS, intent, network: { id: 'ethereum', chainId: '1', rpcUrl: 'https://rpc.example', registrationHash: '0x' + '55'.repeat(32) } as never,
          assertCurrent: () => { check(); input.approval.assertCurrent(); },
          async prepare() { return { kind: 'authorization', intent, operation: {
            executions: [{ target: intent.recipient, data: intent.data, value: intent.amountUnits }],
            actionHash: '0x' + '66'.repeat(32), userOperation: { nonce: String(transactions.length), initCode: '0x', callData: '0x',
              accountGasLimits: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '01', preVerificationGas: '1',
              gasFees: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '03' },
          } as never }; },
          async sign(_prepared, guard) { await signWait; guard(); signatures.push(intent); return '0x1234'; },
          async submit(_prepared, _signature, _signal, guard, reviewPayer, onBroadcast) {
            await reviewPayer({ transaction, maximumFeeUnits: '500000', coveredFeeUnits: '0', maximumTotalUnits: '500000', purpose: 'submit-operation' }, guard);
            guard(); transactions.push(intent); const hash = '0x' + '34'.repeat(32); onBroadcast(hash, 'submit-operation'); return hash;
          },
        });
        const dispose = operation.dispose.bind(operation);
        operation.dispose = () => { smartDisposals++; return dispose(); };
        beforePreparedReturn?.();
        return { operation, approval: summarizeApproval(intent.data, intent.recipient, approvalMetadata) };
      }
      const legacy = value.type === '0x0' || value.type === 0 || value.gasPrice !== undefined;
      const transaction = snapshotPreparedEvmTransaction({
        from: ADDRESS, to: value.to ?? null, chainId: '1', value: BigInt(value.value as string ?? '0').toString(),
        data: String(value.data ?? '0x'), nonce: BigInt(value.nonce as string ?? '0').toString(), gasLimit: (BigInt(value.gasLimit as string ?? '50000') < BigInt(options.minimumGasLimit ?? '0') ? BigInt(options.minimumGasLimit!) : BigInt(value.gasLimit as string ?? '50000')).toString(),
        ...(legacy ? { type: 0, gasPrice: BigInt(value.gasPrice as string ?? '10').toString() }
          : { type: 2, accessList: value.accessList ?? [], maxFeePerGas: BigInt(value.maxFeePerGas as string ?? '10').toString(), maxPriorityFeePerGas: BigInt(value.maxPriorityFeePerGas as string ?? '1').toString() }),
      });
      const fee = captureEvmFeeApproval(transaction, 'fixture', Math.floor(performance.now()) + 60000);
      return {
        transaction,
        feeComparison: options.feeComparison ?? { recommendationOnly: true },
        maximumFeeUnits: fee.maximumFeeUnits,
        coveredFeeUnits: '0',
        maximumTotalUnits: fee.maximumTotalUnits,
        expiresAtMonotonicMilliseconds: fee.expiresAtMonotonicMilliseconds,
        approval: transaction.to ? summarizeApproval(transaction.data, transaction.to, approvalMetadata) : null,
        async submit(guard, onBroadcast, submission) {
          assert.equal(submission.kind, options.batch ? 'eoa-calls' : 'transaction');
          if (options.hardware) { await signWait; guard(); input.handoff.beforeSignature(); }
          guard();
          input.approval.assertCurrent();
          transactions.push(fee.transaction);
          const hash = options.batch ? '0x' + BigInt(transaction.nonce).toString(16).padStart(64, '0') : '0x' + '34'.repeat(32);
          onBroadcast(hash);
          return hash;
        },
      };
    },
    context: () => ({
      network: (selectedUtxo ? { ...network, kind: 'syscoin', chainId: 57, slip44: 57 } : { ...network, chainId: selectedChainId }) as ReturnType<
        NativeConnectionHost['context']
      >['network'],
      networkId: selectedUtxo ? 'syscoin' : 'ethereum',
      networkLabel: selectedUtxo ? 'Syscoin' : 'Ethereum',
      activeAccountId: ['ready', 'authenticating'].includes(snapshot.phase) ? selectedAccountId : null,
      unlocked: ['ready', 'authenticating'].includes(snapshot.phase),
      accounts:
        ['ready', 'authenticating'].includes(snapshot.phase)
          ? selectedUtxo ? [{ id: utxoAccountId, index: 0, type: utxoAccountType, address: receivingAddress, xpub: 'stable-utxo-public-account', label: 'Syscoin account' }] : [
              {
                id: firstAccountId,
                index: 0,
                type: firstAccountType,
                address: ADDRESS,
                xpub: 'private-host-public-xpub',
                label: 'Account 1',
              },
              ...(creationAllocation ? [creationAllocation.account] : []),
              ...(secondAccount
                ? [
                    {
                      id: 'hd:60:1',
                      index: 1,
                      type: 'HDAccount' as const,
                      address: '0x' + '22'.repeat(20),
                      xpub: 'second-xpub',
                      label: 'Account 2',
                    },
                  ]
                : []),
            ]
          : [],
    }),
  };
  const repository = openNativeConnectionRepository({
    storage,
    walletBindingId: host.walletBindingId,
    assertOwner: host.assertOwner,
  });
  const session: WalletConnectSession = {
    binding: { topic: TOPIC, peerPublicKey: PEER, origin: ORIGIN },
    metadata: { name: 'Reported app', description: '', url: ORIGIN, icons: [] },
    expiry: Math.floor(Date.now() / 1000) + 3600,
    namespaces: {
      [options.utxo ? 'bip122' : 'eip155']: {
        accounts: [options.utxo ? `${dappCaipChain({ ...getUtxoNetwork('syscoin'), kind: 'syscoin' })}:${UTXO_ADDRESSES.syscoin}` : `eip155:1:${ADDRESS}`],
        chains: [options.utxo ? dappCaipChain({ ...getUtxoNetwork('syscoin'), kind: 'syscoin' }) : 'eip155:1'],
        methods: [
          ...(options.capabilities ? ['wallet_getCapabilities'] : []),
          ...(options.moduleInventory ? ['wallet_getSmartAccountModules'] : []),
          ...(options.moduleChanges ? SMART_ACCOUNT_MODULE_REQUEST_METHODS : []),
          ...(options.smartCreation ? ['wallet_prepareSmartAccount'] : []),
          ...(options.batch ? ['wallet_sendCalls', 'wallet_getCallsStatus', 'wallet_showCallsStatus'] : []),
          'wallet_switchEthereumChain',
          'wallet_addEthereumChain',
          'wallet_watchAsset',
          'wallet_getPermissions', 'wallet_requestPermissions', 'wallet_revokePermissions',
          ...DAPP_PUBLIC_RPC_METHODS, ...DAPP_MODE_METHODS, ...DAPP_SYSCOIN_READ_METHODS, ...SENTRY_DAPP_METHODS, ...PSBT_DAPP_METHODS,
          'eth_accounts',
          'eth_chainId',
          'eth_sendTransaction',
          'eth_getEncryptionPublicKey',
          'eth_decrypt',
          'personal_sign',
          'eth_signTypedData',
          'eth_signTypedData_v3',
          'eth_signTypedData_v4',
        ],
        events: ['accountsChanged', 'chainChanged'],
      },
    },
  };
  const proposal: WalletConnectProposal = {
    id: 3,
    expiresAt: null,
    pairingTopic: PAIRING,
    peerPublicKey: PEER,
    metadata: session.metadata,
    verification: UNKNOWN,
    requiredNamespaces: {},
    optionalNamespaces: {
      [options.utxo ? 'bip122' : 'eip155']: {
        chains: [options.utxo ? dappCaipChain({ ...getUtxoNetwork('syscoin'), kind: 'syscoin' }) : 'eip155:1'],
        methods: [
          ...(options.capabilities ? ['wallet_getCapabilities'] : []),
          ...(options.moduleInventory ? ['wallet_getSmartAccountModules'] : []),
          ...(options.moduleChanges ? SMART_ACCOUNT_MODULE_REQUEST_METHODS : []),
          ...(options.smartCreation ? ['wallet_prepareSmartAccount'] : []),
          ...(options.batch ? ['wallet_sendCalls', 'wallet_getCallsStatus', 'wallet_showCallsStatus'] : []),
          'wallet_switchEthereumChain',
          'wallet_addEthereumChain',
          'wallet_watchAsset',
          'wallet_getPermissions', 'wallet_requestPermissions', 'wallet_revokePermissions',
          ...DAPP_PUBLIC_RPC_METHODS, ...DAPP_MODE_METHODS, ...DAPP_SYSCOIN_READ_METHODS, ...SENTRY_DAPP_METHODS, ...PSBT_DAPP_METHODS,
          'eth_accounts',
          'eth_chainId',
          'eth_sendTransaction',
          'eth_getEncryptionPublicKey',
          'eth_decrypt',
          'personal_sign',
          'eth_signTypedData',
          'eth_signTypedData_v3',
          'eth_signTypedData_v4',
        ],
        events: ['accountsChanged'],
      },
    },
  };
  let inventory = options.restoring ? [session] : [];
  const restoredRepository = repository.then(async (value) => {
    if (options.restoring) {
      const permissions = value.permissions(session.binding);
      const frame = {
        dapps: {
          [ORIGIN]: {
            host: ORIGIN,
            accountId: 0,
            accountType: firstAccountType as KeyringAccountType,
            chain: 'ethereum' as INetwork['kind'],
            chainId: 1,
            date: 1,
          },
        },
        pendingOrigins: [],
      };
      await permissions.exclusive(async () => {
        await permissions.write(frame);
        permissions.publish(frame);
      });
    }
    return value;
  });
  const controller = new NativeConnectionsController({
    openExternalUrl: async url => { externalUrls.push(url); },
    async activateAccount(accountId, expectedRevision, guard) {
      guard();
      assert.equal(snapshot.revision, expectedRevision);
      snapshot = { ...snapshot, phase: 'authenticating', revision: snapshot.revision + 1 };
      for (const listener of listeners) listener();
      await activationWait;
      guard();
      selectedAccountId = accountId;
      snapshot = { ...snapshot, phase: 'ready' };
      for (const listener of listeners) listener();
      guard();
    },
    source: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        const notify = () => listener(snapshot);
        listeners.add(notify);
        return () => {
          listeners.delete(notify);
        };
      },
    },
    openHost: async () => {
      const repository = await restoredRepository;
      const observed = { ...repository, permissions(binding: Parameters<typeof repository.permissions>[0]) {
        const port = repository.permissions(binding);
        return { ...port,
          async exclusive<T>(work: () => Promise<T>): Promise<T> {
            const settle = permissionSettlement;
            const result = await port.exclusive(work);
            await settle?.();
            return result;
          },
          publish(frame: Parameters<typeof port.publish>[0]) {
          const grant = frame.dapps[ORIGIN];
          if (options.smartCreation && grant?.accountType === 'SmartAccount')
            creationGrantPublications.push(grant.accountId);
          port.publish(frame);
          permissionPublished?.(!!grant);
        } };
      } };
      return { ...host, repository: observed, calls: repository.calls };
    },
    preparePlatform: async () => undefined,
    checkSite: options.checkSite ?? (async () => {
      await siteWait;
      return { isBlacklisted: siteBlocked };
    }),
    checkAddress: async () => ({
      isBlacklisted: blacklistedAddress,
      severity: blacklistedAddress ? 'high' : 'low',
      reason: blacklistedAddress ? 'Known malicious contract' : undefined,
    }),
    projectId: 'public-fixture-id',
    metadata: {
      name: 'Pali',
      description: '',
      url: 'https://paliwallet.com',
      icons: [],
    },
    openTransport: async (input) => {
      opened++;
      transportEvents.push(input.onEvent);
      await openWait;
      if (openFailures-- > 0)
        throw new Error('Transport temporarily unavailable');
      if (options.loadSdk)
        return openWalletConnectTransport({ ...input, loadSdk: options.loadSdk });
      event = input.onEvent;
      return {
        pair: async (uri, guard, onPairing) => {
          guard();
          const wait = pairWait;
          const failure = pairFailure;
          if (failure?.beforeHandle) throw failure.error;
          const pairing = {
            topic: uri === 'wc:new' ? 'ef'.repeat(32) : PAIRING,
            get expiresAt() {
              return pairingExpiry;
            },
            cancel: async () => {
              pairCanceled++;
              cancelledTopics.push(pairing.topic);
            },
          };
          onPairing(pairing);
          await wait;
          if (failure) throw failure.error;
          return pairing;
        },
        approve: async (_proposal, namespaces, guard) => {
          guard();
          approved++;
          if (!options.utxo) assert.equal(
            namespaces.eip155!.methods.includes('personal_sign'),
            !smart || smartMessages
          );
          await approveWait;
          Object.assign(session, { namespaces });
          return session;
        },
        reject: async () => {
          if (rejectFailure) throw rejectFailure;
        },
        disconnect: async (binding) => {
          await disconnectWait;
          remoteDisconnects.push(binding);
        },
        respond: async (_binding, id, result, guard, onDispatch) => {
          await responseWait;
          if (responseFailure) throw responseFailure;
          guard();
          onDispatch();
          handedOff.push({ id, result });
          await dispatchWait;
          if (dispatchFailure) throw dispatchFailure;
          responses.push({ id, result });
        },
        emit: async (_binding, chain, value, guard) => {
          await emissionWait;
          guard();
          assert(session.namespaces.eip155!.chains!.includes(chain));
          emissionScopes.push(chain);
          emissions.push(value);
        },
        updatePreparedAccount: async (binding, id, address, signal, guard, onCommitted) => {
          assert(options.smartCreation); assert(!signal.aborted); guard();
          assert.equal(binding.topic, session.binding.topic);
          assert.equal(wireAdmissions.get(id)?.method, 'wallet_prepareSmartAccount');
          preparedAccountUpdates.push(address);
          const current = { ...session, namespaces: { ...session.namespaces, eip155: {
            ...session.namespaces.eip155!, accounts: [`eip155:1:${address}`] } } };
          if (creationUpdateFailure) { event({ type: 'session', session: current }); throw Error('Update acknowledgement lost'); }
          onCommitted(current); guard(); beforeCreationGrant(); return current;
        },
        pending: async (binding, id, guard) => {
          guard(); pendingReads++;
          const wire = wireAdmissions.get(id);
          if (!wire || pendingOverride === 'missing' || JSON.stringify(wire.session.binding) !== JSON.stringify(binding) || wire.expiresAt <= Date.now() ||
              handedOff.some(value => (value as { id: number }).id === id)) return null;
          return pendingOverride === 'method' ? { ...wire, method: 'sys_signAndSend' } : pendingOverride === 'fresh' ? { ...wire, freshness: 'fresh' } : wire;
        },
        sessions: async () => {
          if (inventoryFailures-- > 0) throw new Error('Inventory unavailable');
          return inventory;
        },
        close: async () => {
          closed++;
          await closeWait;
          if (closeFailure) throw closeFailure;
        },
      };
    },
  });
  return {
    controller, creationRequests, preparedAccountUpdates, creationGrantPublications,
    failCreationUpdate() { creationUpdateFailure = true; },
    beforeCreationGrantWrite(callback: () => void) { beforeCreationGrant = callback; },
    controlCommits, externalUrls, readRequests, moduleInventoryReads, moduleChangeRequests, sentryRequests, sentryAssents, psbtRequests, psbtApprovals,
    setModuleMetadataUnavailable(value: boolean) { moduleMetadataUnavailable = value; },
    setModuleMetadataWait(value: Promise<void>) { moduleMetadataWait = value; },
    moduleMetadataReads: () => moduleMetadataReads,
    setPsbtWait(value: Promise<void>) { psbtWait = value; },
    setPsbtSignWait(value: Promise<void>) { psbtSignWait = value; },
    psbtDisposals: () => psbtDisposals,
    signingHandoff: () => signingHandoff!,
    setSmartSigningBinding(value: string) { smartSigningBinding = value; },
    changeRegistration() { registrationSuffix = ' changed'; snapshot = { ...snapshot, revision: snapshot.revision + 1 }; for (const listener of listeners) listener(); },
    psbtHandoff: () => psbtHandoff!, canceledPsbtJobs, pendingReads: () => pendingReads,
    setPendingOverride(value: typeof pendingOverride) { pendingOverride = value; },
    setSentryWait(value: Promise<void>) { sentryWait = value; },
    rotateReceiving(value: string) { receivingAddress = value; snapshot = { ...snapshot, revision: snapshot.revision + 1 }; for (const listener of listeners) listener(); },
    setReadWait(value: Promise<void>) { readWait = value; },
    failRead(value: Error) { readError = value; },
    setControlWait(value: Promise<void>) { controlWait = value; },
    failControlCommit() { controlFailure = Error('Mode switch failed'); },
    afterControlCommit(hook: () => void) { afterControlCommit = hook; },
    beforePreparedReturn(hook: () => void) { beforePreparedReturn = hook; },
    smartDisposals: () => smartDisposals,
    view: controller.view,
    rows,
    responses,
    handedOff,
    remoteDisconnects,
    setDispatchWait(value: Promise<void>) {
      dispatchWait = value;
    },
    failCallsStatus(error: Error) { callsStatusError = error; },
    callsStatusReads,
    callsRecoveries,
    callsStatusChains,
    setCallsStatusWait(value: Promise<void>) { callsStatusWait = value; },
    setCallsStatusReceipts(chainId: number, receipts: ReadonlyMap<string, unknown>) {
      callsStatusReceipts.set(chainId, receipts);
    },
    failDispatch() {
      dispatchFailure = Error('Lost acknowledgment');
    },
    clearDispatchFailure() {
      dispatchFailure = undefined;
    },
    signatures,
    transactions,
    preparedTransactions,
    setApprovalMetadata(value: ApprovalContractMetadata) { approvalMetadata = value; },
    setPreparationWait(value: Promise<void>) { preparationWait = value; },
    setStorageWait(value: Promise<void>) { storageWait = value; },
    onPermissionPublication(callback: typeof permissionPublished) { permissionPublished = callback; },
    setPermissionSettlement(callback: typeof permissionSettlement) { permissionSettlement = callback; },
    failTransactionPreparation() { preparationError = new Error('Estimate unavailable'); },
    blockSite() {
      siteBlocked = true;
    },
    blockAddress() {
      blacklistedAddress = true;
    },
    setSiteWait(value: Promise<void>) {
      siteWait = value;
    },
    setSignWait(value: Promise<void>) {
      signWait = value;
    },
    setActivationWait(value: Promise<void>) {
      activationWait = value;
    },
    emissions,
    emissionScopes,
    session,
    proposal,
    repository: restoredRepository,
    event: (value: WalletConnectTransportEvent) => {
      if (value.type === 'request') wireAdmissions.set(value.request.id, value.request);
      else if (value.type === 'request-expired') wireAdmissions.delete(value.id);
      event(value);
    },
    eventFrom: (index: number, value: WalletConnectTransportEvent) =>
      transportEvents[index]!(value),
    opened: () => opened,
    approved: () => approved,
    setOpenWait(value: Promise<void>) {
      openWait = value;
    },
    setApproveWait(value: Promise<void>) {
      approveWait = value;
    },
    setResponseWait(value: Promise<void>) {
      responseWait = value;
    },
    failBeforeDispatch() { responseFailure = Error('Response unavailable before handoff'); },
    setEmissionWait(value: Promise<void>) {
      emissionWait = value;
    },
    setPairWait(value: Promise<void>) {
      pairWait = value;
    },
    setPairFailure(value: typeof pairFailure) {
      pairFailure = value;
    },
    setDisconnectWait(value: Promise<void>) {
      disconnectWait = value;
    },
    setInventory(value: WalletConnectSession[]) {
      inventory = value;
    },
    setCloseWait(value: Promise<void>) {
      closeWait = value;
    },
    setCloseFailure(value: Error) {
      closeFailure = value;
    },
    cancelledTopics,
    setRejectFailure(value: Error) {
      rejectFailure = value;
    },
    expirePairing() {
      pairingExpiry = Date.now() - 1;
    },
    setPairingExpiry(value: number) { pairingExpiry = value; },
    closed: () => closed,
    pairCanceled: () => pairCanceled,
    refresh() {
      snapshot = { ...snapshot, revision: snapshot.revision + 1 };
      for (const listener of listeners) listener();
    },
    selectDisplayAccount(id: string) { selectedAccountId = id; defaultEvmAccountId = id; snapshot = { ...snapshot, revision: snapshot.revision + 1 }; for (const listener of listeners) listener(); },
    selectEvm() { selectedUtxo = false; selectedAccountId = defaultEvmAccountId; snapshot = { ...snapshot, revision: snapshot.revision + 1 }; for (const listener of listeners) listener(); },
    selectUtxo() { selectedUtxo = true; selectedAccountId = utxoAccountId; snapshot = { ...snapshot, revision: snapshot.revision + 1 }; for (const listener of listeners) listener(); },
    selectChain(chainId: number) {
      selectedChainId = chainId;
      snapshot = { ...snapshot, revision: snapshot.revision + 1 };
      for (const listener of listeners) listener();
    },
    lock() {
      snapshot = {
        ...snapshot,
        phase: 'locked',
        revision: snapshot.revision + 1,
        account: null,
      };
      for (const listener of listeners) listener();
    },
    unlock() {
      snapshot = {
        ...snapshot,
        phase: 'ready',
        revision: snapshot.revision + 1,
        account: { network: 'ethereum', address: ADDRESS },
      };
      for (const listener of listeners) listener();
    },
  };
}

test('native controller shares a reviewed public account through the common grant engine', async () => {
  const f = fixture();
  await settle();
  await f.view.pair('wc:fixture');
  try {
    f.event({ type: 'proposal', proposal: f.proposal });
    const before = f.view.getSnapshot();
    assert.equal(before.proposals[0]?.canApprove, true);
    assert.equal(JSON.stringify(before).includes(PEER), false);
    assert.equal(JSON.stringify(before).includes('public-xpub'), false);
    await f.view.approve(3, 'hd:60:0', 'ethereum', before.revision);
    assert.equal(f.view.getSnapshot().sessions.length, 1);
    f.event({
      type: 'request',
      request: { freshness: 'fresh',
        id: 1,
        expiresAt: Date.now() + 300000,
        verification: UNKNOWN,
        session: f.session,
        chainId: 'eip155:1',
        method: 'eth_accounts',
        params: [],
      },
    });
    await settle();
    assert.deepEqual(f.responses.at(-1), {
      id: 1,
      result: { result: [ADDRESS] },
    });
    await f.view.disconnect(f.view.getSnapshot().sessions[0]!.id);
    assert.equal(f.view.getSnapshot().sessions.length, 0);
  } finally {
    await f.controller.dispose();
  }
});

for (const recovery of ['retry', 'unlock'] as const) {
  test(`saved-session restoration retries after a transport failure through ${recovery}`, async () => {
    const f = fixture({ restoring: true, openFailures: 1 });
    try {
      await settle();
      assert.equal(f.view.getSnapshot().status, 'unavailable');
      assert.equal(f.opened(), 1);
      assert.equal((await f.repository).bindings().length, 1);
      if (recovery === 'retry') await f.view.retry();
      else {
        f.lock();
        f.unlock();
        await settle();
      }
      assert.equal(f.opened(), 2);
      assert.equal(f.view.getSnapshot().status, 'ready');
      assert.equal(f.view.getSnapshot().sessions.length, 1);
    } finally {
      await f.controller.dispose();
    }
  });
}

test('a failed session inventory closes its candidate without retiring saved grants', async () => {
  const f = fixture({ restoring: true, inventoryFailures: 1 });
  try {
    await settle();
    assert.equal(f.view.getSnapshot().status, 'unavailable');
    assert.equal(f.closed(), 1);
    const repository = await f.repository;
    assert.equal(repository.bindings().length, 1);
    f.setInventory([]);
    await f.view.retry();
    assert.equal(f.view.getSnapshot().status, 'ready');
    assert.equal(f.opened(), 2);
    assert.deepEqual(repository.bindings(), []);
    assert.deepEqual(f.view.getSnapshot().sessions, []);
  } finally {
    await f.controller.dispose();
  }
});

test('retry waits for old transport cleanup and ignores its late events', async () => {
  const f = fixture({ restoring: true });
  let release!: () => void;
  try {
    await settle();
    f.setCloseWait(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    f.event({ type: 'unavailable' });
    const retry = f.view.retry();
    await settle();
    assert.equal(f.opened(), 1);
    f.eventFrom(0, { type: 'proposal', proposal: f.proposal });
    assert.deepEqual(f.view.getSnapshot().proposals, []);
    release();
    await retry;
    assert.equal(f.opened(), 2);
    f.eventFrom(0, { type: 'unavailable' });
    f.eventFrom(0, { type: 'session-ended', topic: TOPIC });
    assert.equal(f.view.getSnapshot().status, 'ready');
    assert.equal(f.view.getSnapshot().sessions.length, 1);
  } finally {
    release?.();
    await f.controller.dispose();
  }
});

test('retry cannot reopen poisoned storage', async () => {
  const f = fixture({ restoring: true, openFailures: 1 });
  try {
    await settle();
    const repository = await f.repository;
    await assert.rejects(
      repository.transport.setItem('invalid', () => undefined)
    );
    await assert.rejects(f.view.retry(), {
      code: 'CONNECTION_STORAGE_UNAVAILABLE',
    });
    f.lock();
    f.unlock();
    await settle();
    assert.equal(f.view.getSnapshot().status, 'unavailable');
    assert.equal(f.opened(), 1);
  } finally {
    await f.controller.dispose();
  }
});

test('failed transport cleanup prevents a replacement client from opening', async () => {
  const f = fixture({ restoring: true });
  await settle();
  f.setCloseFailure(new Error('Cleanup failed'));
  f.event({ type: 'unavailable' });
  await assert.rejects(f.view.retry(), { message: 'Cleanup failed' });
  assert.equal(f.opened(), 1);
  assert.equal(f.view.getSnapshot().status, 'unavailable');
  await assert.rejects(f.controller.dispose(), { message: 'Cleanup failed' });
});

test('failed SDK initialization cleanup blocks Retry and lock-unlock admission', async () => {
  let releaseCleanup!: () => void, signalCleanup!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const cleanupStarted = new Promise<void>((resolve) => {
    signalCleanup = resolve;
  });
  let initializations = 0;
  const f = fixture({
    restoring: true,
    loadSdk: async () => ({
      requestExpirySeconds: { min: 60, max: 300 },
      createCore: ({ storage }) => ({
        storage,
        history: { values: [], records: new Map(), get: async () => undefined },
        pairing: {
          pairings: { getAll: () => [] },
          disconnect: async () => undefined,
        },
        async dispose() {
          signalCleanup();
          await cleanup;
          throw new Error('private SDK cleanup failure');
        },
      }),
      async initialize() {
        initializations++;
        throw new Error('private SDK initialization failure');
      },
      parseUri() {
        throw new Error('Unexpected pairing');
      },
    }),
  });
  try {
    await cleanupStarted;
    const retry = assert.rejects(f.view.retry(), {
      message: 'CONNECTION_UNAVAILABLE',
    });
    await settle();
    assert.equal(initializations, 1);
    releaseCleanup();
    await retry;
    await assert.rejects(f.view.retry(), { message: 'CONNECTION_UNAVAILABLE' });
    f.lock();
    f.unlock();
    await settle();
    await assert.rejects(f.view.retry(), { message: 'CONNECTION_UNAVAILABLE' });
    assert.equal(initializations, 1);
    assert.equal(f.opened(), 1);
    assert.equal(f.view.getSnapshot().status, 'unavailable');
    assert.equal((await f.repository).bindings().length, 1);
    await assert.rejects(f.controller.dispose(), {
      message: 'CONNECTION_UNAVAILABLE',
    });
  } finally {
    releaseCleanup();
    await f.controller.dispose().catch(() => undefined);
  }
});

test('locking cancels disclosure while retaining durable grants and transport lifetime', async () => {
  const f = fixture();
  await settle();
  await f.view.pair('wc:fixture');
  try {
    f.event({ type: 'proposal', proposal: f.proposal });
    await f.view.approve(
      3,
      'hd:60:0',
      'ethereum',
      f.view.getSnapshot().revision
    );
    const persisted = JSON.stringify([...f.rows]);
    f.lock();
    await settle();
    assert.equal(f.view.getSnapshot().status, 'locked');
    assert.deepEqual(f.view.getSnapshot().accounts, []);
    assert.deepEqual(f.view.getSnapshot().sessions, []);
    assert.equal(f.closed(), 0);
    assert.equal(JSON.stringify([...f.rows]), persisted);
    f.event({
      type: 'request',
      request: { freshness: 'fresh',
        id: 2,
        expiresAt: Date.now() + 300000,
        verification: UNKNOWN,
        session: f.session,
        chainId: 'eip155:1',
        method: 'eth_accounts',
        params: [],
      },
    });
    await settle();
    assert.deepEqual(f.responses.at(-1), { id: 2, result: { result: [] } });
  } finally {
    await f.controller.dispose();
  }
});

test('unsupported raw signing remains unavailable and cancel affects only the new pairing', async () => {
  const f = fixture();
  await settle();
  await f.view.pair('wc:fixture');
  try {
    f.event({
      type: 'proposal',
      proposal: {
        ...f.proposal,
        requiredNamespaces: { eip155: { methods: ['eth_signTransaction'] } },
      },
    });
    assert.equal(f.view.getSnapshot().proposals[0]?.canApprove, false);
    await assert.rejects(
      f.view.approve(3, 'hd:60:0', 'ethereum', f.view.getSnapshot().revision),
      { message: 'UNSUPPORTED_REQUEST' }
    );
    await f.view.pair('wc:fixture');
    f.view.cancel();
    await settle();
    assert.equal(f.pairCanceled(), 1);
    assert.equal(f.closed(), 0);
  } finally {
    await f.controller.dispose();
  }
});

test('ordinary unlock preparation stays local and unchanged custody updates do not emit duplicate events', async () => {
  const f = fixture();
  await settle();
  try {
    assert.equal(f.opened(), 0);
    assert.equal(f.view.getSnapshot().network?.chainId, '1');
    await f.view.pair('wc:fixture');
    f.event({ type: 'proposal', proposal: f.proposal });
    await f.view.approve(
      3,
      'hd:60:0',
      'ethereum',
      f.view.getSnapshot().revision
    );
    await settle();
    const emitted = f.emissions.length;
    f.refresh();
    await settle();
    assert.equal(f.emissions.length, emitted);
    assert.equal(f.opened(), 1);
  } finally {
    await f.controller.dispose();
  }
});

test('network changes use the approved session chain without extending its grant', async () => {
  const f = fixture();
  await settle();
  try {
    await f.view.pair('wc:fixture');
    f.event({ type: 'proposal', proposal: f.proposal });
    await f.view.approve(
      3,
      'hd:60:0',
      'ethereum',
      f.view.getSnapshot().revision
    );
    await settle();
    const persisted = JSON.stringify([...f.rows]);
    f.selectChain(10);
    await settle();
    assert.deepEqual(f.emissions.at(-1), { name: 'chainChanged', data: '0xa' });
    assert.equal(f.emissionScopes.at(-1), 'eip155:1');
    assert.equal(JSON.stringify([...f.rows]), persisted);
    assert.deepEqual(f.session.namespaces.eip155!.chains, ['eip155:1']);
    f.event({
      type: 'request',
      request: { freshness: 'fresh',
        id: 10,
        expiresAt: Date.now() + 300000,
        verification: UNKNOWN,
        session: f.session,
        chainId: 'eip155:1',
        method: 'eth_chainId',
        params: [],
      },
    });
    await settle();
    assert.deepEqual(f.responses.at(-1), {
      id: 10,
      result: {
        error: { code: 4901, message: 'Requested chain is not selected' },
      },
    });
    f.selectChain(1);
    await settle();
    assert.deepEqual(f.emissions.at(-1), { name: 'chainChanged', data: '0x1' });
    f.event({
      type: 'request',
      request: { freshness: 'fresh',
        id: 11,
        expiresAt: Date.now() + 300000,
        verification: UNKNOWN,
        session: f.session,
        chainId: 'eip155:1',
        method: 'eth_chainId',
        params: [],
      },
    });
    await settle();
    assert.deepEqual(f.responses.at(-1), { id: 11, result: { result: '0x1' } });
  } finally {
    await f.controller.dispose();
  }
});

test('a queued network event cannot publish a superseded chain selection', async () => {
  const f = fixture();
  await settle();
  let release!: () => void;
  try {
    await f.view.pair('wc:fixture');
    f.event({ type: 'proposal', proposal: f.proposal });
    await f.view.approve(
      3,
      'hd:60:0',
      'ethereum',
      f.view.getSnapshot().revision
    );
    await settle();
    const previous = f.emissions.length;
    f.setEmissionWait(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    f.selectChain(10);
    await settle();
    f.selectChain(137);
    release();
    await settle();
    assert.deepEqual(f.emissions.slice(previous), [
      { name: 'chainChanged', data: '0x89' },
    ]);
    assert.equal(f.emissionScopes.at(-1), 'eip155:1');
  } finally {
    release?.();
    await f.controller.dispose();
  }
});

test('disconnect after a network switch reports empty accounts on the approved chain', async () => {
  const f = fixture();
  await settle();
  try {
    await f.view.pair('wc:fixture');
    f.event({ type: 'proposal', proposal: f.proposal });
    await f.view.approve(
      3,
      'hd:60:0',
      'ethereum',
      f.view.getSnapshot().revision
    );
    await settle();
    f.selectChain(10);
    await settle();
    const previous = f.emissions.length;
    await f.view.disconnect(f.view.getSnapshot().sessions[0]!.id);
    await settle();
    assert.deepEqual(f.emissions.slice(previous), [
      { name: 'accountsChanged', data: [] },
    ]);
    assert.equal(f.emissionScopes.at(-1), 'eip155:1');
    assert.deepEqual(f.view.getSnapshot().sessions, []);
  } finally {
    await f.controller.dispose();
  }
});

for (const beforeHandle of [true, false]) {
  test(`failed pairing ${
    beforeHandle ? 'validation' : 'SDK call'
  } returns to a retryable state`, async () => {
    const f = fixture();
    await settle();
    try {
      f.setPairFailure({ error: new Error('rejected pairing'), beforeHandle });
      await assert.rejects(f.view.pair('wc:invalid'), {
        message: 'rejected pairing',
      });
      assert.equal(f.view.getSnapshot().status, 'ready');
      assert.equal(f.view.getSnapshot().error, 'CONNECTION_UNAVAILABLE');
      f.setPairFailure(undefined);
      await f.view.pair('wc:new');
      assert.equal(f.view.getSnapshot().status, 'pairing');
      assert.equal(f.view.getSnapshot().error, null);
      f.view.cancel();
      await settle();
      assert.deepEqual(f.cancelledTopics, ['ef'.repeat(32)]);
    } finally {
      await f.controller.dispose();
    }
  });
}

test('a failed cancelled pairing cannot reset a newer pairing', async () => {
  const f = fixture();
  await settle();
  let release!: () => void;
  try {
    f.setPairFailure({
      error: new Error('old SDK failure'),
      beforeHandle: false,
    });
    f.setPairWait(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const oldPair = f.view.pair('wc:old');
    const rejected = assert.rejects(oldPair, { message: 'CONTEXT_CHANGED' });
    await settle();
    f.view.cancel();
    f.setPairFailure(undefined);
    f.setPairWait(Promise.resolve());
    await f.view.pair('wc:new');
    release();
    await rejected;
    assert.equal(f.view.getSnapshot().status, 'pairing');
    assert.equal(f.view.getSnapshot().error, null);
    f.view.cancel();
    await settle();
    assert.equal(f.cancelledTopics.at(-1), 'ef'.repeat(32));
  } finally {
    release?.();
    await f.controller.dispose();
  }
});

test('a failed SDK pairing cannot reappear as a late proposal while a retry succeeds', async () => {
  const f = fixture();
  await settle();
  let release!: () => void;
  try {
    f.setPairFailure({ error: new Error('SDK failure'), beforeHandle: false });
    f.setPairWait(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const pairing = f.view.pair('wc:old');
    const rejected = assert.rejects(pairing, { message: 'SDK failure' });
    await settle();
    f.event({ type: 'proposal', proposal: f.proposal });
    assert.equal(f.view.getSnapshot().proposals.length, 1);
    release();
    await rejected;
    assert.deepEqual(f.view.getSnapshot().proposals, []);
    f.event({ type: 'proposal', proposal: f.proposal });
    assert.deepEqual(f.view.getSnapshot().proposals, []);
    f.setPairFailure(undefined);
    f.setPairWait(Promise.resolve());
    await f.view.pair('wc:new');
    f.event({
      type: 'proposal',
      proposal: { ...f.proposal, id: 4, pairingTopic: 'ef'.repeat(32) },
    });
    assert.deepEqual(
      f.view.getSnapshot().proposals.map(({ id }) => id),
      [4]
    );
  } finally {
    release?.();
    await f.controller.dispose();
  }
});

test('a new URI validation failure does not retire the earlier valid pairing', async () => {
  const f = fixture();
  await settle();
  try {
    await f.view.pair('wc:old');
    f.setPairFailure({ error: new Error('parse failure'), beforeHandle: true });
    await assert.rejects(f.view.pair('wc:invalid'), {
      message: 'parse failure',
    });
    f.event({ type: 'proposal', proposal: f.proposal });
    assert.equal(f.view.getSnapshot().proposals.length, 1);
    f.view.cancel();
    await settle();
    assert.deepEqual(f.cancelledTopics, [PAIRING]);
  } finally {
    await f.controller.dispose();
  }
});

test('a pairing failure preserves an unavailable transport state', async () => {
  const f = fixture();
  await settle();
  let release!: () => void;
  try {
    f.setPairFailure({ error: new Error('SDK failure'), beforeHandle: false });
    f.setPairWait(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const pairing = f.view.pair('wc:fixture');
    const rejected = assert.rejects(pairing, { message: 'CONTEXT_CHANGED' });
    await settle();
    f.event({ type: 'unavailable' });
    release();
    await rejected;
    assert.equal(f.view.getSnapshot().status, 'unavailable');
  } finally {
    release?.();
    await f.controller.dispose();
  }
});

test('a cancelled pairing cannot reappear as a late proposal', async () => {
  const f = fixture();
  await settle();
  try {
    await f.view.pair('wc:fixture');
    f.view.cancel();
    await settle();
    f.event({ type: 'proposal', proposal: f.proposal });
    await settle();
    assert.deepEqual(f.view.getSnapshot().proposals, []);
    assert.equal(f.pairCanceled(), 1);
    assert.equal(f.closed(), 0);
  } finally {
    await f.controller.dispose();
  }
});

test('pairing deadline retires waiting UI, rejects late proposals and permits an explicit fresh pairing', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const f = fixture(); await settle();
  try {
    const expiry = Date.now() + 1000;
    f.setPairingExpiry(expiry);
    await f.view.pair('wc:fixture');
    assert.equal(f.view.getSnapshot().pairingExpiresAt, expiry);
    assert.equal(f.view.getSnapshot().status, 'pairing');
    t.mock.timers.tick(1000); await settle();
    assert.equal(f.view.getSnapshot().status, 'ready');
    assert.equal(f.view.getSnapshot().pairingExpiresAt, null);
    assert.equal(f.view.getSnapshot().error, 'REQUEST_EXPIRED');
    assert.equal(f.pairCanceled(), 1);
    f.event({ type: 'proposal', proposal: { ...f.proposal, expiresAt: Date.now() + 5000 } });
    await settle(); assert.deepEqual(f.view.getSnapshot().proposals, []);
    f.setPairingExpiry(Date.now() + 5000);
    await f.view.pair('wc:fixture');
    f.event({ type: 'proposal', proposal: f.proposal });
    assert.equal(f.view.getSnapshot().proposals[0]?.canApprove, true);
    assert.equal(JSON.stringify(f.view.getSnapshot()).includes(PAIRING), false);
  } finally { await f.controller.dispose(); }
});

test('pairing expiry releases a held pair call without adopting its late result', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 2_000_000 });
  const f = fixture(); await settle();
  const held = Promise.withResolvers<void>(); f.setPairWait(held.promise); f.setPairingExpiry(Date.now() + 1000);
  try {
    const pending = f.view.pair('wc:fixture');
    const rejected = assert.rejects(pending, { message: 'CONTEXT_CHANGED' });
    await settle(); t.mock.timers.tick(1000); await rejected;
    assert.equal(f.view.getSnapshot().pairingExpiresAt, null);
    f.setPairWait(Promise.resolve()); f.setPairingExpiry(Date.now() + 10000);
    await f.view.pair('wc:new');
    held.resolve(); await settle();
    assert.equal(f.view.getSnapshot().pairingExpiresAt, Date.now() + 10000);
    assert.equal(f.view.getSnapshot().status, 'pairing');
  } finally { held.resolve(); await f.controller.dispose(); }
});

test('proposal expiry removes its approval and public permissions exactly match the granted methods', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 3_000_000 });
  const f = fixture(); await settle();
  try {
    await f.view.pair('wc:fixture');
    const expiresAt = Date.now() + 1000;
    f.event({ type: 'proposal', proposal: { ...f.proposal, expiresAt } });
    const before = f.view.getSnapshot();
    assert.equal(before.proposals[0]?.expiresAt, expiresAt);
    assert.equal(before.proposals[0]?.methodsByAccount.find(value => value.accountId === 'hd:60:0')?.methods.includes('personal_sign'), true);
    t.mock.timers.tick(1000); await settle();
    assert.deepEqual(f.view.getSnapshot().proposals, []);
    await assert.rejects(f.view.approve(f.proposal.id, 'hd:60:0', 'ethereum', f.view.getSnapshot().revision), { message: 'CONTEXT_CHANGED' });
    assert.equal(f.approved(), 0);
    f.event({ type: 'proposal', proposal: { ...f.proposal, expiresAt: Date.now() + 5000 } });
    const next = f.view.getSnapshot();
    const methods = next.proposals[0]!.methodsByAccount.find(value => value.accountId === 'hd:60:0')!.methods;
    await f.view.approve(f.proposal.id, 'hd:60:0', 'ethereum', next.revision);
    assert.deepEqual(f.session.namespaces.eip155!.methods, methods);
    const connected = f.view.getSnapshot().sessions[0]!;
    assert.deepEqual(connected.methods, methods);
    assert.equal(connected.expiresAt, f.session.expiry * 1000);
    assert.equal(connected.address, ADDRESS);
  } finally { await f.controller.dispose(); }
});

test('late expired-approval revocation failure cannot invalidate a replacement transport', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 4_000_000 });
  const f = fixture(); await settle();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    await f.view.pair('wc:fixture');
    f.event({ type: 'proposal', proposal: { ...f.proposal, expiresAt: Date.now() + 1000 } });
    f.onPermissionPublication(hasGrant => {
      if (!hasGrant) return;
      f.onPermissionPublication(undefined);
      f.setPermissionSettlement(async () => {
        f.setPermissionSettlement(undefined);
        entered.resolve(); await release.promise;
        throw Error('Late old revocation acknowledgement failure');
      });
      t.mock.timers.tick(1000);
    });
    const approving = f.view.approve(f.proposal.id, 'hd:60:0', 'ethereum', f.view.getSnapshot().revision);
    const rejected = assert.rejects(approving);
    await entered.promise;
    f.event({ type: 'unavailable' }); await settle();
    await f.view.retry(); f.setPairingExpiry(Date.now() + 10000);
    await f.view.pair('wc:new');
    assert.equal(f.view.getSnapshot().status, 'pairing');
    const opened = f.opened();
    release.resolve(); await rejected; await settle();
    assert.equal(f.view.getSnapshot().status, 'pairing');
    assert.equal(f.view.getSnapshot().error, null);
    assert.equal(f.opened(), opened);
  } finally { release.resolve(); await f.controller.dispose(); }
});

test('pairing reserves before transport initialization and stale cancellation errors stay dismissed', async () => {
  const f = fixture();
  await settle();
  let release!: () => void;
  f.setOpenWait(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  try {
    const first = f.view.pair('wc:first');
    const rejected = assert.rejects(first, { message: 'CONTEXT_CHANGED' });
    await assert.rejects(f.view.pair('wc:second'), { message: 'BUSY' });
    f.view.cancel();
    release();
    await rejected;
    assert.equal(f.view.getSnapshot().error, null);
    assert.equal(f.opened(), 1);
  } finally {
    release();
    await f.controller.dispose();
  }
});

test('approval preserves the reviewed authority before its first awaited step', async () => {
  const f = fixture();
  await settle();
  await f.view.pair('wc:fixture');
  try {
    f.event({ type: 'proposal', proposal: f.proposal });
    const approving = f.view.approve(
      3,
      'hd:60:0',
      'ethereum',
      f.view.getSnapshot().revision
    );
    f.refresh();
    await assert.rejects(approving, { message: 'CONTEXT_CHANGED' });
    assert.equal(f.approved(), 0);
    assert.equal(f.view.getSnapshot().sessions.length, 0);
  } finally {
    await f.controller.dispose();
  }
});

test('rejecting during approval retires the proposal even when the remote proposal is already consumed', async () => {
  const f = fixture();
  await settle();
  await f.view.pair('wc:fixture');
  let release!: () => void;
  f.setApproveWait(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  try {
    f.event({ type: 'proposal', proposal: f.proposal });
    const approving = f.view.approve(
      3,
      'hd:60:0',
      'ethereum',
      f.view.getSnapshot().revision
    );
    const rejectedApproval = assert.rejects(approving, {
      message: 'CONTEXT_CHANGED',
    });
    await settle();
    assert.equal(f.approved(), 1);
    f.setRejectFailure(new Error('Proposal already consumed'));
    const rejecting = f.view.reject(3);
    assert.deepEqual(f.view.getSnapshot().proposals, []);
    await assert.rejects(rejecting, {
      message: 'Proposal already consumed',
    });
    release();
    await rejectedApproval;
    assert.deepEqual(f.view.getSnapshot().proposals, []);
    assert.deepEqual(f.view.getSnapshot().sessions, []);
    assert.equal(f.closed(), 0);
  } finally {
    release();
    await f.controller.dispose();
  }
});

test('an expired cancelled pairing no longer blocks a subsequent proposal', async () => {
  const f = fixture();
  await settle();
  try {
    await f.view.pair('wc:fixture');
    f.view.cancel();
    await settle();
    f.expirePairing();
    f.setPairingExpiry(Date.now() + 300000);
    await f.view.pair('wc:fixture');
    f.event({ type: 'proposal', proposal: f.proposal });
    assert.equal(f.view.getSnapshot().proposals[0]?.canApprove, true);
    assert.equal(f.closed(), 0);
  } finally {
    await f.controller.dispose();
  }
});

test('a delayed cancelled pairing cannot replace the newer pairing handle', async () => {
  const f = fixture();
  await settle();
  let release!: () => void;
  f.setPairWait(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  try {
    const oldPair = f.view.pair('wc:old');
    const rejected = assert.rejects(oldPair, { message: 'CONTEXT_CHANGED' });
    await settle();
    f.view.cancel();
    f.setPairWait(Promise.resolve());
    await f.view.pair('wc:new');
    release();
    await rejected;
    f.view.cancel();
    await settle();
    assert.equal(f.cancelledTopics.at(-1), 'ef'.repeat(32));
    assert.equal(f.closed(), 0);
  } finally {
    release();
    await f.controller.dispose();
  }
});

test('local disconnect finishes while the remote acknowledgement is unavailable', async () => {
  const f = fixture();
  await settle();
  await f.view.pair('wc:fixture');
  try {
    f.event({ type: 'proposal', proposal: f.proposal });
    await f.view.approve(
      3,
      'hd:60:0',
      'ethereum',
      f.view.getSnapshot().revision
    );
    f.setDisconnectWait(new Promise<void>(() => undefined));
    let completed = false;
    void f.view.disconnect(f.view.getSnapshot().sessions[0]!.id).then(() => {
      completed = true;
    });
    await settle();
    assert.equal(completed, true);
    assert.deepEqual(f.view.getSnapshot().sessions, []);
    assert.equal(f.closed(), 0);
  } finally {
    await f.controller.dispose();
  }
});

test('an account event waiting for transport cannot disclose the previous unlocked account after lock', async () => {
  const f = fixture();
  await settle();
  await f.view.pair('wc:fixture');
  let release!: () => void;
  f.setEmissionWait(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  try {
    f.event({ type: 'proposal', proposal: f.proposal });
    await f.view.approve(
      3,
      'hd:60:0',
      'ethereum',
      f.view.getSnapshot().revision
    );
    await settle();
    assert.deepEqual(f.emissions, []);
    f.lock();
    release();
    await settle();
    assert.equal(JSON.stringify(f.emissions).includes(ADDRESS), false);
    assert.equal(f.view.getSnapshot().status, 'locked');
  } finally {
    release();
    await f.controller.dispose();
  }
});

for (const retirement of [
  'disconnect',
  'session-ended',
  'session-replaced',
] as const) {
  test(`a queued account response is suppressed after ${retirement}`, async () => {
    const f = fixture();
    await settle();
    await f.view.pair('wc:fixture');
    let release!: () => void;
    try {
      f.event({ type: 'proposal', proposal: f.proposal });
      await f.view.approve(
        3,
        'hd:60:0',
        'ethereum',
        f.view.getSnapshot().revision
      );
      f.setResponseWait(
        new Promise<void>((resolve) => {
          release = resolve;
        })
      );
      f.event({
        type: 'request',
        request: { freshness: 'fresh',
          id: 9,
          expiresAt: Date.now() + 300000,
          verification: UNKNOWN,
          session: f.session,
          chainId: 'eip155:1',
          method: 'eth_accounts',
          params: [],
        },
      });
      await settle();
      if (retirement === 'disconnect')
        await f.view.disconnect(f.view.getSnapshot().sessions[0]!.id);
      else if (retirement === 'session-ended')
        f.event({ type: 'session-ended', topic: TOPIC });
      else f.event({ type: 'session', session: { ...f.session } });
      release();
      await settle();
      assert.deepEqual(f.responses, []);
      assert.equal(
        f.view.getSnapshot().sessions.length,
        retirement === 'session-replaced' ? 1 : 0
      );
      assert.equal(f.closed(), 0);
    } finally {
      release?.();
      await f.controller.dispose();
    }
  });
}

async function connectedFixture(
  options: {
    utxo?: boolean;
    hardware?: 'Ledger' | 'Trezor';
    capabilities?: boolean;
    moduleInventory?: boolean;
    moduleChanges?: boolean;
    smartCreation?: boolean;
    feeComparison?: EvmDappFeeComparison;
    minimumGasLimit?: string;
    batch?: boolean;
    smart?: boolean;
    imported?: boolean;
    smartMessages?: boolean;
    smartTrezor?: boolean;
    secondAccount?: boolean;
    accountId?: string;
    verification?: WalletConnectVerification;
  } = {}
) {
  const f = fixture(options);
  await settle();
  await f.view.pair('wc:fixture');
  f.event({
    type: 'proposal',
    proposal: { ...f.proposal, verification: options.verification ?? UNKNOWN },
  });
  await f.view.approve(
    3,
    options.accountId ?? (options.utxo ? options.hardware ? `${options.hardware.toLowerCase()}:57:0` : 'hd:57:0' : 'hd:60:0'),
    options.utxo ? 'syscoin' : 'ethereum',
    f.view.getSnapshot().revision
  );
  return f;
}

async function messageRequest(
  f: ReturnType<typeof fixture>,
  method = 'personal_sign',
  params: unknown = ['Hello Pali', ADDRESS],
  id = 10,
  verification: WalletConnectVerification = UNKNOWN
) {
  f.event({
    type: 'request',
    request: { freshness: 'fresh',
      id,
      session: f.session,
      chainId: 'eip155:1',
      method,
      params,
      expiresAt: Date.now() + 300000,
      verification,
    },
  });
  await settle();
  return f.view.getSnapshot().signingReview;
}
async function syscoinRequest(f: ReturnType<typeof fixture>, method: string, params: unknown = [], id = 10) {
  f.event({ type: 'request', request: { freshness: 'fresh', id, session: f.session, method, params, chainId: dappCaipChain({ ...getUtxoNetwork('syscoin'), kind: 'syscoin' }), expiresAt: Date.now() + 300000, verification: UNKNOWN } });
  await settle();
}

for (const method of ['eth_getEncryptionPublicKey', 'eth_decrypt']) test(`${method} uses the existing FIFO and a fresh common encryption approval`, async () => {
  const f = await connectedFixture();
  try {
    const review = await messageRequest(f, method, method === 'eth_decrypt' ? ['0xab', ADDRESS] : [ADDRESS]);
    assert.equal(review?.kind, 'encryption'); assert(review);
    assert.equal(f.signatures.length, 0); assert.equal(f.responses.length, 0);
    if (method === 'eth_decrypt') {
      assert.equal(await f.view.previewEncryption(review.id, review.revision), '  public plaintext\n');
      assert.equal(f.responses.length, 0);
      assert(!JSON.stringify(f.view.getSnapshot()).includes('public plaintext'));
    }
    const current = f.view.getSnapshot().signingReview!;
    await f.view.approveRequest(current.id, current.revision, false);
    assert.deepEqual(f.responses, [{ id: 10, result: { result: method === 'eth_decrypt' ? '  public plaintext\n' : 'public-encryption-key' } }]);
    assert.equal(f.signatures.length, method === 'eth_decrypt' ? 2 : 1);
    assert.equal(f.view.getSnapshot().signingReview, null);
    await assert.rejects(f.view.approveRequest(current.id, current.revision, false));
  } finally { await f.controller.dispose(); }
});

test('Smart connections do not advertise software encryption or reach its private SDK capability', async () => {
  const f = await connectedFixture({ smart: true, smartMessages: true, accountId: 'smart:60:0' });
  try {
    assert(!f.session.namespaces.eip155!.methods.includes('eth_decrypt'));
    assert(!f.session.namespaces.eip155!.methods.includes('eth_getEncryptionPublicKey'));
    await messageRequest(f, 'eth_decrypt', ['0xab', '0x' + '33'.repeat(20)]);
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(f.signatures.length, 0);
  } finally { await f.controller.dispose(); }
});

test('encryption preview and consent cannot overtake an earlier message or retarget the receiver', async () => {
  const f = await connectedFixture();
  try {
    const first = await messageRequest(f);
    await messageRequest(f, 'eth_decrypt', ['0xab', ADDRESS], 11);
    assert.equal(f.view.getSnapshot().signingReview?.id, first!.id);
    await f.view.rejectRequest(first!.id);
    const next = f.view.getSnapshot().signingReview!;
    assert.equal(next.kind, 'encryption');
    await assert.rejects(f.view.previewEncryption(next.id, first!.revision));
    assert.equal(f.signatures.length, 0);
    await f.view.rejectRequest(next.id);
    await messageRequest(f, 'eth_decrypt', [ADDRESS, '0xab'], 12);
    assert.equal(f.view.getSnapshot().signingReview, null);
  } finally { await f.controller.dispose(); }
});

test('encryption response uncertainty consumes the approval and blocks private-operation retries', async () => {
  const f = await connectedFixture();
  try {
    const review = await messageRequest(f, 'eth_decrypt', ['0xab', ADDRESS]); assert(review);
    f.failDispatch();
    await assert.rejects(f.view.approveRequest(review.id, review.revision, false));
    const current = f.view.getSnapshot().signingReview!;
    assert.equal(current.error, 'DELIVERY_UNCERTAIN');
    await assert.rejects(f.view.approveRequest(current.id, current.revision, false));
    assert.equal(f.signatures.length, 1); assert.equal(f.handedOff.length, 1);
  } finally { await f.controller.dispose(); }
});

for (const change of ['lock', 'network', 'session'] as const) test(`encryption disclosure waits for the existing response gate and refuses ${change} changes`, async () => {
  const f = await connectedFixture(); let release!: () => void;
  try {
    const review = await messageRequest(f, 'eth_decrypt', ['0xab', ADDRESS]); assert(review);
    f.setResponseWait(new Promise(resolve => { release = resolve; }));
    const work = f.view.approveRequest(review.id, review.revision, false);
    const rejected = assert.rejects(work);
    await settle(); assert.equal(f.signatures.length, 1); assert.equal(f.handedOff.length, 0);
    if (change === 'lock') f.lock();
    else if (change === 'network') f.selectChain(5700);
    else f.event({ type: 'session-ended', topic: TOPIC });
    release(); await rejected; await settle();
    assert(!f.responses.some(value => JSON.stringify(value).includes('public plaintext')));
    assert.equal(f.view.getSnapshot().signingReview, null);
  } finally { release?.(); await f.controller.dispose(); }
});
for (const method of PSBT_DAPP_METHODS) test(`${method} is negotiated only in bip122 and signs the original structured request after explicit consent`, async () => {
  const f = await connectedFixture({ utxo: true });
  try {
    assert(f.session.namespaces.bip122!.methods.includes(method));
    await syscoinRequest(f, method, [EXTERNAL_PSBT]);
    const review = f.view.getSnapshot().psbtReview; assert(review?.details);
    assert.equal(review.origin, ORIGIN); assert.equal(review.method, method); assert.equal(review.details.complete, false);
    assert.equal(f.psbtApprovals.length, 0); assert.equal(f.responses.length, 0);
    assert.deepEqual(f.psbtRequests, [{ method, origin: ORIGIN, psbt: EXTERNAL_PSBT }]);
    assert(!JSON.stringify(f.view.getSnapshot()).includes(EXTERNAL_PSBT.psbt));
    await f.view.approvePsbt(review.id, review.revision);
    assert.equal(f.psbtApprovals.length, 1); assert.equal(f.psbtDisposals(), 1);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: method === 'sys_sign' ? EXTERNAL_PSBT : { txid: 'ef'.repeat(32) } } });
    assert.equal(f.view.getSnapshot().psbtReview, null);
  } finally { await f.controller.dispose(); }
});
test('EVM namespaces and malformed/tagged external PSBT payloads cannot reach custody', async () => {
  const evm = await connectedFixture(), utxo = await connectedFixture({ utxo: true });
  try {
    assert(!evm.session.namespaces.eip155!.methods.some(method => (PSBT_DAPP_METHODS as readonly string[]).includes(method)));
    await messageRequest(evm, 'sys_sign', [EXTERNAL_PSBT]); assert.equal(evm.psbtRequests.length, 0);
    for (const [index, params] of [EXTERNAL_PSBT, [EXTERNAL_PSBT, EXTERNAL_PSBT], [{ ...EXTERNAL_PSBT, sentryFeeAuthorization: 'untrusted' }]].entries())
      await syscoinRequest(utxo, 'sys_sign', params, 20 + index);
    assert.equal(utxo.psbtRequests.length, 0); assert.equal(utxo.psbtApprovals.length, 0);
    assert.equal(utxo.view.getSnapshot().psbtReview, null);
  } finally { await evm.controller.dispose(); await utxo.controller.dispose(); }
});
test('external PSBT requests preserve FIFO with Sentry approvals and reject stale consent revisions', async () => {
  const f = await connectedFixture({ utxo: true });
  try {
    await syscoinRequest(f, 'sys_linkSentryNode', [{ version: 1 }], 10);
    await syscoinRequest(f, 'sys_sign', [EXTERNAL_PSBT], 11);
    assert.equal(f.psbtRequests.length, 0); assert.equal(f.view.getSnapshot().psbtReview, null);
    await f.view.rejectSentry(f.view.getSnapshot().sentryReview!.id); await settle();
    const review = f.view.getSnapshot().psbtReview; assert(review?.details);
    await syscoinRequest(f, 'sys_signAndSend', [EXTERNAL_PSBT], 12);
    await assert.rejects(f.view.approvePsbt(review.id, review.revision));
    await f.view.rejectPsbt(review.id); await settle();
    const next = f.view.getSnapshot().psbtReview; assert(next?.details); assert.equal(next.method, 'sys_signAndSend');
    assert.equal(f.psbtApprovals.length, 0); assert.equal(f.psbtRequests.length, 2);
  } finally { await f.controller.dispose(); }
});
for (const change of ['lock', 'network', 'session', 'revoke', 'expiry', 'dispose'] as const) test(`external PSBT preparation cannot outlive its original ${change} owner`, async () => {
  const f = await connectedFixture({ utxo: true }), held = Promise.withResolvers<void>(), readNow = Date.now;
  let now = readNow(); Date.now = () => now; let disposing: Promise<void> | undefined;
  try {
    f.setPsbtWait(held.promise); await syscoinRequest(f, 'sys_sign', [EXTERNAL_PSBT]); assert.equal(f.psbtRequests.length, 1);
    if (change === 'lock') f.lock(); else if (change === 'network') f.selectChain(5700);
    else if (change === 'session') f.event({ type: 'session-ended', topic: TOPIC });
    else if (change === 'revoke') await syscoinRequest(f, 'wallet_revokePermissions', [{ eth_accounts: {} }], 11);
    else if (change === 'expiry') now += 300001; else disposing = f.controller.dispose();
    held.resolve(); await settle(); await disposing;
    assert.equal(f.view.getSnapshot().psbtReview, null); assert.equal(f.psbtApprovals.length, 0); assert.equal(f.psbtDisposals(), 1);
    assert.equal(f.responses.some(value => (value as { id: number; result: object }).id === 10 && 'result' in (value as { result: object }).result), false);
  } finally { Date.now = readNow; held.resolve(); await f.controller.dispose(); }
});
test('a retired PSBT signing request cannot deliver its late structured result', async () => {
  const f = await connectedFixture({ utxo: true }), held = Promise.withResolvers<void>();
  try {
    await syscoinRequest(f, 'sys_sign', [EXTERNAL_PSBT]); const review = f.view.getSnapshot().psbtReview; assert(review?.details);
    f.setPsbtSignWait(held.promise); const signing = f.view.approvePsbt(review.id, review.revision); await settle();
    f.lock(); held.resolve(); await assert.rejects(signing); await settle();
    assert(!f.responses.some(value => 'result' in (value as { result: object }).result)); assert.equal(f.view.getSnapshot().psbtReview, null);
  } finally { held.resolve(); await f.controller.dispose(); }
});
for (const hardware of ['Ledger', 'Trezor'] as const) test(`${hardware} proposal exposes only its wired EVM message methods and retains the existing calls exclusion`, async () => {
  const f = await connectedFixture({ hardware, batch: true, accountId: `${hardware.toLowerCase()}:60:0` });
  try {
    const methods = f.session.namespaces.eip155!.methods;
    assert(methods.includes('personal_sign')); assert(methods.includes('eth_signTypedData_v3')); assert(methods.includes('eth_signTypedData_v4'));
    assert.equal(methods.includes('eth_signTypedData'), false); assert.equal(methods.includes('wallet_sendCalls'), false);
    assert.equal(methods.some(method => method.startsWith('sys_') && !(DAPP_MODE_METHODS as readonly string[]).includes(method)), false);
    assert.equal((await f.repository).permissions(f.session.binding).read().dapps[ORIGIN]?.accountType, hardware);
  } finally { await f.controller.dispose(); }
});
for (const mismatch of ['family', 'chain'] as const) test(`session updates cannot replace the persisted signing ${mismatch} grant`, async () => {
  const f = await connectedFixture({ utxo: mismatch === 'family' });
  try {
    if (mismatch === 'family') f.selectEvm(); else f.selectChain(10);
    const chainId = mismatch === 'family' ? 'eip155:1' : 'eip155:10';
    const updated = { ...f.session, namespaces: { eip155: { accounts: [`${chainId}:${ADDRESS}`], chains: [chainId], methods: ['personal_sign'], events: [] } } };
    f.event({ type: 'session', session: updated });
    f.event({ type: 'request', request: { freshness: 'fresh', id: 10, session: updated, chainId, method: 'personal_sign', params: ['Hello', ADDRESS], expiresAt: Date.now() + 300000, verification: UNKNOWN } });
    await settle();
    assert.equal(f.view.getSnapshot().signingReview, null); assert.equal(f.signatures.length, 0);
    assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, mismatch === 'family' ? 4100 : 4901);
  } finally { await f.controller.dispose(); }
});
test('Syscoin approval uses full-genesis-derived bip122 scope and the common stable public-key grant', async () => {
  const f = await connectedFixture({ utxo: true });
  try {
    const chain = dappCaipChain({ ...getUtxoNetwork('syscoin'), kind: 'syscoin' });
    assert.deepEqual(f.session.namespaces.bip122!.accounts, [`${chain}:${UTXO_ADDRESSES.syscoin}`]);
    assert.equal(f.session.namespaces.eip155, undefined);
    assert.equal(f.session.namespaces.bip122!.methods.includes('eth_sendTransaction'), false);
    const grant = (await f.repository).permissions(f.session.binding).read().dapps[ORIGIN];
    assert.deepEqual(grant?.utxoAccount, { slip44: 57, xpub: 'stable-utxo-public-account' });
    await syscoinRequest(f, 'sys_getPublicKey');
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: 'stable-utxo-public-account' } });
    f.rotateReceiving(ROTATED_SYSCOIN_ADDRESS);
    await syscoinRequest(f, 'sys_requestAccounts', [], 11);
    assert.deepEqual(f.responses.at(-1), { id: 11, result: { result: [ROTATED_SYSCOIN_ADDRESS] } });
    assert.deepEqual(f.session.namespaces.bip122!.accounts, [`${chain}:${UTXO_ADDRESSES.syscoin}`]);
    await syscoinRequest(f, 'wallet_getPermissions', [], 12);
    const permissions = (f.responses.at(-1) as { result: { result: { caveats: { value: unknown[] }[] }[] } }).result.result;
    assert.equal(permissions.length, 1);
    assert.deepEqual(permissions[0]!.caveats[0]!.value, [ROTATED_SYSCOIN_ADDRESS]);
  } finally { await f.controller.dispose(); }
});
for (const mismatch of ['method', 'account', 'chain', 'origin'] as const) test(`Syscoin read refuses ${mismatch} before custody access`, async () => {
  const f = await connectedFixture({ utxo: true });
  try {
    const session = { ...f.session, binding: mismatch === 'origin' ? { ...f.session.binding, origin: 'https://other.example' } : f.session.binding };
    if (mismatch === 'method') Object.assign(f.session.namespaces.bip122!, { methods: [] });
    if (mismatch === 'account') Object.assign(f.session.namespaces.bip122!, { accounts: [`${dappCaipChain({ ...getUtxoNetwork('syscoin'), kind: 'syscoin' })}:${UTXO_ADDRESSES.bitcoin}`] });
    f.event({ type: 'request', request: { freshness: 'fresh', id: 10, session, method: 'sys_getPublicKey', params: [], chainId: mismatch === 'chain' ? 'bip122:' + '00'.repeat(16) : dappCaipChain({ ...getUtxoNetwork('syscoin'), kind: 'syscoin' }), expiresAt: Date.now() + 300000, verification: UNKNOWN } });
    await settle(); assert.equal(f.readRequests.length, 0);
    assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, mismatch === 'chain' ? 4901 : 4100);
  } finally { await f.controller.dispose(); }
});
for (const utxo of [false, true]) test(`explicit ${utxo ? 'Syscoin to EVM' : 'EVM to Syscoin'} mode consent replies on its original namespace and retires that binding`, async () => {
  const f = await connectedFixture({ utxo });
  try {
    if (utxo) await syscoinRequest(f, 'eth_changeUTXOEVM', [{ chainId: 1 }]);
    else await messageRequest(f, 'sys_changeUTXOEVM', [{ chainId: 57 }]);
    const review = f.view.getSnapshot().controlReview; assert(review?.details?.kind === 'network-switch');
    assert.equal(f.controlCommits.length, 0);
    await f.view.approveControl(review.id, review.revision);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: null } });
    assert.equal(f.view.getSnapshot().sessions.length, 0);
    assert.equal((await f.repository).permissions(f.session.binding).read().dapps[ORIGIN], undefined);
    assert.equal(f.controlCommits.length, 1);
  } finally { await f.controller.dispose(); }
});
for (const utxo of [false, true]) for (const committed of [false, true]) for (const acknowledged of [false, true]) test(`${utxo ? 'Syscoin to EVM' : 'EVM to Syscoin'} mode grant cleanup: ${committed ? 'committed' : 'failed'} switch, ${acknowledged ? 'delivered' : 'lost'} response acknowledgment`, async () => {
  const f = await connectedFixture({ utxo });
  try {
    const permissions = (await f.repository).permissions(f.session.binding);
    const originalGrant = permissions.read().dapps[ORIGIN];
    const namespaces = JSON.stringify(f.session.namespaces);
    if (!committed) f.failControlCommit();
    if (!acknowledged) f.failDispatch();
    if (utxo) await syscoinRequest(f, 'eth_changeUTXOEVM', [{ chainId: 1 }]);
    else await messageRequest(f, 'sys_changeUTXOEVM', [{ chainId: 57 }]);
    const review = f.view.getSnapshot().controlReview;
    assert(review?.details?.kind === 'network-switch');
    assert.equal(f.controlCommits.length, 0, 'mode changes still require explicit consent');
    const approving = f.view.approveControl(review.id, review.revision);
    if (!committed) await assert.rejects(approving, /Mode switch failed/);
    else if (!acknowledged) await assert.rejects(approving, /Lost acknowledgment/);
    else await approving;
    assert.equal(f.view.getSnapshot().controlReview, null);
    assert.equal(f.controlCommits.length, Number(committed));
    assert.equal(f.view.getSnapshot().sessions.length, committed ? 0 : 1);
    assert.deepEqual(permissions.read().dapps[ORIGIN], committed ? undefined : originalGrant);
    assert.equal(JSON.stringify(f.session.namespaces), namespaces, 'switching never expands the negotiated authority');
    assert.equal(f.responses.length, Number(acknowledged));
    assert.equal(f.handedOff.length, 1, 'transport uncertainty must not cause a second response');
    const response = f.handedOff[0] as { id: number; result: { result?: unknown; error?: { code: number } } };
    assert.equal(response.id, 10);
    if (committed) assert.deepEqual(response.result, { result: null });
    else assert.equal(response.result.error?.code, 4001, 'a failed switch cannot claim completion');
    assert.equal(f.signatures.length, 0);
  } finally { await f.controller.dispose(); }
});
for (const utxo of [false, true]) test(`${utxo ? 'Syscoin to EVM' : 'EVM to Syscoin'} known mode commit retires its grant when the request expires before response admission`, async () => {
  const readNow = Date.now;
  let now = readNow();
  Date.now = () => now;
  const f = await connectedFixture({ utxo });
  try {
    if (utxo) await syscoinRequest(f, 'eth_changeUTXOEVM', [{ chainId: 1 }]);
    else await messageRequest(f, 'sys_changeUTXOEVM', [{ chainId: 57 }]);
    const review = f.view.getSnapshot().controlReview; assert(review?.details);
    f.afterControlCommit(() => { now += 300001; });
    await assert.rejects(f.view.approveControl(review.id, review.revision), /REQUEST_EXPIRED/);
    assert.equal(f.controlCommits.length, 1);
    assert.equal(f.responses.length, 0); assert.equal(f.handedOff.length, 0);
    assert.equal((await f.repository).permissions(f.session.binding).read().dapps[ORIGIN], undefined);
    assert.equal(f.view.getSnapshot().sessions.length, 0);
    assert.equal(f.signatures.length, 0);
  } finally { Date.now = readNow; await f.controller.dispose(); }
});
test('late known mode commit cleanup retains a newly published successor grant', async () => {
  const readNow = Date.now; let now = readNow(); Date.now = () => now;
  const f = await connectedFixture();
  try {
    const permission = (await f.repository).permissions(f.session.binding);
    const frame = permission.read(), original = frame.dapps[ORIGIN]; assert(original);
    const successor = { ...original, date: original.date + 1 };
    await messageRequest(f, 'sys_changeUTXOEVM', [{ chainId: 57 }]);
    const review = f.view.getSnapshot().controlReview; assert(review?.details);
    f.afterControlCommit(() => {
      permission.publish({ ...frame, dapps: { ...frame.dapps, [ORIGIN]: successor } });
      now += 300001;
    });
    await assert.rejects(f.view.approveControl(review.id, review.revision), /REQUEST_EXPIRED/);
    assert.equal(f.controlCommits.length, 1);
    assert.deepEqual(permission.read().dapps[ORIGIN], successor);
    assert.equal(f.view.getSnapshot().sessions.length, 1);
    assert.equal(f.remoteDisconnects.length, 0);
    assert.equal(f.responses.length, 0);
  } finally { Date.now = readNow; await f.controller.dispose(); }
});
for (const utxo of [false, true]) for (const acknowledged of [false, true]) test(`${utxo ? 'Syscoin to EVM' : 'EVM to Syscoin'} committed mode grant retires at handoff while its ${acknowledged ? 'delivered' : 'lost'} acknowledgment is held`, async () => {
  const f = await connectedFixture({ utxo });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let approving: Promise<void> | undefined;
  try {
    if (utxo) await syscoinRequest(f, 'eth_changeUTXOEVM', [{ chainId: 1 }]);
    else await messageRequest(f, 'sys_changeUTXOEVM', [{ chainId: 57 }]);
    const review = f.view.getSnapshot().controlReview; assert(review?.details);
    f.setDispatchWait(held);
    if (!acknowledged) f.failDispatch();
    let completed = false;
    approving = f.view.approveControl(review.id, review.revision);
    const outcome = approving.then(() => { completed = true; return null; }, cause => { completed = true; return cause; });
    await settle();
    assert.equal(f.controlCommits.length, 1);
    assert.equal(f.handedOff.length, 1);
    assert.equal(f.responses.length, 0);
    assert.equal(completed, false);
    assert.equal((await f.repository).permissions(f.session.binding).read().dapps[ORIGIN], undefined);
    assert.equal(f.view.getSnapshot().sessions.length, 0);
    assert.equal(f.signatures.length, 0);
    assert.equal(f.remoteDisconnects.length, 0, 'local retirement cannot remove transport session keys while response publication is pending');
    release();
    const failure = await outcome;
    if (acknowledged) assert.equal(failure, null);
    else assert.match(String(failure), /Lost acknowledgment/);
    assert.equal(f.handedOff.length, 1);
    assert.equal(f.responses.length, Number(acknowledged));
    assert.equal(f.remoteDisconnects.length, 1, 'remote disconnect follows settled response delivery or uncertainty exactly once');
  } finally { release(); await approving?.catch(() => undefined); await f.controller.dispose(); }
});
for (const utxo of [false, true]) test(`${utxo ? 'Syscoin to EVM' : 'EVM to Syscoin'} committed mode grant retires when response fails before handoff`, async () => {
  const f = await connectedFixture({ utxo });
  try {
    if (utxo) await syscoinRequest(f, 'eth_changeUTXOEVM', [{ chainId: 1 }]);
    else await messageRequest(f, 'sys_changeUTXOEVM', [{ chainId: 57 }]);
    const review = f.view.getSnapshot().controlReview; assert(review?.details);
    f.failBeforeDispatch();
    await assert.rejects(f.view.approveControl(review.id, review.revision), /Response unavailable before handoff/);
    assert.equal(f.controlCommits.length, 1);
    assert.equal(f.responses.length, 0);
    assert.equal(f.handedOff.length, 0);
    assert.equal((await f.repository).permissions(f.session.binding).read().dapps[ORIGIN], undefined);
    assert.equal(f.view.getSnapshot().sessions.length, 0);
  } finally { await f.controller.dispose(); }
});
test('late committed mode response cleanup cannot revoke a successor connection or grant', async () => {
  const f = await connectedFixture();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let approving: Promise<void> | undefined;
  try {
    await messageRequest(f, 'sys_changeUTXOEVM', [{ chainId: 57 }]);
    const review = f.view.getSnapshot().controlReview; assert(review?.details);
    f.setResponseWait(held);
    approving = f.view.approveControl(review.id, review.revision);
    const outcome = assert.rejects(approving);
    await settle();
    assert.equal(f.controlCommits.length, 1);
    assert.equal(f.handedOff.length, 0);
    await f.view.disconnect(f.view.getSnapshot().sessions[0]!.id);
    f.selectEvm();
    await f.view.pair('wc:fixture');
    f.event({ type: 'proposal', proposal: f.proposal });
    await f.view.approve(3, 'hd:60:0', 'ethereum', f.view.getSnapshot().revision);
    const permission = (await f.repository).permissions(f.session.binding);
    const successor = permission.read().dapps[ORIGIN]; assert(successor);
    release();
    await outcome;
    assert.equal(f.view.getSnapshot().sessions.length, 1);
    assert.deepEqual(permission.read().dapps[ORIGIN], successor);
    assert.equal(f.handedOff.length, 0);
    assert.equal(f.responses.length, 0);
  } finally { release(); await approving?.catch(() => undefined); await f.controller.dispose(); }
});
test('a held committed mode revocation cannot delete or remotely disconnect a successor after its write completes', async () => {
  const f = await connectedFixture();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let approving: Promise<void> | undefined, successorApproval: Promise<void> | undefined;
  try {
    await messageRequest(f, 'sys_changeUTXOEVM', [{ chainId: 57 }]);
    const review = f.view.getSnapshot().controlReview; assert(review?.details);
    f.setStorageWait(held);
    approving = f.view.approveControl(review.id, review.revision);
    await settle();
    assert.equal(f.handedOff.length, 1);
    assert.equal((await f.repository).permissions(f.session.binding).read().dapps[ORIGIN], undefined);
    f.event({ type: 'session-ended', topic: TOPIC });
    f.event({ type: 'session', session: { ...f.session } });
    f.selectEvm();
    await f.view.pair('wc:fixture');
    f.event({ type: 'proposal', proposal: f.proposal });
    successorApproval = f.view.approve(3, 'hd:60:0', 'ethereum', f.view.getSnapshot().revision);
    const successorOutcome = successorApproval.then(() => null, cause => cause);
    await settle();
    release();
    await approving;
    assert.equal(await successorOutcome, null);
    assert.equal(f.view.getSnapshot().sessions.length, 1);
    assert((await f.repository).permissions(f.session.binding).read().dapps[ORIGIN]);
    assert.equal(f.remoteDisconnects.length, 0);
  } finally { release(); await Promise.allSettled([approving, successorApproval]); await f.controller.dispose(); }
});
test('a settled mode response cannot remotely disconnect a successor approved after local retirement', async () => {
  const f = await connectedFixture();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let approving: Promise<void> | undefined;
  try {
    await messageRequest(f, 'sys_changeUTXOEVM', [{ chainId: 57 }]);
    const review = f.view.getSnapshot().controlReview; assert(review?.details);
    f.setDispatchWait(held);
    approving = f.view.approveControl(review.id, review.revision);
    await settle();
    assert.equal(f.view.getSnapshot().sessions.length, 0);
    assert.equal(f.remoteDisconnects.length, 0);
    f.selectEvm();
    await f.view.pair('wc:fixture');
    f.event({ type: 'proposal', proposal: f.proposal });
    await f.view.approve(3, 'hd:60:0', 'ethereum', f.view.getSnapshot().revision);
    const permission = (await f.repository).permissions(f.session.binding);
    const successor = permission.read().dapps[ORIGIN]; assert(successor);
    release();
    await approving;
    assert.equal(f.view.getSnapshot().sessions.length, 1);
    assert.deepEqual(permission.read().dapps[ORIGIN], successor);
    assert.equal(f.remoteDisconnects.length, 0);
    assert.equal(f.handedOff.length, 1);
    assert.equal(f.responses.length, 1);
  } finally { release(); await approving?.catch(() => undefined); await f.controller.dispose(); }
});
for (const method of SENTRY_DAPP_METHODS) test(`${method} retains its exact origin/typed request and requires its own fresh assent`, async () => {
  const f = await connectedFixture({ utxo: true });
  try {
    const raw = { version: 1, proTxHash: 'ab'.repeat(32), genesisHash: getUtxoNetwork('syscoin').genesisHash };
    await syscoinRequest(f, method, [raw]);
    const review = f.view.getSnapshot().sentryReview;
    assert(review?.details); assert.equal(review.origin, ORIGIN);
    assert.deepEqual(f.sentryRequests, [{ method, raw, origin: ORIGIN }]);
    assert.equal(f.responses.length, 0); assert.equal(f.sentryAssents.length, 0);
    const assent: NativeSentryAssent = review.details.kind === 'link' ? { kind: 'link' } : review.details.kind === 'vote' ? { kind: 'vote' } : { kind: 'operation', keyId: 'displayed-role-key' };
    await f.view.approveSentry(review.id, review.revision, assent);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: { method } } });
    assert.equal(f.view.getSnapshot().sentryReview, null);
    assert.equal(f.sentryAssents.length, 1);
    assert.equal(JSON.stringify(f.view.getSnapshot()).includes('Transient fixture password'), false);
  } finally { await f.controller.dispose(); }
});
test('Sentry FIFO prepares the next request after rejection and a second approval cannot reuse a consumed revision', async () => {
  const f = await connectedFixture({ utxo: true });
  try {
    await syscoinRequest(f, 'sys_linkSentryNode', [{ version: 1 }], 10);
    await syscoinRequest(f, 'sys_signSentryVote', [{ version: 1 }], 11);
    const first = f.view.getSnapshot().sentryReview; assert(first);
    assert.equal(f.sentryRequests.length, 1);
    await f.view.rejectSentry(first.id); await settle();
    const next = f.view.getSnapshot().sentryReview; assert(next?.details?.kind === 'vote');
    assert.equal(f.sentryRequests.length, 2);
    const signing = f.view.approveSentry(next.id, next.revision, { kind: 'vote' });
    await assert.rejects(f.view.approveSentry(next.id, next.revision, { kind: 'vote' }));
    await signing;
    assert.equal(f.sentryAssents.length, 1);
    assert.deepEqual(f.responses.map(value => (value as { id: number }).id), [10, 11]);
  } finally { await f.controller.dispose(); }
});
for (const change of ['lock', 'network', 'session', 'revoke', 'expiry', 'dispose'] as const) test(`held Sentry preparation cannot outlive ${change}`, async () => {
  const f = await connectedFixture({ utxo: true }), held = Promise.withResolvers<void>(), readNow = Date.now;
  let now = readNow(); Date.now = () => now;
  let disposing: Promise<void> | undefined;
  try {
    f.setSentryWait(held.promise);
    await syscoinRequest(f, 'sys_linkSentryNode', [{ version: 1 }]);
    assert.equal(f.sentryRequests.length, 1);
    if (change === 'lock') f.lock();
    else if (change === 'network') f.selectChain(5700);
    else if (change === 'session') f.event({ type: 'session-ended', topic: TOPIC });
    else if (change === 'revoke') await syscoinRequest(f, 'wallet_revokePermissions', [{ eth_accounts: {} }], 11);
    else if (change === 'expiry') now += 300001;
    else disposing = f.controller.dispose();
    held.resolve(); await settle(); await disposing;
    assert.equal(f.view.getSnapshot().sentryReview, null);
    assert.equal(f.sentryAssents.length, 0);
    assert.equal(f.responses.some(value => (value as { id: number }).id === 10), false);
  } finally { Date.now = readNow; held.resolve(); await f.controller.dispose(); }
});

for (const display of ['other-evm', 'utxo', 'other-account'] as const) test(`permission roundtrip retains the exact grant while displaying ${display}`, async () => {
  const f = await connectedFixture({ secondAccount: true });
  try {
    const before = structuredClone([...f.rows]);
    if (display === 'other-evm') f.selectChain(10);
    else if (display === 'utxo') f.selectUtxo();
    else f.selectDisplayAccount('hd:60:1');
    for (const method of ['wallet_getPermissions', 'wallet_requestPermissions']) {
      await messageRequest(f, method, method === 'wallet_getPermissions' ? [] : [{ eth_accounts: {} }]);
      const result = (f.responses.at(-1) as { result: { result: { caveats: { value: unknown[] }[] }[] } }).result.result;
      assert.deepEqual(result[0]!.caveats[0]!.value, [ADDRESS]);
      assert.deepEqual(result[1]!.caveats[0]!.value, ['0x1']);
    }
    assert.deepEqual([...f.rows], before);
    assert.equal(f.view.getSnapshot().controlReview, null);
    assert.equal(f.transactions.length, 0);
  } finally { await f.controller.dispose(); }
});

for (const display of ['other-evm', 'utxo'] as const) test(`network switchback from ${display} uses the original grant without changing its account ceiling`, async () => {
  const f = await connectedFixture({ secondAccount: true });
  try {
    f.selectDisplayAccount('hd:60:1');
    if (display === 'other-evm') f.selectChain(10); else f.selectUtxo();
    await messageRequest(f, 'wallet_switchEthereumChain', [{ chainId: '0x1' }]);
    const review = f.view.getSnapshot().controlReview;
    assert(review?.details?.kind === 'network-switch');
    assert.equal(review.address, ADDRESS);
    await f.view.approveControl(review.id, review.revision);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: null } });
    assert.equal(f.view.getSnapshot().selectedAccountId, 'hd:60:1');
    assert.deepEqual(f.session.namespaces.eip155!.accounts, [`eip155:1:${ADDRESS}`]);
    const signing = await messageRequest(f, 'personal_sign', ['hello', ADDRESS], 11);
    assert(signing?.kind === 'message' && signing.needsAccountSwitch);
    assert.equal(f.signatures.length, 0);
  } finally { await f.controller.dispose(); }
});

test('permission requests cannot silently request new caveats or unnegotiated methods', async () => {
  const f = await connectedFixture();
  try {
    const before = structuredClone([...f.rows]);
    await messageRequest(f, 'wallet_requestPermissions', [{ eth_accounts: { caveats: [] } }]);
    assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, 4200);
    Object.assign(f.session.namespaces.eip155!, { methods: f.session.namespaces.eip155!.methods.filter(value => value !== 'wallet_getPermissions') });
    await messageRequest(f, 'wallet_getPermissions', [], 11);
    assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, 4100);
    assert.deepEqual([...f.rows], before);
  } finally { await f.controller.dispose(); }
});

test('nonempty permission revocation immediately retires signing, controls and held public reads', async () => {
  const f = await connectedFixture();
  const held = Promise.withResolvers<void>();
  try {
    const signing = await messageRequest(f);
    assert(signing);
    await messageRequest(f, 'wallet_switchEthereumChain', [{ chainId: '0xa' }], 11);
    f.setReadWait(held.promise);
    await messageRequest(f, 'eth_blockNumber', [], 12);
    await messageRequest(f, 'wallet_revokePermissions', [{ eth_accounts: {} }], 13);
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(f.view.getSnapshot().controlReview, null);
    assert.equal(f.view.getSnapshot().sessions.length, 0);
    held.resolve(); await settle();
    assert.deepEqual(f.responses, [{ id: 13, result: { result: null } }]);
    assert.equal(f.signatures.length, 0);
    assert.equal(f.controlCommits.length, 0);
    assert.equal((await f.repository).permissions(f.session.binding).read().dapps[ORIGIN], undefined);
  } finally { held.resolve(); await f.controller.dispose(); }
});

test('empty permission revocation retains the grant and connection', async () => {
  const f = await connectedFixture();
  try {
    await messageRequest(f, 'wallet_revokePermissions', [{}]);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: null } });
    assert.equal(f.view.getSnapshot().sessions.length, 1);
    await messageRequest(f, 'wallet_getPermissions', [], 11);
    assert.equal((f.responses.at(-1) as { result: { result: unknown[] } }).result.result.length, 2);
  } finally { await f.controller.dispose(); }
});
test('revocation waits for its existing durable grant engine and leaves a different peer claiming the same origin alone', async () => {
  const f = await connectedFixture();
  const held = Promise.withResolvers<void>();
  try {
    const repository = await f.repository;
    const peerSession = { ...f.session, binding: { ...f.session.binding, topic: 'ef'.repeat(32), peerPublicKey: '12'.repeat(32) } };
    const original = repository.permissions(f.session.binding), peer = repository.permissions(peerSession.binding);
    const frame = structuredClone(original.read());
    await peer.exclusive(async () => { await peer.write(frame); peer.publish(frame); });
    f.event({ type: 'session', session: peerSession });
    assert.equal(f.view.getSnapshot().sessions.length, 2);
    f.setStorageWait(held.promise);
    await messageRequest(f, 'wallet_revokePermissions', [{ eth_accounts: {} }]);
    assert.equal(original.read().dapps[ORIGIN], undefined);
    assert(peer.read().dapps[ORIGIN]);
    assert.deepEqual(f.responses, []);
    held.resolve(); for (let i = 0; i < 3; i++) await settle();
    assert.deepEqual(f.responses, [{ id: 10, result: { result: null } }]);
    assert.equal(f.view.getSnapshot().sessions.length, 1);
    assert(peer.read().dapps[ORIGIN]);
  } finally { held.resolve(); await f.controller.dispose(); }
});

test('authorized stateless reads normalize parameters and preserve EVM revert data', async () => {
  const f = await connectedFixture();
  try {
    await messageRequest(f, 'eth_getBalance', [ADDRESS]);
    assert.deepEqual(f.readRequests, [{ method: 'eth_getBalance', params: [ADDRESS, 'latest'] }]);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: '0x42' } });
    f.failRead(new EthereumRpcErrorHandler(3, 'execution reverted', '0xdead'));
    await messageRequest(f, 'eth_call', [{ to: ADDRESS }], 11);
    assert.deepEqual(f.responses.at(-1), { id: 11, result: { error: { code: 3, message: 'execution reverted', data: '0xdead' } } });
  } finally { await f.controller.dispose(); }
});

for (const [method, params] of [
  ['eth_getLogs', [{ topics: [null] }]], ['eth_getProof', [ADDRESS, ['0XABC'], null]],
  ['web3_clientVersion', []], ['net_listening', []], ['net_peerCount', []],
  ['personal_ecRecover', ['public text', 'compact-signature']],
  ['eth_coinbase', []], ['web3_sha3', ['0x1234']],
  ['eth_getFilterChanges', ['opaque-filter-ID']], ['eth_getFilterLogs', ['opaque-filter-ID']],
  ['eth_newBlockFilter', []], ['eth_newFilter', [{}]], ['eth_newPendingTransactionFilter', [null]],
  ['eth_uninstallFilter', ['opaque-filter-ID']], ['eth_getWork', []], ['eth_hashrate', []], ['eth_mining', []],
  ['eth_submitHashrate', ['0x01', `0x${'11'.repeat(32)}`]],
  ['eth_submitWork', ['0x0000000000000001', `0x${'11'.repeat(32)}`, `0x${'22'.repeat(32)}`]],
] as const) test(`${method} is negotiated as a public RPC operation and never opens signing consent`, async () => {
  const f = await connectedFixture();
  try {
    assert(f.session.namespaces.eip155!.methods.includes(method));
    await messageRequest(f, method, params);
    assert.deepEqual(f.readRequests, [{ method, params }]);
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(f.signatures.length, 0);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: '0x42' } });
  } finally { await f.controller.dispose(); }
});

for (const mismatch of ['chain', 'method', 'account', 'origin', 'parameters'] as const) test(`stateless read rejects ${mismatch} before provider access`, async () => {
  const f = await connectedFixture();
  try {
    if (mismatch === 'chain') f.selectChain(10);
    if (mismatch === 'method') Object.assign(f.session.namespaces.eip155!, { methods: f.session.namespaces.eip155!.methods.filter(value => value !== 'eth_getBalance') });
    if (mismatch === 'account') Object.assign(f.session.namespaces.eip155!, { accounts: [`eip155:1:0x${'22'.repeat(20)}`] });
    const session = mismatch === 'origin' ? { ...f.session, binding: { ...f.session.binding, origin: 'https://other.example' } } : f.session;
    f.event({ type: 'request', request: { freshness: 'fresh', id: 10, session, chainId: 'eip155:1', method: 'eth_getBalance', params: mismatch === 'parameters' ? ['invalid'] : [ADDRESS], expiresAt: Date.now() + 300000, verification: UNKNOWN } });
    await settle();
    assert.equal(f.readRequests.length, 0);
    assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, mismatch === 'chain' ? 4901 : mismatch === 'parameters' ? -32602 : 4100);
  } finally { await f.controller.dispose(); }
});

for (const change of ['lock', 'network', 'session', 'expiry', 'dispose'] as const) test(`held stateless read is retired on ${change}`, async () => {
  const f = await connectedFixture();
  const held = Promise.withResolvers<void>(), readNow = Date.now;
  let now = readNow(), disposing: Promise<void> | undefined;
  Date.now = () => now;
  try {
    f.setReadWait(held.promise);
    await messageRequest(f, 'eth_blockNumber', []);
    assert.equal(f.readRequests.length, 1);
    if (change === 'lock') f.lock();
    else if (change === 'network') f.selectChain(10);
    else if (change === 'session') f.event({ type: 'session-ended', topic: TOPIC });
    else if (change === 'expiry') now += 300001;
    else disposing = f.controller.dispose();
    held.resolve(); await settle(); await disposing;
    assert.deepEqual(f.responses, []);
  } finally { Date.now = readNow; held.resolve(); await f.controller.dispose(); }
});

test('shared pending budgets count reads alongside signing and controls and discard duplicate wire IDs', async () => {
  const f = await connectedFixture();
  const held = Promise.withResolvers<void>();
  try {
    f.setReadWait(held.promise);
    for (let id = 10; id < 14; id++) await messageRequest(f, 'eth_blockNumber', [], id);
    await messageRequest(f, 'eth_blockNumber', [], 10);
    assert.equal(f.readRequests.length, 4);
    await messageRequest(f, 'wallet_switchEthereumChain', [{ chainId: '0xa' }], 14);
    await messageRequest(f, 'personal_sign', ['hello', ADDRESS], 15);
    assert.deepEqual(f.responses.map(value => (value as { result: { error: { code: number } } }).result.error.code), [-32005, -32005]);
    f.lock(); held.resolve(); await settle();
    assert.equal(f.responses.length, 2);
  } finally { held.resolve(); await f.controller.dispose(); }
});

for (const method of ['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_watchAsset'] as const) test(`${method} requires its exact public control approval before mutation and responds on the original request`, async () => {
  const f = await connectedFixture();
  try {
    const params = method === 'wallet_watchAsset'
      ? [{ type: 'ERC20', options: { address: `0x${'12'.repeat(20)}`, symbol: 'Untrusted symbol' } }]
      : [{ chainId: method === 'wallet_switchEthereumChain' ? '0xa' : '0x89', ...(method === 'wallet_addEthereumChain' ? { rpcUrls: ['https://claimed.example'], chainName: 'Claimed chain' } : {}) }];
    await messageRequest(f, method, params, 801);
    const review = f.view.getSnapshot().controlReview;
    assert.ok(review); assert.equal(review.origin, ORIGIN); assert.equal(review.verification.validation, 'UNKNOWN');
    assert.equal(f.controlCommits.length, 0); assert.equal(f.view.getSnapshot().signingReview, null);
    assert.ok(review.details);
    if (review.details.kind === 'watch-asset') assert.equal(review.details.symbol, 'OBS');
    await assert.rejects(f.view.approveControl(review.id, review.revision - 1));
    await f.view.approveControl(review.id, f.view.getSnapshot().revision);
    assert.equal(f.controlCommits.length, 1); assert.equal(f.view.getSnapshot().controlReview, null);
    assert.deepEqual(f.responses.at(-1), { id: 801, result: { result: method === 'wallet_watchAsset' ? true : null } });
    assert.deepEqual(f.session.namespaces.eip155!.chains, ['eip155:1']);
  } finally { await f.controller.dispose(); }
});

test('control requests cannot bypass method, source-chain, origin or blacklist isolation', async () => {
  const f = await connectedFixture();
  try {
    f.blockSite();
    await messageRequest(f, 'wallet_switchEthereumChain', [{ chainId: '0xa' }]);
    const review = f.view.getSnapshot().controlReview;
    assert.ok(review); assert.equal(review.error, 'BLOCKED_SITE');
    await assert.rejects(f.view.approveControl(review.id, f.view.getSnapshot().revision));
    assert.equal(f.controlCommits.length, 0);
    await f.view.rejectControl(review.id);
    await messageRequest(f, 'wallet_watchAsset', [{ type: 'ERC1155', options: { address: `0x${'12'.repeat(20)}`, tokenId: 2 ** 53 } }], 802);
    assert.equal(f.view.getSnapshot().controlReview, null);
    assert.equal((f.responses.at(-1) as any).result.error.code, -32602);
    f.event({ type: 'request', request: { freshness: 'fresh', id: 803, session: { ...f.session, binding: { ...f.session.binding, origin: 'https://different.example' } }, method: 'wallet_switchEthereumChain', chainId: 'eip155:1', params: [{ chainId: '0xa' }], verification: UNKNOWN, expiresAt: Date.now() + 60000 } });
    await settle(); assert.equal(f.view.getSnapshot().controlReview, null); assert.equal(f.controlCommits.length, 0);
  } finally { await f.controller.dispose(); }
});

test('control and signing requests share their foreground order and cannot use another review command', async () => {
  const f = await connectedFixture();
  try {
    await messageRequest(f, 'wallet_watchAsset', [{ type: 'ERC20', options: { address: `0x${'12'.repeat(20)}` } }], 811);
    const control = f.view.getSnapshot().controlReview!;
    await messageRequest(f, 'personal_sign', ['Queued after control', ADDRESS], 812);
    assert.equal(f.view.getSnapshot().signingReview, null);
    await f.view.rejectControl(control.id); await settle();
    const message = f.view.getSnapshot().signingReview;
    assert.ok(message); assert.equal(message.method, 'personal_sign');
    await f.view.rejectRequest(message.id);
    await messageRequest(f, 'personal_sign', ['First signing request', ADDRESS], 813);
    await messageRequest(f, 'wallet_watchAsset', [{ type: 'ERC20', options: { address: `0x${'12'.repeat(20)}` } }], 814);
    assert.equal(f.view.getSnapshot().controlReview, null);
    const first = f.view.getSnapshot().signingReview!; await f.view.rejectRequest(first.id); await settle();
    assert.ok(f.view.getSnapshot().controlReview);
  } finally { await f.controller.dispose(); }
});

test('return-to-dapp is a separate explicit origin-only action and never follows incoming metadata automatically', async () => {
  const f = await connectedFixture();
  try {
    const session = f.view.getSnapshot().sessions[0]!;
    assert.deepEqual(f.externalUrls, []); assert.equal(session.returnTarget?.url, `${ORIGIN}/`); assert.equal(session.returnTarget?.verification.validation, 'UNKNOWN');
    await f.view.returnToDapp(session.id, f.view.getSnapshot().revision);
    assert.deepEqual(f.externalUrls, [`${ORIGIN}/`]);
    f.refresh(); await assert.rejects(f.view.returnToDapp(session.id, session.returnTarget ? 0 : -1));
    f.blockSite(); await assert.rejects(f.view.returnToDapp(session.id, f.view.getSnapshot().revision));
    assert.equal(f.externalUrls.length, 1);
  } finally { await f.controller.dispose(); }
});

for (const smart of [false, true])
  test(`capabilities reflect native batching support for ${
    smart ? 'Smart' : 'software'
  } accounts`, async () => {
    const f = await connectedFixture({
      capabilities: true,
      smart,
      accountId: smart ? 'smart:60:0' : 'hd:60:0',
    });
    try {
      assert(
        f.session.namespaces.eip155!.methods.includes('wallet_getCapabilities')
      );
      const persisted = JSON.stringify([...f.rows]);
      await messageRequest(f, 'wallet_getCapabilities', [ADDRESS]);
      assert.deepEqual(f.responses.at(-1), {
        id: 10,
        result: { result: { '0x1': smart ? {} : { atomic: { status: 'unsupported' } } } },
      });
      assert.equal(f.view.getSnapshot().signingReview, null);
      assert.equal(f.signatures.length, 0);
      assert.equal(f.transactions.length, 0);
      assert.equal(JSON.stringify([...f.rows]), persisted);
      assert.deepEqual(f.session.namespaces.eip155!.chains, ['eip155:1']);
    } finally {
      await f.controller.dispose();
    }
  });

for (const [params, expected] of [
  [undefined, { '0x1': { atomic: { status: 'unsupported' } } }],
  [[], { '0x1': { atomic: { status: 'unsupported' } } }],
  [[ADDRESS, ['0x01']], { '0x1': { atomic: { status: 'unsupported' } } }],
  [[ADDRESS, ['0x1', '0x2']], { '0x1': { atomic: { status: 'unsupported' } } }],
  [[ADDRESS, ['0x2']], {}],
  [[ADDRESS, []], {}],
] as const)
  test(`restored capabilities respect the requested chain filter ${JSON.stringify(
    params
  )}`, async () => {
    const f = fixture({ restoring: true, capabilities: true });
    try {
      await settle();
      await settle();
      if (params === undefined) {
        f.event({
          type: 'request',
          request: { freshness: 'fresh',
            id: 10,
            method: 'wallet_getCapabilities',
            params: undefined,
            session: f.session,
            chainId: 'eip155:1',
            expiresAt: Date.now() + 300000,
            verification: UNKNOWN,
          },
        });
        await settle();
      } else await messageRequest(f, 'wallet_getCapabilities', params);
      assert.deepEqual(f.responses.at(-1), {
        id: 10,
        result: { result: expected },
      });
    } finally {
      await f.controller.dispose();
    }
  });

for (const params of [
  null,
  [null],
  [ADDRESS, null],
  [ADDRESS, ['bad']],
  [ADDRESS, [], 'extra'],
]) {
  test(`native capabilities reject malformed parameters ${JSON.stringify(
    params
  )}`, async () => {
    const f = await connectedFixture({ capabilities: true });
    try {
      await messageRequest(f, 'wallet_getCapabilities', params);
      assert.deepEqual(f.responses.at(-1), {
        id: 10,
        result: {
          error: { code: -32602, message: 'Invalid capability query params' },
        },
      });
    } finally {
      await f.controller.dispose();
    }
  });
}

test('capabilities require the granted account and negotiated method', async () => {
  for (const capabilities of [true, false]) {
    const f = await connectedFixture({ capabilities, secondAccount: true });
    try {
      const requested = capabilities ? `0x${'22'.repeat(20)}` : ADDRESS;
      await messageRequest(f, 'wallet_getCapabilities', [requested]);
      const response = f.responses.at(-1) as {
        result: { error: { code: number } };
      };
      assert.equal(response.result.error.code, 4100);
      assert.equal(f.view.getSnapshot().signingReview, null);
    } finally {
      await f.controller.dispose();
    }
  }
});

test('capabilities use the granted non-active account without selecting it', async () => {
  const f = await connectedFixture({
    capabilities: true,
    secondAccount: true,
    accountId: 'hd:60:1',
  });
  try {
    const before = f.view.getSnapshot();
    assert.equal(before.selectedAccountId, 'hd:60:0');
    await messageRequest(f, 'wallet_getCapabilities', [`0x${'22'.repeat(20)}`]);
    assert.deepEqual(f.responses.at(-1), {
      id: 10,
      result: { result: { '0x1': { atomic: { status: 'unsupported' } } } },
    });
    assert.equal(f.view.getSnapshot().selectedAccountId, 'hd:60:0');
    assert.equal(f.view.getSnapshot().signingReview, null);
  } finally {
    await f.controller.dispose();
  }
});

for (const field of ['origin', 'peerPublicKey', 'topic'] as const) {
  test(`capabilities cannot borrow a grant with another ${field}`, async () => {
    const f = await connectedFixture({ capabilities: true });
    try {
      f.event({
        type: 'request',
        request: { freshness: 'fresh',
          id: 10,
          method: 'wallet_getCapabilities',
          params: [ADDRESS],
          session: {
            ...f.session,
            binding: {
              ...f.session.binding,
              [field]:
                field === 'origin' ? 'https://other.example' : 'f'.repeat(64),
            },
          },
          chainId: 'eip155:1',
          expiresAt: Date.now() + 300000,
          verification: UNKNOWN,
        },
      });
      await settle();
      const response = f.responses.at(-1) as {
        result: { error: { code: number } };
      };
      assert.equal(response.result.error.code, 4100);
    } finally {
      await f.controller.dispose();
    }
  });
}

test('capabilities do not expand an approved chain after network selection changes', async () => {
  const f = await connectedFixture({ capabilities: true });
  try {
    f.selectChain(10);
    await settle();
    const persisted = JSON.stringify([...f.rows]);
    await messageRequest(f, 'wallet_getCapabilities', [
      ADDRESS,
      ['0x1', '0xa'],
    ]);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: {} } });
    f.event({
      type: 'request',
      request: { freshness: 'fresh',
        id: 11,
        method: 'wallet_getCapabilities',
        params: [ADDRESS, ['0xa']],
        session: f.session,
        chainId: 'eip155:10',
        expiresAt: Date.now() + 300000,
        verification: UNKNOWN,
      },
    });
    await settle();
    const response = f.responses.at(-1) as {
      result: { error: { code: number } };
    };
    assert.equal(response.result.error.code, 4100);
    assert.equal(JSON.stringify([...f.rows]), persisted);
    assert.deepEqual(f.session.namespaces.eip155!.chains, ['eip155:1']);
  } finally {
    await f.controller.dispose();
  }
});

test('locking suppresses an in-flight capability reply and hides account capabilities', async () => {
  const f = await connectedFixture({ capabilities: true });
  let release!: () => void;
  try {
    f.setResponseWait(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    await messageRequest(f, 'wallet_getCapabilities', [ADDRESS]);
    f.lock();
    release();
    await settle();
    assert.equal(f.responses.length, 0);
    await messageRequest(f, 'wallet_getCapabilities', [ADDRESS], 11);
    const response = f.responses.at(-1) as {
      result: { error: { code: number } };
    };
    assert.equal(response.result.error.code, 4100);
  } finally {
    release?.();
    await f.controller.dispose();
  }
});

test('a dapp transaction stays unsigned until its exact review is approved', async () => {
  const f = await connectedFixture();
  try {
    const review = await messageRequest(f, 'eth_sendTransaction', [{
      from: ADDRESS, to: '0x' + '22'.repeat(20), value: '0x7', nonce: '0x4',
      data: '0x12345678', accessList: [{ address: '0x' + '33'.repeat(20), storageKeys: [] }],
    }]);
    assert.ok(review?.kind === 'transaction');
    assert.equal(review.transaction?.value, '7');
    assert.equal(review.transaction?.nonce, '4');
    assert.equal(review.maximumFeeUnits, '500000');
    assert.equal(f.transactions.length, 0);
    await f.view.approveRequest(review.id, review.revision, false);
    assert.equal(f.transactions.length, 1);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: '0x' + '34'.repeat(32) } });
    assert.equal(f.view.getSnapshot().signingReview, null);
  } finally { await f.controller.dispose(); }
});

test('a dapp transaction cannot choose a different signer or chain', async () => {
  const f = await connectedFixture();
  try {
    for (const transaction of [{ from: '0x' + '22'.repeat(20) }, { chainId: '0x2' }]) {
      const review = await messageRequest(f, 'eth_sendTransaction', [transaction]);
      assert.equal(review, null);
      assert.deepEqual(f.responses.at(-1), { id: 10, result: { error: { code: -32602, message: 'Invalid signing request' } } });
    }
    assert.equal(f.transactions.length, 0);
  } finally { await f.controller.dispose(); }
});

test('editing an ERC20 allowance creates a new exact review before signing', async () => {
  const f = await connectedFixture();
  const contract = '0x' + '22'.repeat(20), spender = '0x' + '33'.repeat(20);
  const abi = new Interface(['function approve(address,uint256)']);
  const original = { to: contract, data: abi.encodeFunctionData('approve', [spender, (1n << 256n) - 1n]) };
  f.setApprovalMetadata({ standard: 'ERC-20', token: { contractAddress: contract, name: 'Example', symbol: 'TOK', decimals: 6 } });
  try {
    const first = await messageRequest(f, 'eth_sendTransaction', [original]);
    assert.ok(first?.kind === 'transaction');
    assert.equal(first.approval?.isUnlimited, true);
    await f.view.editApprovalAmount(first.id, first.revision, '1.5');
    const next = f.view.getSnapshot().signingReview;
    assert.ok(next?.kind === 'transaction');
    assert.notEqual(next.revision, first.revision);
    assert.equal(next.approval?.amountUnits, '1500000');
    assert.equal(next.transaction?.data, abi.encodeFunctionData('approve', [spender, 1500000]));
    assert.equal(original.data, abi.encodeFunctionData('approve', [spender, (1n << 256n) - 1n]));
    assert.equal(f.preparedTransactions.length, 2);
    assert.equal(f.transactions.length, 0);
    await assert.rejects(f.view.approveRequest(first.id, first.revision, false));
    const current = f.view.getSnapshot().signingReview!;
    await f.view.approveRequest(current.id, current.revision, false);
    assert.equal(f.transactions.length, 1);
  } finally { await f.controller.dispose(); }
});

test('queued requests retain the foreground prepared identity until an allowance edit replaces it', async () => {
  const f = await connectedFixture();
  const contract = '0x' + '22'.repeat(20), abi = new Interface(['function approve(address,uint256)']);
  f.setApprovalMetadata({ standard: 'ERC-20', token: { contractAddress: contract, name: 'Example', symbol: 'TOK', decimals: 6 } });
  try {
    const first = await messageRequest(f, 'eth_sendTransaction', [{ to: contract, data: abi.encodeFunctionData('approve', [ADDRESS, 7]) }]);
    assert.ok(first?.kind === 'transaction');
    const queued = await messageRequest(f, 'personal_sign', ['Queued request', ADDRESS], 11);
    assert.ok(queued?.kind === 'transaction');
    assert.equal(queued.id, first.id);
    assert.notEqual(queued.revision, first.revision);
    assert.strictEqual(queued.transaction, first.transaction);
    assert.strictEqual(queued.approval, first.approval);
    await f.view.editApprovalAmount(queued.id, queued.revision, '1.5');
    const updated = f.view.getSnapshot().signingReview;
    assert.ok(updated?.kind === 'transaction');
    assert.equal(updated.id, first.id);
    assert.notStrictEqual(updated.transaction, first.transaction);
    assert.notStrictEqual(updated.approval, first.approval);
    assert.equal(updated.approval?.amountUnits, '1500000');
    assert.equal(f.transactions.length, 0);
  } finally { await f.controller.dispose(); }
});

test('unverified token approvals cannot be edited', async () => {
  const f = await connectedFixture();
  const abi = new Interface(['function approve(address,uint256)']);
  try {
    const review = await messageRequest(f, 'eth_sendTransaction', [{ to: '0x' + '22'.repeat(20), data: abi.encodeFunctionData('approve', [ADDRESS, 7]) }]);
    assert.ok(review?.kind === 'transaction');
    assert.equal(review.approval?.standardVerified, false);
    await assert.rejects(f.view.editApprovalAmount(review.id, review.revision, '1'));
    assert.equal(f.preparedTransactions.length, 1);
    assert.equal(f.transactions.length, 0);
  } finally { await f.controller.dispose(); }
});

for (const transition of ['lock', 'expiry'] as const) test(`${transition} during allowance re-preparation discards the new approval`, async () => {
  const f = await connectedFixture();
  const contract = '0x' + '22'.repeat(20), abi = new Interface(['function approve(address,uint256)']);
  f.setApprovalMetadata({ standard: 'ERC-20', token: { contractAddress: contract, name: 'Example', symbol: 'TOK', decimals: 6 } });
  try {
    const review = await messageRequest(f, 'eth_sendTransaction', [{ to: contract, data: abi.encodeFunctionData('approve', [ADDRESS, 7]) }]);
    assert.ok(review?.kind === 'transaction');
    let finish!: () => void;
    f.setPreparationWait(new Promise<void>((resolve) => { finish = resolve; }));
    const editing = f.view.editApprovalAmount(review.id, review.revision, '0');
    const rejected = assert.rejects(editing);
    if (transition === 'lock') f.lock();
    else { f.event({ type: 'request-expired', id: 10 }); await settle(); }
    finish();
    await rejected;
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(f.transactions.length, 0);
  } finally { await f.controller.dispose(); }
});

test('a transaction estimate failure remains visible without authorizing or reporting user rejection', async () => {
  const f = await connectedFixture();
  try {
    f.failTransactionPreparation();
    const review = await messageRequest(f, 'eth_sendTransaction', [{ data: '0x6000' }]);
    assert.ok(review?.kind === 'transaction');
    assert.equal(review.error, 'TRANSACTION_UNAVAILABLE');
    assert.equal(review.busy, false);
    assert.equal(f.transactions.length, 0);
    assert.equal(f.responses.length, 0);
    await assert.rejects(f.view.approveRequest(review.id, review.revision, false));
    await f.view.rejectRequest(review.id);
    assert.equal(f.responses.length, 1);
  } finally { await f.controller.dispose(); }
});

test('uncertain dapp transaction delivery keeps its hash and cannot send a later rejection', async () => {
  const f = await connectedFixture();
  try {
    const review = await messageRequest(f, 'eth_sendTransaction', [{ data: '0x6000' }]);
    assert.ok(review?.kind === 'transaction');
    assert.equal(review.transaction?.to, null);
    f.failDispatch();
    await assert.rejects(f.view.approveRequest(review.id, review.revision, false));
    const uncertain = f.view.getSnapshot().signingReview;
    assert.ok(uncertain?.kind === 'transaction');
    assert.equal(uncertain.broadcastHash, '0x' + '34'.repeat(32));
    assert.equal(uncertain.error, 'DELIVERY_UNCERTAIN');
    const count = f.responses.length;
    await f.view.rejectRequest(review.id);
    assert.equal(f.responses.length, count);
    assert.equal(f.transactions.length, 1);
  } finally { await f.controller.dispose(); }
});

test('leaving the connection screen preserves its incoming message review', async () => {
  const f = await connectedFixture();
  try {
    const review = await messageRequest(f);
    assert.ok(review);
    // NativeConnections unmounts when NativeWallet presents this review.
    f.view.cancel();
    const current = f.view.getSnapshot().signingReview;
    assert.equal(current?.id, review.id);
    assert.equal(f.responses.length, 0);
    await f.view.approveRequest(current!.id, current!.revision, false);
    assert.equal((f.responses.at(-1) as any).id, 10);
    assert.equal((f.responses.at(-1) as any).result.result, '0x' + '12'.repeat(65));
  } finally {
    await f.controller.dispose();
  }
});

const typedMessage = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ],
    Note: [{ name: 'contents', type: 'string' }],
  },
  primaryType: 'Note',
  domain: { name: 'Fixture', chainId: 1 },
  message: { contents: 'Hello Pali' },
};

for (const [method, payload] of [
  ['personal_sign', 'Hello Pali'],
  [
    'eth_signTypedData',
    [{ name: 'Message', type: 'string', value: 'Hello Pali' }],
  ],
  ['eth_signTypedData_v3', typedMessage],
  ['eth_signTypedData_v4', typedMessage],
] as const) {
  test(`${method} signs only the immutable reviewed request after explicit approval`, async () => {
    const f = await connectedFixture();
    try {
      const params =
        method === 'personal_sign' ? [payload, ADDRESS] : [ADDRESS, payload];
      const review = await messageRequest(f, method, params);
      assert.ok(review);
      assert.equal(review.method, method);
      assert.equal(review.error, null);
      assert.equal(review.busy, false);
      assert.equal(Object.isFrozen(review), true);
      assert.equal(f.signatures.length, 0);
      assert.equal(JSON.stringify(review).includes(PEER), false);
      assert.equal(JSON.stringify(review).includes(TOPIC), false);
      await f.view.approveRequest(review.id, review.revision, false);
      assert.equal(f.signatures.length, 1);
      assert.deepEqual(f.responses.at(-1), {
        id: 10,
        result: { result: '0x' + '12'.repeat(65) },
      });
      assert.equal(f.view.getSnapshot().signingReview, null);
    } finally {
      await f.controller.dispose();
    }
  });
}

test('personal-sign review preserves its captured bytes after the source array changes', async () => {
  const f = await connectedFixture();
  try {
    const params = ['Hello Pali', ADDRESS];
    const review = await messageRequest(f, 'personal_sign', params);
    assert.ok(review);
    params[0] = 'Different payload';
    await f.view.approveRequest(review.id, review.revision, false);
    assert.equal(
      (f.signatures[0] as { message: string }).message,
      'Hello Pali'
    );
  } finally {
    await f.controller.dispose();
  }
});

for (const transition of [
  'lock',
  'revision',
  'reject',
  'expiry',
  'disconnect',
  'replacement',
] as const) {
  test(`${transition} irreversibly retires a pending message review`, async () => {
    const f = await connectedFixture();
    try {
      const review = await messageRequest(f);
      assert.ok(review);
      if (transition === 'lock') f.lock();
      else if (transition === 'revision') f.refresh();
      else if (transition === 'reject') await f.view.rejectRequest(review.id);
      else if (transition === 'expiry')
        f.event({ type: 'request-expired', id: 10 });
      else if (transition === 'disconnect')
        await f.view.disconnect(f.view.getSnapshot().sessions[0]!.id);
      else f.event({ type: 'session', session: { ...f.session } });
      await settle();
      assert.equal(f.view.getSnapshot().signingReview, null);
      await assert.rejects(
        f.view.approveRequest(review.id, review.revision, false)
      );
      assert.equal(f.signatures.length, 0);
      assert.equal(
        f.responses.some((row: any) => row.result.result),
        false
      );
    } finally {
      await f.controller.dispose();
    }
  });
}

for (const delayed of ['signer', 'response'] as const) {
  test(`locking while the ${delayed} is pending suppresses a signature response`, async () => {
    const f = await connectedFixture();
    let release!: () => void;
    try {
      const review = await messageRequest(f);
      assert.ok(review);
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (delayed === 'signer') f.setSignWait(wait);
      else f.setResponseWait(wait);
      const signing = f.view.approveRequest(review.id, review.revision, false);
      const rejected = assert.rejects(signing);
      await settle();
      f.lock();
      release();
      await rejected;
      assert.equal(
        f.responses.some((row: any) => row.result.result),
        false
      );
    } finally {
      release?.();
      await f.controller.dispose();
    }
  });
}

test('a granted non-active account requires an explicit switch before its fresh message review', async () => {
  const f = await connectedFixture({
    secondAccount: true,
    accountId: 'hd:60:1',
  });
  try {
    const review = await messageRequest(f, 'personal_sign', [
      'Hello',
      '0x' + '22'.repeat(20),
    ]);
    assert.ok(review);
    assert.equal(review.needsAccountSwitch, true);
    await assert.rejects(
      f.view.approveRequest(review.id, review.revision, false)
    );
    await f.view.activateRequestAccount(
      review.id,
      f.view.getSnapshot().revision
    );
    const switched = f.view.getSnapshot().signingReview;
    assert.ok(switched);
    assert.equal(switched.needsAccountSwitch, false);
    await f.view.approveRequest(switched.id, switched.revision, false);
    assert.equal(f.signatures.length, 1);
  } finally {
    await f.controller.dispose();
  }
});

for (const malicious of [
  'site',
  'siwe',
  'wrong-address',
  'invalid-typed',
] as const) {
  test(`${malicious} cannot reach the message signer`, async () => {
    const f = await connectedFixture();
    try {
      if (malicious === 'site') f.blockSite();
      const params =
        malicious === 'siwe'
          ? [
              'evil.example wants you to sign in with your Ethereum account:\n' +
                ADDRESS,
              ADDRESS,
            ]
          : malicious === 'wrong-address'
          ? ['Hello', '0x' + '22'.repeat(20)]
          : malicious === 'invalid-typed'
          ? [ADDRESS, { ...typedMessage, types: null }]
          : ['Hello', ADDRESS];
      const review = await messageRequest(
        f,
        malicious === 'invalid-typed'
          ? 'eth_signTypedData_v4'
          : 'personal_sign',
        params
      );
      if (review) {
        assert.ok(review.error);
        await assert.rejects(
          f.view.approveRequest(review.id, review.revision, false)
        );
      }
      assert.equal(f.signatures.length, 0);
      assert.equal(
        f.responses.some((row: any) => row.result.result),
        false
      );
    } finally {
      await f.controller.dispose();
    }
  });
}

test('typed address advisories require fresh explicit acknowledgment before signing', async () => {
  const f = await connectedFixture();
  try {
    f.blockAddress();
    const typed = {
      ...typedMessage,
      types: { ...typedMessage.types, Note: [{ name: 'to', type: 'address' }] },
      message: { to: '0x' + '33'.repeat(20) },
    };
    const review = await messageRequest(f, 'eth_signTypedData_v4', [
      ADDRESS,
      typed,
    ]);
    assert.ok(review);
    assert.equal(review.requiresWarningAcknowledgement, true);
    assert.equal(review.advisories[0]?.address, typed.message.to);
    assert.equal(review.advisories[0]?.severity, 'high');
    await assert.rejects(
      f.view.approveRequest(review.id, review.revision, false)
    );
    assert.equal(f.signatures.length, 0);
    const current = f.view.getSnapshot().signingReview!;
    await f.view.approveRequest(current.id, current.revision, true);
    assert.equal(f.signatures.length, 1);
  } finally {
    await f.controller.dispose();
  }
});

test('a pending site check cannot enable signing or publish after lock', async () => {
  const f = await connectedFixture();
  let release!: () => void;
  try {
    f.setSiteWait(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const review = await messageRequest(f);
    assert.ok(review);
    assert.equal(review.busy, true);
    await assert.rejects(
      f.view.approveRequest(review.id, review.revision, false)
    );
    f.lock();
    release();
    await settle();
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(f.signatures.length, 0);
  } finally {
    release?.();
    await f.controller.dispose();
  }
});

test('the same reported origin on an unapproved peer cannot use a saved grant', async () => {
  const f = await connectedFixture();
  try {
    f.event({
      type: 'request',
      request: { freshness: 'fresh',
        id: 50,
        chainId: 'eip155:1',
        method: 'personal_sign',
        params: ['Hello', ADDRESS],
        expiresAt: Date.now() + 300000,
        verification: UNKNOWN,
        session: {
          ...f.session,
          binding: { ...f.session.binding, peerPublicKey: 'aa'.repeat(32) },
        },
      },
    });
    await settle();
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(f.signatures.length, 0);
    assert.equal((f.responses.at(-1) as any).result.error.code, 4100);
  } finally {
    await f.controller.dispose();
  }
});

test('expired requests never produce a review and queued messages advance after rejection', async () => {
  const f = await connectedFixture();
  try {
    f.event({
      type: 'request',
      request: { freshness: 'fresh',
        id: 50,
        session: f.session,
        chainId: 'eip155:1',
        method: 'personal_sign',
        params: ['Expired', ADDRESS],
        expiresAt: Date.now() - 1,
        verification: UNKNOWN,
      },
    });
    await settle();
    assert.equal(f.view.getSnapshot().signingReview, null);
    const first = await messageRequest(f);
    assert.ok(first);
    await messageRequest(f, 'personal_sign', ['Next', ADDRESS], 11);
    assert.equal(f.view.getSnapshot().signingReview?.id, first.id);
    await f.view.rejectRequest(first.id);
    assert.equal(messageText(f.view.getSnapshot().signingReview), 'Next');
    f.lock();
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(f.signatures.length, 0);
  } finally {
    await f.controller.dispose();
  }
});

test('cancelling an account switch cannot recreate the retired message review', async () => {
  const f = await connectedFixture({
    secondAccount: true,
    accountId: 'hd:60:1',
  });
  let release!: () => void;
  try {
    const review = await messageRequest(f, 'personal_sign', [
      'Hello',
      '0x' + '22'.repeat(20),
    ]);
    assert.ok(review);
    f.setActivationWait(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const switching = f.view.activateRequestAccount(review.id, review.revision);
    const rejected = assert.rejects(switching);
    await settle();
    await f.view.rejectRequest(review.id);
    release();
    await rejected;
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(f.signatures.length, 0);
  } finally {
    release?.();
    await f.controller.dispose();
  }
});

test('only the displayed message can be signed and double approval is refused', async () => {
  const f = await connectedFixture();
  let release!: () => void;
  try {
    const first = await messageRequest(f);
    assert.ok(first);
    await messageRequest(f, 'personal_sign', ['Second', ADDRESS], 11);
    const current = f.view.getSnapshot();
    await assert.rejects(
      f.view.approveRequest('request-3', current.revision, false)
    );
    f.setSignWait(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const signing = f.view.approveRequest(
      first.id,
      f.view.getSnapshot().revision,
      false
    );
    await settle();
    await assert.rejects(
      f.view.approveRequest(first.id, f.view.getSnapshot().revision, false)
    );
    release();
    await signing;
    assert.equal(f.signatures.length, 1);
    assert.equal(messageText(f.view.getSnapshot().signingReview), 'Second');
  } finally {
    release?.();
    await f.controller.dispose();
  }
});

for (const verification of [
  { validation: 'INVALID', isScam: false },
  { validation: 'VALID', isScam: true },
] as const) {
  test(`proposal ${verification.validation}/scam=${verification.isScam} cannot open a session`, async () => {
    const f = fixture();
    try {
      await settle();
      await f.view.pair('wc:fixture');
      f.event({ type: 'proposal', proposal: { ...f.proposal, verification } });
      const snapshot = f.view.getSnapshot();
      assert.equal(snapshot.proposals[0]?.canApprove, false);
      assert.deepEqual(snapshot.proposals[0]?.verification, verification);
      await assert.rejects(
        f.view.approve(3, 'hd:60:0', 'ethereum', snapshot.revision),
        { message: verification.isScam ? 'BLOCKED_SITE' : 'SITE_MISMATCH' }
      );
      assert.equal(f.approved(), 0);
    } finally {
      await f.controller.dispose();
    }
  });
}

test('proposal approval checks the same blacklist before disclosing the account', async () => {
  const f = fixture();
  try {
    await settle();
    await f.view.pair('wc:fixture');
    f.blockSite();
    f.event({ type: 'proposal', proposal: f.proposal });
    await assert.rejects(
      f.view.approve(3, 'hd:60:0', 'ethereum', f.view.getSnapshot().revision),
      { message: 'BLOCKED_SITE' }
    );
    assert.equal(f.approved(), 0);
    assert.equal(f.view.getSnapshot().sessions.length, 0);
  } finally {
    await f.controller.dispose();
  }
});

for (const outcome of ['blocked', 'allowed', 'locked', 'unavailable'] as const) {
  test(`cold blacklist initialization gates native approval: ${outcome}`, async () => {
    let release!: () => void;
    const feed = new Promise<void>((resolve) => { release = resolve; });
    let fetched = 0;
    const originalAdapter = axios.defaults.adapter;
    // Exercise the real shared service with deferred feeds and no network.
    axios.defaults.adapter = async (config) => {
      fetched++;
      await feed;
      if (outcome === 'unavailable') throw new Error('Feed unavailable');
      const data = config.url?.endsWith('urls-darklist.json') && outcome === 'blocked'
        ? [{ id: new URL(ORIGIN).hostname, comment: 'Known phishing site' }]
        : config.url?.endsWith('addresses-darklist.json')
          ? [{ address: ADDRESS, comment: 'Known malicious address' }]
          : [];
      return { data, status: 200, statusText: 'OK', headers: {}, config };
    };
    let blacklist: typeof import('../../../source/utils/security/blacklistService.ts');
    try {
      // Each case starts with the same empty caches as a fresh native process.
      const source = new URL('../../../source/utils/security/blacklistService.ts', import.meta.url);
      blacklist = await import(`${source.href}?native-admission=${outcome}`);
    } finally {
      axios.defaults.adapter = originalAdapter;
    }
    const service = blacklist.blacklistService;
    const f = fixture({
      checkSite: (origin) => service.checkUrl(origin),
    });
    try {
      await settle();
      await f.view.pair('wc:fixture');
      f.event({ type: 'proposal', proposal: f.proposal });
      const approval = f.view.approve(3, 'hd:60:0', 'ethereum', f.view.getSnapshot().revision)
        .then(() => null, (error: Error) => error);
      await settle();
      let initialized = false;
      const initialization = service.initialize().then(() => { initialized = true; });
      let addressChecked = false;
      const address = service.checkAddress(ADDRESS.toUpperCase()).then((result) => {
        addressChecked = true;
        return result;
      });
      await settle();
      assert.equal(fetched, 5);
      assert.equal(f.approved(), 0);
      assert.equal(f.view.getSnapshot().sessions.length, 0);
      assert.equal(initialized, false);
      assert.equal(addressChecked, false);
      if (outcome === 'locked') f.lock();
      release();
      await initialization;
      assert.equal((await address).isBlacklisted, outcome !== 'unavailable');
      const error = await approval;
      if (outcome === 'allowed' || outcome === 'unavailable') {
        assert.equal(error, null);
        assert.equal(f.approved(), 1);
        assert.equal(f.view.getSnapshot().sessions.length, 1);
      } else {
        assert.match(error?.message ?? '', outcome === 'blocked' ? /BLOCKED_SITE/ : /CANCELLED|CONTEXT_CHANGED|LOCKED/);
        assert.equal(f.approved(), 0);
        assert.equal(f.view.getSnapshot().sessions.length, 0);
      }
      assert.equal(fetched, 5);
      assert.equal((await service.checkUrl('https://metmask.com')).isBlacklisted, true);
    } finally {
      release();
      await f.controller.dispose();
    }
  });
}

for (const verification of [
  { validation: 'INVALID', isScam: false },
  { validation: 'UNKNOWN', isScam: true },
] as const) {
  test(`message ${verification.validation}/scam=${verification.isScam} cannot borrow proposal verification`, async () => {
    const f = await connectedFixture({
      verification: { validation: 'VALID', isScam: false },
    });
    try {
      const review = await messageRequest(
        f,
        'personal_sign',
        ['Hello', ADDRESS],
        10,
        verification
      );
      assert.ok(review);
      assert.deepEqual(review.verification, verification);
      assert.equal(
        review.error,
        verification.isScam ? 'BLOCKED_SITE' : 'SITE_MISMATCH'
      );
      await assert.rejects(
        f.view.approveRequest(review.id, review.revision, false)
      );
      assert.equal(f.signatures.length, 0);
    } finally {
      await f.controller.dispose();
    }
  });
}

test('unknown verification stays visibly unknown without borrowing a positive badge', async () => {
  const f = await connectedFixture();
  try {
    const review = await messageRequest(f);
    assert.ok(review);
    assert.deepEqual(review.verification, UNKNOWN);
    assert.equal(review.error, null);
  } finally {
    await f.controller.dispose();
  }
});

for (const afterDispatch of ['lock', 'reject', 'expiry'] as const) {
  test(`${afterDispatch} after response dispatch preserves the successful delivery without a second response`, async () => {
    const f = await connectedFixture();
    let release!: () => void;
    try {
      const review = await messageRequest(f);
      assert.ok(review);
      f.setDispatchWait(
        new Promise<void>((resolve) => {
          release = resolve;
        })
      );
      const signing = f.view.approveRequest(review.id, review.revision, false);
      await settle();
      assert.equal(f.handedOff.length, 1);
      assert.equal(f.view.getSnapshot().signingReview?.dispatched, true);
      if (afterDispatch === 'lock') f.lock();
      else if (afterDispatch === 'reject')
        await f.view.rejectRequest(review.id);
      else f.event({ type: 'request-expired', id: 10 });
      release();
      await signing;
      assert.equal(f.handedOff.length, 1);
      assert.equal(f.responses.length, 1);
      assert.equal(f.view.getSnapshot().error, null);
      assert.ok((f.handedOff[0] as any).result.result);
    } finally {
      release?.();
      await f.controller.dispose();
    }
  });
}

test('an acknowledgment failure after dispatch reports uncertainty without retrying or rejecting', async () => {
  const f = await connectedFixture();
  try {
    const review = await messageRequest(f);
    assert.ok(review);
    f.failDispatch();
    await assert.rejects(
      f.view.approveRequest(review.id, review.revision, false),
      { message: 'DELIVERY_UNCERTAIN' }
    );
    assert.equal(f.handedOff.length, 1);
    assert.equal(
      f.view.getSnapshot().signingReview?.error,
      'DELIVERY_UNCERTAIN'
    );
    assert.equal(f.view.getSnapshot().signingReview?.dispatched, true);
    await assert.rejects(
      f.view.approveRequest(review.id, f.view.getSnapshot().revision, false)
    );
    assert.equal(f.handedOff.length, 1);
  } finally {
    await f.controller.dispose();
  }
});

test('a queued message stays unsigned while the displayed response is still being delivered', async () => {
  const f = await connectedFixture();
  let release!: () => void;
  try {
    const first = await messageRequest(f);
    assert.ok(first);
    await messageRequest(f, 'personal_sign', ['Queued', ADDRESS], 11);
    f.setDispatchWait(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const delivering = f.view.approveRequest(
      first.id,
      f.view.getSnapshot().revision,
      false
    );
    await settle();
    assert.equal(f.view.getSnapshot().signingReview?.id, first.id);
    assert.equal(f.view.getSnapshot().signingReview?.dispatched, true);
    await assert.rejects(
      f.view.approveRequest('request-3', f.view.getSnapshot().revision, false)
    );
    assert.equal(f.signatures.length, 1);
    release();
    await delivering;
    assert.equal(messageText(f.view.getSnapshot().signingReview), 'Queued');
  } finally {
    release?.();
    await f.controller.dispose();
  }
});

test('Reject prevents a held signing completion from changing a later message review', async () => {
  const f = await connectedFixture();
  let release!: () => void;
  try {
    const first = await messageRequest(f);
    assert.ok(first);
    f.setSignWait(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const signing = f.view.approveRequest(first.id, first.revision, false);
    const rejected = assert.rejects(signing);
    await settle();
    await f.view.rejectRequest(first.id);
    const later = await messageRequest(
      f,
      'personal_sign',
      ['Later message', ADDRESS],
      11
    );
    assert.ok(later);
    const beforeCompletion = f.view.getSnapshot();
    release();
    await rejected;
    assert.equal(f.view.getSnapshot(), beforeCompletion);
    assert.equal(f.view.getSnapshot().error, null);
    assert.equal(f.view.getSnapshot().signingReview?.id, later.id);
    await f.view.approveRequest(later.id, later.revision, false);
    assert.equal((f.responses.at(-1) as any).id, 11);
  } finally {
    release?.();
    await f.controller.dispose();
  }
});

test('Close prevents a dispatched failure from overwriting a later message review', async () => {
  const f = await connectedFixture();
  let release!: () => void;
  try {
    const first = await messageRequest(f);
    assert.ok(first);
    f.setDispatchWait(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const signing = f.view.approveRequest(first.id, first.revision, false);
    const rejected = assert.rejects(signing, { message: 'DELIVERY_UNCERTAIN' });
    await settle();
    assert.equal(f.view.getSnapshot().signingReview?.dispatched, true);
    await f.view.rejectRequest(first.id);
    const later = await messageRequest(
      f,
      'personal_sign',
      ['Later message', ADDRESS],
      11
    );
    assert.ok(later);
    const beforeCompletion = f.view.getSnapshot();
    f.failDispatch();
    release();
    await rejected;
    assert.equal(f.view.getSnapshot(), beforeCompletion);
    assert.equal(f.view.getSnapshot().error, null);
    assert.equal(f.view.getSnapshot().signingReview?.id, later.id);
    assert.equal(f.handedOff.length, 1);
    f.clearDispatchFailure();
    await f.view.approveRequest(later.id, later.revision, false);
    assert.equal((f.responses.at(-1) as any).id, 11);
  } finally {
    release?.();
    await f.controller.dispose();
  }
});

test('actions on an absent old message ID cannot overwrite the next review', async () => {
  const f = await connectedFixture();
  try {
    const first = await messageRequest(f);
    assert.ok(first);
    await f.view.rejectRequest(first.id);
    const later = await messageRequest(
      f,
      'personal_sign',
      ['Current message', ADDRESS],
      11
    );
    assert.ok(later);
    const current = f.view.getSnapshot();
    await assert.rejects(
      f.view.approveRequest(first.id, current.revision, false),
      { message: 'REQUEST_EXPIRED' }
    );
    assert.equal(f.view.getSnapshot(), current);
    await assert.rejects(
      f.view.activateRequestAccount(first.id, current.revision),
      { message: 'REQUEST_EXPIRED' }
    );
    assert.equal(f.view.getSnapshot(), current);
    await f.view.rejectRequest(first.id);
    assert.equal(f.view.getSnapshot(), current);
    assert.equal(f.view.getSnapshot().error, null);
    await f.view.approveRequest(later.id, later.revision, false);
    assert.equal((f.responses.at(-1) as any).id, 11);
  } finally {
    await f.controller.dispose();
  }
});

for (const method of ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'] as const) {
  test(`an asynchronous connection failure retires a pending ${method} review`, async () => {
    const f = await connectedFixture();
    let release!: () => void;
    try {
      const params = method === 'personal_sign'
        ? ['Pending message', ADDRESS]
        : method === 'eth_signTypedData_v4'
          ? [ADDRESS, typedMessage]
          : [{ from: ADDRESS, to: '0x' + '22'.repeat(20), value: '0x1' }];
      const review = await messageRequest(f, method, params);
      assert.ok(review);
      assert.equal(review.method, method);
      assert.equal(review.error, null);
      assert.equal(review.busy, false);
      f.setResponseWait(new Promise<void>((resolve) => { release = resolve; }));
      await messageRequest(f, 'eth_accounts', [], 12);
      assert.equal(f.view.getSnapshot().signingReview?.id, review.id);
      // The read is already waiting at its transport boundary. Its later
      // failure reaches unavailable() without another transport event.
      await assert.rejects((await f.repository).transport.setItem('invalid', () => undefined));
      release();
      await settle();
      assert.equal(f.view.getSnapshot().status, 'unavailable');
      assert.equal(f.view.getSnapshot().signingReview, null);
      await assert.rejects(f.view.approveRequest(review.id, review.revision, false));
      assert.equal(f.signatures.length, 0);
      assert.equal(f.transactions.length, 0);
      assert.equal(f.responses.length, 0);
    } finally {
      release?.();
      await f.controller.dispose();
    }
  });
}

async function pairedSmart() {
  const f = fixture({ smart: true }); await settle(); await f.view.pair('wc:fixture');
  f.event({ type: 'proposal', proposal: f.proposal });
  await f.view.approve(3, 'smart:60:0', 'ethereum', f.view.getSnapshot().revision);
  return f;
}
function requestSmart(f: Awaited<ReturnType<typeof pairedSmart>>, id = 700, transaction: object = {}) {
  f.event({ type: 'request', request: { freshness: 'fresh', session: f.session, id, chainId: 'eip155:1', method: 'eth_sendTransaction',
    params: [{ from: ADDRESS, to: '0x' + '22'.repeat(20), value: '0x0', data: '0x1234', ...transaction }],
    expiresAt: Date.now() + 60000, verification: UNKNOWN } });
}
test('Smart dapp session omits messages and requires separate UserOp and payer approval', async () => {
  const f = await pairedSmart();
  try {
    assert(!f.session.namespaces.eip155!.methods.includes('personal_sign'));
    requestSmart(f); await settle();
    let review = f.view.getSnapshot().signingReview;
    assert(review?.kind === 'smart-transaction'); assert.equal(review.operation.phase, 'authorize');
    assert.equal(f.signatures.length, 0); assert.equal(f.transactions.length, 0);
    const completing = f.view.approveRequest(review.id, review.revision, false); await settle();
    review = f.view.getSnapshot().signingReview;
    assert(review?.kind === 'smart-transaction'); assert.equal(review.operation.phase, 'review-fee');
    assert.equal(f.signatures.length, 1); assert.equal(f.transactions.length, 0);
    await f.view.confirmSmartPayer(review.id, review.revision, review.operation.payerReview!.id);
    await completing;
    assert.equal(f.transactions.length, 1);
    assert.deepEqual(f.responses.at(-1), { id: 700, result: { result: '0x' + '34'.repeat(32) } });
  } finally { await f.controller.dispose(); }
});
for (const cancel of ['reject', 'lock', 'chain', 'expiry'] as const) test(`Smart payer review cancels on ${cancel}`, async () => {
  const f = await pairedSmart();
  try {
    requestSmart(f); await settle();
    let review = f.view.getSnapshot().signingReview; assert(review?.kind === 'smart-transaction');
    const completing = f.view.approveRequest(review.id, review.revision, false).catch(() => undefined); await settle();
    review = f.view.getSnapshot().signingReview; assert(review?.kind === 'smart-transaction');
    const stale = review;
    if (cancel === 'reject') await f.view.rejectRequest(review.id);
    else if (cancel === 'lock') f.lock();
    else if (cancel === 'chain') f.selectChain(2);
    else f.event({ type: 'request-expired', id: 700 });
    await assert.rejects(f.view.confirmSmartPayer(stale.id, stale.revision, stale.operation.payerReview!.id));
    await completing; assert.equal(f.transactions.length, 0);
    assert.equal(f.view.getSnapshot().signingReview, null);
  } finally { await f.controller.dispose(); }
});
test('Smart transaction reply loss stays consumed after broadcast', async () => {
  const f = await pairedSmart();
  try {
    requestSmart(f); await settle(); let review = f.view.getSnapshot().signingReview; assert(review?.kind === 'smart-transaction');
    f.failDispatch(); const completing = f.view.approveRequest(review.id, review.revision, false); await settle();
    review = f.view.getSnapshot().signingReview; assert(review?.kind === 'smart-transaction');
    await f.view.confirmSmartPayer(review.id, review.revision, review.operation.payerReview!.id);
    await assert.rejects(completing, { code: 'DELIVERY_UNCERTAIN' });
    review = f.view.getSnapshot().signingReview; assert(review?.kind === 'smart-transaction');
    await assert.rejects(f.view.approveRequest(review.id, review.revision, false));
    assert.equal(f.transactions.length, 1);
  } finally { await f.controller.dispose(); }
});

for (const ending of ['reject', 'dispose'] as const) test(`Smart connection ${ending} waits for its held owner signing to drain`, async () => {
  const f = await pairedSmart();
  const held = Promise.withResolvers<void>();
  let signing: Promise<void> | undefined;
  try {
    requestSmart(f); await settle();
    const review = f.view.getSnapshot().signingReview;
    assert(review?.kind === 'smart-transaction');
    f.setSignWait(held.promise);
    signing = f.view.approveRequest(review.id, review.revision, false).catch(() => undefined);
    await settle();
    const closing = ending === 'reject' ? f.view.rejectRequest(review.id) : f.controller.dispose();
    let closed = false;
    void closing.then(() => { closed = true; });
    await settle();
    assert.equal(closed, false);
    assert.equal(f.view.getSnapshot().signingReview, null);
    held.resolve();
    await Promise.all([signing, closing]);
    assert.equal(closed, true);
    assert.equal(f.transactions.length, 0);
  } finally { held.resolve(); await signing; await f.controller.dispose(); }
});

test('a synchronous retirement subscriber joins held Smart signing before closing transport', async () => {
  const f = await pairedSmart();
  const held = Promise.withResolvers<void>();
  let signing: Promise<void> | undefined;
  let subscriberClosing: Promise<void> | undefined;
  let unsubscribe = () => {};
  try {
    requestSmart(f); await settle();
    const review = f.view.getSnapshot().signingReview;
    assert(review?.kind === 'smart-transaction');
    f.setSignWait(held.promise);
    signing = f.view.approveRequest(review.id, review.revision, false).catch(() => undefined);
    await settle();
    unsubscribe = f.view.subscribe(() => {
      if (f.view.getSnapshot().signingReview || subscriberClosing) return;
      unsubscribe();
      subscriberClosing = f.controller.dispose();
    });
    const rejecting = f.view.rejectRequest(review.id);
    let closed = false;
    assert(subscriberClosing);
    void subscriberClosing.then(() => { closed = true; });
    await settle();
    assert.equal(closed, false);
    assert.equal(f.closed(), 0);
    held.resolve();
    await Promise.all([signing, rejecting, subscriberClosing]);
    assert.equal(closed, true);
    assert.equal(f.closed(), 1);
    assert.equal(f.transactions.length, 0);
  } finally {
    unsubscribe(); held.resolve(); await signing; await f.controller.dispose();
  }
});

test('Smart operation returned after request retirement is immediately disposed', async () => {
  const f = await pairedSmart();
  try {
    f.beforePreparedReturn(() => f.lock());
    requestSmart(f); await settle();
    assert.equal(f.smartDisposals(), 1);
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(f.signatures.length, 0);
  } finally { await f.controller.dispose(); }
});
test('Smart allowance edit replaces the exact operation before authorization', async () => {
  const f = await pairedSmart();
  const token = { contractAddress: '0x' + '22'.repeat(20), decimals: 6, name: 'Token', symbol: 'TOK' };
  const iface = new Interface(['function approve(address spender,uint256 amount)']);
  f.setApprovalMetadata({ standard: 'ERC-20', token });
  try {
    requestSmart(f, 702, { data: iface.encodeFunctionData('approve', [ADDRESS, 9000000]) }); await settle();
    let review = f.view.getSnapshot().signingReview; assert(review?.kind === 'smart-transaction');
    const oldIntent = review.operation.intent;
    await f.view.editApprovalAmount(review.id, review.revision, '2.5');
    review = f.view.getSnapshot().signingReview; assert(review?.kind === 'smart-transaction');
    assert.notEqual(review.operation.intent, oldIntent);
    assert.equal(review.approval!.amountUnits, '2500000');
    assert.equal(f.smartDisposals(), 1);
    const completing = f.view.approveRequest(review.id, review.revision, false); await settle();
    review = f.view.getSnapshot().signingReview; assert(review?.kind === 'smart-transaction');
    await f.view.confirmSmartPayer(review.id, review.revision, review.operation.payerReview!.id); await completing;
    assert.equal((f.transactions[0] as { data: string }).data, iface.encodeFunctionData('approve', [ADDRESS, 2500000]));
  } finally { await f.controller.dispose(); }
});


test('Smart queued requests prepare only when foreground and retain distinct pending nonces', async () => {
  const f = await pairedSmart();
  try {
    requestSmart(f, 800); requestSmart(f, 801); await settle();
    assert.equal(f.preparedTransactions.length, 1);
    let review = f.view.getSnapshot().signingReview;
    assert(review?.kind === 'smart-transaction');
    assert.equal(review.operation.authorization!.nonce, '0');
    const first = f.view.approveRequest(review.id, review.revision, false);
    await settle();
    review = f.view.getSnapshot().signingReview;
    assert(review?.kind === 'smart-transaction');
    await f.view.confirmSmartPayer(review.id, review.revision, review.operation.payerReview!.id);
    await first; await settle();
    review = f.view.getSnapshot().signingReview;
    assert(review?.kind === 'smart-transaction');
    assert.equal(f.preparedTransactions.length, 2);
    assert.equal(review.operation.authorization!.nonce, '1');
    assert.equal(f.signatures.length, 1);
    assert.equal(f.transactions.length, 1);
    const second = f.view.approveRequest(review.id, review.revision, false);
    await settle();
    review = f.view.getSnapshot().signingReview;
    assert(review?.kind === 'smart-transaction');
    await f.view.confirmSmartPayer(review.id, review.revision, review.operation.payerReview!.id);
    await second;
    assert.equal(f.transactions.length, 2);
  } finally { await f.controller.dispose(); }
});


test('batch capability distinguishes Smart atomic and EOA sequential support', async () => {
  for (const smart of [true, false]) {
    const f = await connectedFixture({ smart, batch: true, capabilities: true, accountId: smart ? 'smart:60:0' : 'hd:60:0' });
    try {
      await messageRequest(f, 'wallet_getCapabilities', [ADDRESS]);
      assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: { '0x1': { atomic: { status: smart ? 'supported' : 'unsupported' } } } } });
      assert.equal(f.session.namespaces.eip155!.methods.includes('wallet_sendCalls'), true);
    } finally { await f.controller.dispose(); }
  }
});

test('ordered Smart batch review uses two consents and returns a reserved bundle ID', async () => {
  const f = await connectedFixture({ smart: true, batch: true, accountId: 'smart:60:0' });
  try {
    const calls = [{ to: '0x' + '22'.repeat(20), value: '0x9', data: '0x' }, { to: '0x' + '33'.repeat(20), data: '0x1234' }];
    const review = await messageRequest(f, 'wallet_sendCalls', [{ version: '2.0.0', id: '0x1234', from: ADDRESS, atomicRequired: true, calls }]);
    assert(review?.kind === 'smart-transaction');
    assert.equal(review.method, 'wallet_sendCalls');
    assert.equal(review.operation.intent.kind, 'dapp-batch');
    assert.equal(f.transactions.length, 0);
    const approving = f.view.approveRequest(review.id, review.revision, true);
    for (let i = 0; i < 10 && !(f.view.getSnapshot().signingReview as typeof review)?.operation.payerReview; i++) await settle();
    const payer = f.view.getSnapshot().signingReview;
    assert(payer?.kind === 'smart-transaction' && payer.operation.payerReview);
    assert.equal(f.transactions.length, 0);
    await f.view.confirmSmartPayer(payer.id, payer.revision, payer.operation.payerReview.id);
    await approving;
    assert.equal(f.transactions.length, 1);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: { id: '0x1234', capabilities: {} } } });
  } finally { await f.controller.dispose(); }
});

test('status recovery cannot retire a live per-call consent sequence', async () => {
  const f = await connectedFixture({ batch: true });
  try {
    const review = await messageRequest(f, 'wallet_sendCalls', [{ version: '2.0.0', id: '0xa123',
      calls: [{ to: ADDRESS }, { to: ADDRESS }], atomicRequired: false }]);
    assert(review?.kind === 'transaction');
    await f.view.approveRequest(review.id, review.revision, false);
    const suffix = f.view.getSnapshot().signingReview;
    assert(suffix?.kind === 'transaction' && suffix.batch?.index === 1);
    f.setCallsStatusReceipts(1, new Map());
    await messageRequest(f, 'wallet_getCallsStatus', ['0xa123'], 11);
    assert.deepEqual(f.callsRecoveries, []);
    assert.equal((f.responses.at(-1) as any).result.result.status, 100);
    await f.view.rejectRequest(suffix.id);
    await settle();
    await messageRequest(f, 'wallet_getCallsStatus', ['0xa123'], 12);
    assert.deepEqual(f.callsRecoveries, [{ origin: ORIGIN, id: '0xa123' }]);
  } finally { await f.controller.dispose(); }
});

test('status is origin bound and show status acknowledges only after it is rendered', async () => {
  const f = await connectedFixture({ smart: true, batch: true, accountId: 'smart:60:0' });
  try {
    const repository = await f.repository;
    await repository.calls.reserveSendCallsBundle(ORIGIN, '0xab', { atomic: true, smartAccount: true, chainId: 1 }, 'reserved', ADDRESS);
    await messageRequest(f, 'wallet_showCallsStatus', ['0xab']);
    assert.deepEqual(f.responses, []);
    const view = f.view.getSnapshot().callsStatus;
    assert(view); assert.equal(view.status.status, 100);
    await f.view.callsStatusShown(view.id);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: null } });
    f.view.dismissCallsStatus(view.id);
    assert.equal(f.view.getSnapshot().callsStatus, null);
    await messageRequest(f, 'wallet_getCallsStatus', ['0xab'], 11);
    assert.equal((f.responses.at(-1) as any).result.result.status, 100);
    await messageRequest(f, 'wallet_getCallsStatus', ['0xdead'], 12);
    assert.equal((f.responses.at(-1) as any).result.error.code, 5730);
  } finally { await f.controller.dispose(); }
});

test('duplicate Smart bundle IDs do not create a second review and rejection releases an unstarted ID', async () => {
  const f = await connectedFixture({ smart: true, batch: true, accountId: 'smart:60:0' });
  try {
    const request = { version: '2.0.0', id: '0xff', calls: [{ to: ADDRESS }] };
    const review = await messageRequest(f, 'wallet_sendCalls', [request]); assert(review);
    await messageRequest(f, 'wallet_sendCalls', [request], 11);
    assert.equal((f.responses.at(-1) as any).result.error.code, 5720);
    await f.view.rejectRequest(review.id);
    await settle();
    assert.equal(await (await f.repository).calls.getStoredSendCallsBundle(ORIGIN, '0xff'), null);
  } finally { await f.controller.dispose(); }
});


test('closing an unshown status and session retirement preserve stored history', async () => {
  const f = await connectedFixture({ smart: true, batch: true, accountId: 'smart:60:0' });
  try {
    const repository = await f.repository;
    await repository.calls.reserveSendCallsBundle(ORIGIN, '0xabab', { atomic: true, smartAccount: true, chainId: 1 }, 'reserved', ADDRESS);
    await messageRequest(f, 'wallet_showCallsStatus', ['0xabab']);
    f.view.dismissCallsStatus(f.view.getSnapshot().callsStatus!.id); await settle();
    assert.equal((f.responses.at(-1) as any).result.error.code, 4001);
    await messageRequest(f, 'wallet_showCallsStatus', ['0xabab'], 11);
    assert(f.view.getSnapshot().callsStatus);
    f.event({ type: 'session-ended', topic: TOPIC }); await settle();
    assert.equal(f.view.getSnapshot().callsStatus, null);
    assert(await repository.calls.getStoredSendCallsBundle(ORIGIN, '0xabab'));
  } finally { await f.controller.dispose(); }
});


test('a lock while reserving a batch releases the unstarted ID without publishing a review', async () => {
  const f = await connectedFixture({ smart: true, batch: true, accountId: 'smart:60:0' });
  let release!: () => void;
  try {
    f.setStorageWait(new Promise<void>(resolve => { release = resolve; }));
    await messageRequest(f, 'wallet_sendCalls', [{ version: '2.0.0', id: '0xdeadbeef', calls: [{ to: ADDRESS }] }]);
    f.lock(); release();
    for (let i = 0; i < 4; i++) await settle();
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(await (await f.repository).calls.getStoredSendCallsBundle(ORIGIN, '0xdeadbeef'), null);
    assert.equal(f.signatures.length, 0);
    assert.equal(f.transactions.length, 0);
  } finally { release?.(); await f.controller.dispose(); }
});


test('malformed receipt status errors cannot become invalid JSON-RPC error codes', async () => {
  const f = await connectedFixture({ smart: true, batch: true, accountId: 'smart:60:0' });
  try {
    f.failCallsStatus(Object.assign(new Error('Invalid receipt'), { code: 'INVALID_RESPONSE' }));
    await messageRequest(f, 'wallet_getCallsStatus', ['0xab']);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { error: { code: -32603, message: 'Call status is unavailable' } } });
    assert.equal(f.view.getSnapshot().callsStatus, null);
  } finally { await f.controller.dispose(); }
});


for (const change of ['get-expired', 'show-expired', 'show-dismissed'])
  test(`call status refuses late transport acknowledgement (${change})`, async () => {
    const f = await connectedFixture({ smart: true, batch: true, accountId: 'smart:60:0' });
    const readNow = Date.now;
    let now = readNow(), release!: () => void;
    Date.now = () => now;
    try {
      await (await f.repository).calls.reserveSendCallsBundle(ORIGIN, '0x123abc', { atomic: true, smartAccount: true, chainId: 1 }, 'reserved', ADDRESS);
      if (change === 'get-expired') {
        f.setResponseWait(new Promise<void>(resolve => { release = resolve; }));
        await messageRequest(f, 'wallet_getCallsStatus', ['0x123abc']);
        now += 300001;
        release();
        for (let i = 0; i < 4; i++) await settle();
      } else {
        await messageRequest(f, 'wallet_showCallsStatus', ['0x123abc']);
        const view = f.view.getSnapshot().callsStatus;
        assert(view);
        f.setResponseWait(new Promise<void>(resolve => { release = resolve; }));
        const response = f.view.callsStatusShown(view.id);
        const rejected = assert.rejects(response, { code: change === 'show-expired' ? 'REQUEST_EXPIRED' : 'CONTEXT_CHANGED' });
        if (change === 'show-expired') now += 300001;
        f.view.dismissCallsStatus(view.id);
        release(); await rejected;
      }
      assert.deepEqual(f.handedOff, []);
      assert.deepEqual(f.responses, []);
      assert(await (await f.repository).calls.getStoredSendCallsBundle(ORIGIN, '0x123abc'));
    } finally { Date.now = readNow; release?.(); await f.controller.dispose(); }
  });

for (const imported of [false, true])
test(`${imported ? 'Imported' : 'HD'} EOA calls keep each fee consent and expose their durable status after switching networks`, async () => {
  const f = await connectedFixture({ batch: true, imported, accountId: imported ? 'imported:60:0' : 'hd:60:0' });
  try {
    const review = await messageRequest(f, 'wallet_sendCalls', [{ version: '2.0.0', id: '0x1234', atomicRequired: false,
      calls: [{ to: '0x' + '22'.repeat(20), value: '0x1' }, { to: '0x' + '33'.repeat(20), value: '0x2' }] }]);
    assert(review?.kind === 'transaction' && review.batch);
    assert.equal(review.batch.index, 0); assert.equal(f.transactions.length, 0);
    await f.view.approveRequest(review.id, review.revision, false);
    const next = f.view.getSnapshot().signingReview;
    assert(next?.kind === 'transaction' && next.batch);
    assert.equal(next.id, review.id); assert.equal(next.batch.index, 1);
    assert.equal(f.transactions.length, 1); assert.equal(f.responses.length, 0);
    await assert.rejects(f.view.approveRequest(review.id, review.revision, false));
    await f.view.approveRequest(next.id, f.view.getSnapshot().revision, false);
    assert.equal(f.transactions.length, 2);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: { id: '0x1234', capabilities: {} } } });
    const stored = await (await f.repository).calls.getStoredSendCallsBundle(ORIGIN, '0x1234');
    assert.equal(stored?.txHashes.length, 2);
    assert.equal(stored?.atomic, false);
    const receipts = new Map(stored!.txHashes.map((hash) => [hash, {
      transactionHash: hash, status: '0x1', blockHash: '0x' + 'ab'.repeat(32),
      blockNumber: '0x7', gasUsed: '0x5208', logs: [],
    }]));
    f.setCallsStatusReceipts(1, receipts);
    f.selectChain(2);
    await messageRequest(f, 'wallet_getCallsStatus', ['0x1234'], 11);
    const status = (f.responses.at(-1) as { result: { result: { status: number; chainId: string; atomic: boolean; receipts: unknown[] } } }).result.result;
    assert.equal(status.status, 200);
    assert.equal(status.chainId, '0x1');
    assert.equal(status.atomic, false);
    assert.equal(status.receipts.length, 2);
    assert.deepEqual(f.callsStatusChains, [1]);
    const beforeShow = f.responses.length;
    await messageRequest(f, 'wallet_showCallsStatus', ['0x1234'], 12);
    const shown = f.view.getSnapshot().callsStatus;
    assert(shown);
    assert.deepEqual(shown.status, status);
    assert.equal(f.responses.length, beforeShow);
    await f.view.callsStatusShown(shown.id);
    assert.deepEqual(f.responses.at(-1), { id: 12, result: { result: null } });
    f.view.dismissCallsStatus(shown.id);
    assert.deepEqual(f.callsStatusChains, [1, 1]);
    assert.equal(f.transactions.length, 2);
  } finally { await f.controller.dispose(); }
});

for (const method of ['wallet_getCallsStatus', 'wallet_showCallsStatus']) {
  for (const mismatch of ['origin', 'grant-chain', 'namespace-method', 'namespace-account']) {
    test(`EOA ${method} rejects ${mismatch} before reading the bundle`, async () => {
      const f = await connectedFixture({ batch: true });
      try {
        const session = structuredClone(f.session);
        let chainId = 'eip155:1';
        if (mismatch === 'origin') Object.assign(session, {
          binding: { ...session.binding, origin: 'https://other.example' },
        });
        else if (mismatch === 'grant-chain') {
          chainId = 'eip155:2';
          Object.assign(f.session.namespaces.eip155!, {
            accounts: [...f.session.namespaces.eip155!.accounts, `${chainId}:${ADDRESS}`],
            chains: [...f.session.namespaces.eip155!.chains!, chainId],
          });
        } else if (mismatch === 'namespace-method') {
          Object.assign(f.session.namespaces.eip155!, {
            methods: f.session.namespaces.eip155!.methods.filter((entry) => entry !== method),
          });
        } else Object.assign(f.session.namespaces.eip155!, { accounts: [`eip155:1:0x${'22'.repeat(20)}`] });
        f.event({ type: 'request', request: { freshness: 'fresh',
          id: 10, session, chainId, method, params: ['0x1234'],
          expiresAt: Date.now() + 300000, verification: UNKNOWN,
        } });
        await settle();
        assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, 4100);
        assert.deepEqual(f.callsStatusReads, []);
        assert.equal(f.view.getSnapshot().callsStatus, null);
      } finally { await f.controller.dispose(); }
    });
  }

  test(`EOA ${method} cannot resolve another origin's durable bundle`, async () => {
    const f = await connectedFixture({ batch: true, imported: true, accountId: 'imported:60:0' });
    try {
      await (await f.repository).calls.reserveSendCallsBundle('https://other.example', '0x1234', {
        atomic: false, smartAccount: false, chainId: 1,
      }, 'reserved', ADDRESS);
      await messageRequest(f, method, ['0x1234']);
      assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, 5730);
      assert.equal(f.view.getSnapshot().callsStatus, null);
    } finally { await f.controller.dispose(); }
  });

  for (const retirement of ['lock', 'session', 'expiry']) {
    test(`EOA ${method} suppresses a held status after ${retirement}`, async () => {
      const f = await connectedFixture({ batch: true });
      const held = Promise.withResolvers<void>();
      const readNow = Date.now;
      let now = readNow();
      Date.now = () => now;
      try {
        await (await f.repository).calls.reserveSendCallsBundle(ORIGIN, '0x1234', {
          atomic: false, smartAccount: false, chainId: 1,
        }, 'reserved', ADDRESS);
        f.setCallsStatusWait(held.promise);
        await messageRequest(f, method, ['0x1234']);
        assert.equal(f.callsStatusReads.length, 1);
        if (retirement === 'lock') f.lock();
        else if (retirement === 'session') f.event({ type: 'session-ended', topic: TOPIC });
        else now += 300001;
        held.resolve();
        await settle();
        assert.deepEqual(f.handedOff, []);
        assert.deepEqual(f.responses, []);
        assert.equal(f.view.getSnapshot().callsStatus, null);
        assert(await (await f.repository).calls.getStoredSendCallsBundle(ORIGIN, '0x1234'));
      } finally { Date.now = readNow; held.resolve(); await f.controller.dispose(); }
    });
  }
}

test('rejecting a partially acknowledged EOA batch returns its status ID and never resends', async () => {
  const f = await connectedFixture({ batch: true });
  try {
    const review = await messageRequest(f, 'wallet_sendCalls', [{ version: '2.0.0', id: '0xabcd', atomicRequired: false,
      calls: [{ to: ADDRESS }, { to: ADDRESS }] }]);
    assert(review?.kind === 'transaction');
    await f.view.approveRequest(review.id, review.revision, false);
    await f.view.rejectRequest(review.id); await settle(); await settle();
    assert.equal(f.transactions.length, 1);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: { id: '0xabcd', capabilities: {} } } });
    const stored = await (await f.repository).calls.getStoredSendCallsBundle(ORIGIN, '0xabcd');
    assert.equal(stored?.failed, true);
    assert.equal(stored?.submissionCompleted, true);
  } finally { await f.controller.dispose(); }
});

test('an EOA atomic-required batch is refused before reservation or preparation', async () => {
  const f = await connectedFixture({ batch: true });
  try {
    await messageRequest(f, 'wallet_sendCalls', [{ version: '2.0.0', id: '0xdead', atomicRequired: true, calls: [{ to: ADDRESS }] }]);
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(f.preparedTransactions.length, 0);
    assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, 5760);
    assert.equal(await (await f.repository).calls.getStoredSendCallsBundle(ORIGIN, '0xdead'), null);
  } finally { await f.controller.dispose(); }
});

for (const transition of ['lock', 'chain', 'expiry'] as const) {
  test(`a held EOA batch quote is retired on ${transition}`, async () => {
    const f = await connectedFixture({ batch: true }), held = Promise.withResolvers<void>();
    try {
      f.setPreparationWait(held.promise);
      const request = messageRequest(f, 'wallet_sendCalls', [{ version: '2.0.0', id: '0x9876', atomicRequired: false, calls: [{ to: ADDRESS }, { to: ADDRESS }] }]);
      await settle();
      if (transition === 'lock') f.lock();
      else if (transition === 'chain') f.selectChain(2);
      else f.event({ type: 'request-expired', id: 10 });
      held.resolve(); await request; await settle();
      assert.equal(f.view.getSnapshot().signingReview, null);
      assert.equal(f.transactions.length, 0);
      assert.equal(await (await f.repository).calls.getStoredSendCallsBundle(ORIGIN, '0x9876'), null);
    } finally { held.resolve(); await f.controller.dispose(); }
  });
}


async function connectedSmartMessages() {
  return connectedFixture({ smart: true, smartMessages: true, accountId: 'smart:60:0' });
}

for (const [method, payload] of [
  ['personal_sign', 'Smart account message'],
  ['eth_signTypedData_v4', typedMessage],
] as const) test(`eligible Smart ${method} uses the same review and preserves its extended signature`, async () => {
  const f = await connectedSmartMessages();
  try {
    const methods = f.session.namespaces.eip155!.methods;
    assert(methods.includes('personal_sign'));
    assert(methods.includes('eth_signTypedData_v4'));
    assert(!methods.includes('eth_signTypedData'));
    assert(!methods.includes('eth_signTypedData_v3'));
    const params = method === 'personal_sign' ? [payload, ADDRESS] : [ADDRESS, payload];
    const review = await messageRequest(f, method, params);
    assert(review?.kind === 'message');
    assert.equal(review.smartAccount, true);
    assert.equal(review.address, ADDRESS);
    assert.equal(review.chainId, '1');
    assert.equal(review.origin, ORIGIN);
    assert.equal(f.signatures.length, 0);
    await f.view.approveRequest(review.id, review.revision, false);
    assert.equal(f.signatures.length, 1);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: '0x' + '33'.repeat(20) + '12'.repeat(65) } });
  } finally { await f.controller.dispose(); }
});

for (const method of ['eth_signTypedData', 'eth_signTypedData_v3']) test(`Smart message capability rejects ${method} before creating a review`, async () => {
  const f = await connectedSmartMessages();
  try {
    const params = method === 'eth_signTypedData'
      ? [ADDRESS, [{ name: 'text', type: 'string', value: 'message' }]] : [ADDRESS, typedMessage];
    await messageRequest(f, method, params);
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(f.signatures.length, 0);
    assert.equal((f.responses.at(-1) as any).result.error.code, 4100);
  } finally { await f.controller.dispose(); }
});

for (const retire of ['lock', 'grant', 'expiry', 'network'] as const) test(`Smart signing result is suppressed after ${retire} while signing`, async () => {
  const f = await connectedSmartMessages();
  let release!: () => void;
  try {
    const review = await messageRequest(f);
    assert(review?.kind === 'message');
    f.setSignWait(new Promise<void>(resolve => { release = resolve; }));
    const signing = f.view.approveRequest(review.id, review.revision, false);
    const rejected = assert.rejects(signing);
    await settle();
    if (retire === 'lock') f.lock();
    else if (retire === 'grant') await f.view.disconnect(f.view.getSnapshot().sessions[0]!.id);
    else if (retire === 'network') f.selectChain(2);
    else f.event({ type: 'request-expired', id: 10 });
    release(); await rejected;
    assert.equal(f.responses.some((row: any) => row.result.result), false);
    assert.equal(f.handedOff.some((row: any) => row.result.result), false);
  } finally { release?.(); await f.controller.dispose(); }
});

test('Smart response handoff rechecks expiry after the transport wait', async () => {
  const f = await connectedSmartMessages();
  let release!: () => void;
  const now = Date.now;
  let currentTime = now();
  Date.now = () => currentTime;
  try {
    const review = await messageRequest(f, 'eth_signTypedData_v4', [ADDRESS, typedMessage]);
    assert(review?.kind === 'message');
    f.setResponseWait(new Promise<void>(resolve => { release = resolve; }));
    const signing = f.view.approveRequest(review.id, review.revision, false);
    const rejected = assert.rejects(signing);
    await settle();
    currentTime += 300001;
    release(); await rejected;
    assert.equal(f.signatures.length, 1);
    assert.equal(f.handedOff.some((row: any) => row.result.result), false);
  } finally { Date.now = now; release?.(); await f.controller.dispose(); }
});

const feeComparisonFixture = {
  maxFeePerGas: {
    requested: '9007199254740993',
    recommended: '9007199254740995',
  },
  maxPriorityFeePerGas: { requested: '0', recommended: '2' },
  recommendationOnly: true,
};

test('fee choice requotes exact base units and consumes only a fresh confirmation', async () => {
  const f = await connectedFixture({ feeComparison: feeComparisonFixture });
  try {
    const review = await messageRequest(f, 'eth_sendTransaction', [
      {
        from: ADDRESS,
        to: ADDRESS,
        maxFeePerGas: feeComparisonFixture.maxFeePerGas.requested,
        maxPriorityFeePerGas: '0',
      },
    ]);
    assert(review?.kind === 'transaction');
    assert.deepEqual(review.feeComparison, feeComparisonFixture);
    await f.view.chooseTransactionFee(review.id, review.revision, 'network');
    const next = f.view.getSnapshot().signingReview;
    assert(next?.kind === 'transaction');
    assert.equal(next.feeChoice, 'network');
    assert.equal(
      next.transaction?.type === 2 && next.transaction.maxFeePerGas,
      '9007199254740995'
    );
    assert.equal(f.transactions.length, 0);
    assert.equal(
      f.preparedTransactions.at(-1)?.maxFeePerGas,
      '9007199254740995'
    );
    await assert.rejects(
      f.view.approveRequest(review.id, review.revision, false),
      { message: 'REQUEST_EXPIRED' }
    );
    await f.view.approveRequest(next.id, f.view.getSnapshot().revision, false);
    assert.equal(f.transactions.length, 1);
    assert.equal((f.transactions[0] as any).maxFeePerGas, '9007199254740995');
  } finally {
    await f.controller.dispose();
  }
});

test('a fee choice finishing after a network round trip cannot revive an old review', async () => {
  const f = await connectedFixture({ feeComparison: feeComparisonFixture });
  const gate = Promise.withResolvers<void>();
  try {
    const review = await messageRequest(f, 'eth_sendTransaction', [
      { from: ADDRESS, to: ADDRESS },
    ]);
    assert(review?.kind === 'transaction');
    f.setPreparationWait(gate.promise);
    const pending = f.view.chooseTransactionFee(
      review.id,
      review.revision,
      'network'
    );
    await settle();
    assert.equal(f.view.getSnapshot().signingReview?.busy, true);
    f.selectChain(2);
    f.selectChain(1);
    gate.resolve();
    await assert.rejects(pending);
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert.equal(f.transactions.length, 0);
  } finally {
    gate.resolve();
    await f.controller.dispose();
  }
});

test('EOA batch fee choices reset for the next call and retain the acknowledged prefix', async () => {
  const f = await connectedFixture({
    batch: true,
    feeComparison: feeComparisonFixture,
  });
  try {
    const review = await messageRequest(f, 'wallet_sendCalls', [
      {
        version: '2.0.0',
        id: '0xfee1',
        atomicRequired: false,
        calls: [
          { to: ADDRESS, value: '0x1' },
          { to: ADDRESS, value: '0x2' },
        ],
      },
    ]);
    assert(review?.kind === 'transaction');
    await f.view.chooseTransactionFee(review.id, review.revision, 'network');
    let current = f.view.getSnapshot().signingReview;
    assert(current?.kind === 'transaction');
    assert.equal(current.feeChoice, 'network');
    await f.view.approveRequest(current.id, current.revision, false);
    current = f.view.getSnapshot().signingReview;
    assert(current?.kind === 'transaction' && current.batch?.index === 1);
    assert.equal(current.feeChoice, null);
    assert.equal(f.transactions.length, 1);
    const stored = await (
      await f.repository
    ).calls.getStoredSendCallsBundle(ORIGIN, '0xfee1');
    const hashes = [...stored!.txHashes];
    await f.view.chooseTransactionFee(current.id, current.revision, 'dapp');
    current = f.view.getSnapshot().signingReview;
    assert(current?.kind === 'transaction');
    assert.equal(current.batch?.index, 1);
    assert.deepEqual(
      (
        await (
          await f.repository
        ).calls.getStoredSendCallsBundle(ORIGIN, '0xfee1')
      )?.txHashes,
      hashes
    );
    assert.equal(f.transactions.length, 1);
    await f.view.approveRequest(current.id, current.revision, false);
    assert.equal(f.transactions.length, 2);
  } finally {
    await f.controller.dispose();
  }
});

test('invalid and stale fee choices never prepare or submit a transaction', async () => {
  const f = await connectedFixture({ feeComparison: feeComparisonFixture });
  try {
    const review = await messageRequest(f, 'eth_sendTransaction', [
      { from: ADDRESS, to: ADDRESS },
    ]);
    assert(review?.kind === 'transaction');
    const prepared = f.preparedTransactions.length;
    await assert.rejects(
      f.view.chooseTransactionFee('other', review.revision, 'network'),
      { message: 'REQUEST_EXPIRED' }
    );
    await assert.rejects(
      f.view.chooseTransactionFee(review.id, review.revision - 1, 'network'),
      { message: 'REQUEST_EXPIRED' }
    );
    await assert.rejects(
      f.view.chooseTransactionFee(
        review.id,
        f.view.getSnapshot().revision,
        'unknown' as 'network'
      ),
      { message: 'UNSUPPORTED_REQUEST' }
    );
    assert.equal(f.preparedTransactions.length, prepared);
    assert.equal(f.transactions.length, 0);
  } finally {
    await f.controller.dispose();
  }
});

test('a second fee choice cannot overtake an in-flight requote', async () => {
  const f = await connectedFixture({ feeComparison: feeComparisonFixture });
  const gate = Promise.withResolvers<void>();
  try {
    const review = await messageRequest(f, 'eth_sendTransaction', [
      { from: ADDRESS, to: ADDRESS },
    ]);
    assert(review?.kind === 'transaction');
    f.setPreparationWait(gate.promise);
    const pending = f.view.chooseTransactionFee(
      review.id,
      review.revision,
      'network'
    );
    await settle();
    await assert.rejects(
      f.view.chooseTransactionFee(
        review.id,
        f.view.getSnapshot().revision,
        'dapp'
      ),
      { message: 'BUSY' }
    );
    gate.resolve();
    await pending;
    assert.equal(f.preparedTransactions.length, 2);
    assert.equal(f.transactions.length, 0);
  } finally {
    gate.resolve();
    await f.controller.dispose();
  }
});

for (const batch of [false, true]) {
  test(`a ${
    batch ? 'batch' : 'single'
  } requote keeps its adjustment when the selected gas cannot be honored`, async () => {
    const f = await connectedFixture({
      batch,
      minimumGasLimit: '60000',
      feeComparison: {
        gasLimit: { requested: '21000', recommended: '60000' },
        recommendationOnly: false,
      },
    });
    try {
      const review = await messageRequest(
        f,
        batch ? 'wallet_sendCalls' : 'eth_sendTransaction',
        batch
          ? [
              {
                version: '2.0.0',
                id: '0xfef1',
                atomicRequired: false,
                calls: [{ to: ADDRESS, value: '0x1' }],
              },
            ]
          : [{ from: ADDRESS, to: ADDRESS, gas: '0x5208' }]
      );
      assert(review?.kind === 'transaction');
      await f.view.chooseTransactionFee(review.id, review.revision, 'dapp');
      const current = f.view.getSnapshot().signingReview;
      assert(current?.kind === 'transaction');
      assert.equal(current.transaction?.gasLimit, '60000');
      assert.equal(current.feeChoice, null);
      assert.equal(current.feeComparison?.recommendationOnly, false);
      assert.deepEqual(current.feeComparison?.gasLimit, {
        requested: '21000',
        recommended: '60000',
      });
      assert.equal(f.transactions.length, 0);
      await f.view.approveRequest(current.id, current.revision, false);
      assert.equal((f.transactions[0] as any).gasLimit, '60000');
    } finally {
      await f.controller.dispose();
    }
  });
}

test('a legacy fee choice stays legacy through the native reprepare and submission path', async () => {
  const f = await connectedFixture({
    feeComparison: {
      gasPrice: { requested: '1500000000', recommended: '2000000000' },
      recommendationOnly: true,
    },
  });
  try {
    const review = await messageRequest(f, 'eth_sendTransaction', [
      { from: ADDRESS, to: ADDRESS, gasPrice: '1500000000' },
    ]);
    assert(review?.kind === 'transaction');
    await f.view.chooseTransactionFee(review.id, review.revision, 'network');
    const current = f.view.getSnapshot().signingReview;
    assert(current?.kind === 'transaction');
    assert.equal(current.transaction?.type, 0);
    assert.equal(current.feeChoice, 'network');
    assert(current.transaction?.type === 0);
    assert.equal(current.transaction.gasPrice, '2000000000');
    assert(!('maxFeePerGas' in current.transaction));
    await f.view.approveRequest(current.id, current.revision, false);
    assert.equal((f.transactions[0] as any).gasPrice, '2000000000');
  } finally {
    await f.controller.dispose();
  }
});

for (const method of PSBT_DAPP_METHODS) test(`Ledger ${method} negotiates bip122 and requires one fresh original-request approval`, async () => {
  const f = await connectedFixture({ utxo: true, hardware: 'Ledger' });
  try {
    const methods = f.session.namespaces.bip122!.methods;
    assert(methods.includes(method)); assert(!methods.some(value => (SENTRY_DAPP_METHODS as readonly string[]).includes(value)));
    await syscoinRequest(f, method, [EXTERNAL_PSBT]);
    const review = f.view.getSnapshot().psbtReview; assert(review?.details);
    assert.equal(f.psbtApprovals.length, 0);
    await assert.rejects(f.view.approvePsbt(review.id, review.revision - 1));
    assert.equal(f.psbtApprovals.length, 0);
    await f.view.approvePsbt(review.id, review.revision);
    assert.deepEqual(f.psbtApprovals, [{ method, origin: ORIGIN, psbt: EXTERNAL_PSBT }]);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: method === 'sys_sign' ? EXTERNAL_PSBT : { txid: 'ef'.repeat(32) } } });
  } finally { await f.controller.dispose(); }
});
for (const change of ['lock', 'network', 'session', 'revoke', 'expiry'] as const) test(`Ledger external PSBT cannot disclose a late result after ${change}`, async () => {
  const f = await connectedFixture({ utxo: true, hardware: 'Ledger' }), held = Promise.withResolvers<void>(), readNow = Date.now;
  let now = readNow(); Date.now = () => now;
  try {
    await syscoinRequest(f, 'sys_sign', [EXTERNAL_PSBT]);
    const review = f.view.getSnapshot().psbtReview; assert(review?.details);
    f.setPsbtSignWait(held.promise);
    const signing = f.view.approvePsbt(review.id, review.revision), rejected = assert.rejects(signing);
    await settle();
    if (change === 'lock') f.lock(); else if (change === 'network') f.selectChain(5700);
    else if (change === 'session') f.event({ type: 'session-ended', topic: TOPIC });
    else if (change === 'revoke') await syscoinRequest(f, 'wallet_revokePermissions', [{ eth_accounts: {} }], 11);
    else now += 300001;
    held.resolve(); await rejected; await settle();
    assert(!f.responses.some(value => (value as { id: number; result: object }).id === 10 && 'result' in (value as { result: object }).result));
    assert.equal(f.view.getSnapshot().psbtReview, null);
  } finally { Date.now = readNow; held.resolve(); await f.controller.dispose(); }
});


test('Trezor external PSBT resumes only the authoritative original pending wire, makes a fresh review and waits for a separate approve', async () => {
  const f = await connectedFixture({ utxo: true, hardware: 'Trezor' }), held = Promise.withResolvers<void>();
  try {
    f.setPsbtSignWait(held.promise); await syscoinRequest(f, 'sys_sign', [EXTERNAL_PSBT]);
    const first = f.view.getSnapshot().psbtReview; assert(first?.details);
    const original = f.view.approvePsbt(first.id, first.revision), retired = assert.rejects(original); await settle();
    const selector = f.psbtHandoff().id; f.psbtHandoff().beforeSuiteOpen(Date.now() + 60000, {})(true);
    f.view.backgroundSigning(); f.lock(); held.resolve(); await retired; await settle();
    assert.equal(f.view.getSnapshot().psbtReview, null); assert.equal(f.responses.length, 0);
    await assert.rejects(f.view.resumeSigning(selector));
    f.unlock(); await settle(); await f.view.resumeSigning(selector); await settle();
    const fresh = f.view.getSnapshot().psbtReview; assert(fresh?.details); assert.notEqual(fresh.id, first.id);
    assert(fresh.expiresAt <= first.expiresAt); assert.equal(f.pendingReads(), 1);
    assert.equal(f.psbtRequests.length, 2); assert.equal(f.psbtApprovals.length, 1); assert.equal(f.responses.length, 0);
    await assert.rejects(f.view.approvePsbt(first.id, first.revision));
    await f.view.approvePsbt(fresh.id, fresh.revision);
    assert.deepEqual(f.responses, [{ id: 10, result: { result: EXTERNAL_PSBT } }]);
    await assert.rejects(f.view.resumeSigning(selector)); assert.equal(f.psbtApprovals.length, 2);
  } finally { held.resolve(); await f.controller.dispose(); }
});

for (const pending of ['missing', 'method'] as const) test(`Trezor resume with ${pending} authoritative pending data cancels only the exact old job and never prepares`, async () => {
  const f = await connectedFixture({ utxo: true, hardware: 'Trezor' }), held = Promise.withResolvers<void>(), job = {};
  try {
    f.setPsbtSignWait(held.promise); await syscoinRequest(f, 'sys_sign', [EXTERNAL_PSBT]);
    const first = f.view.getSnapshot().psbtReview; assert(first?.details);
    const signing = f.view.approvePsbt(first.id, first.revision), rejected = assert.rejects(signing); await settle();
    const selector = f.psbtHandoff().id; f.psbtHandoff().beforeSuiteOpen(Date.now() + 60000, job);
    f.view.backgroundSigning(); f.lock(); held.resolve(); await rejected; f.unlock(); await settle();
    f.setPendingOverride(pending); await assert.rejects(f.view.resumeSigning(selector)); await settle();
    assert.equal(f.psbtRequests.length, 1); assert.equal(f.responses.length, 0); assert.deepEqual(f.canceledPsbtJobs, [job]);
    await assert.rejects(f.view.resumeSigning(selector));
  } finally { held.resolve(); await f.controller.dispose(); }
});

test('explicit Trezor handoff cancel uses still-pending SDK data for one rejection and cannot resume', async () => {
  const f = await connectedFixture({ utxo: true, hardware: 'Trezor' }), held = Promise.withResolvers<void>(), job = {};
  try {
    f.setPsbtSignWait(held.promise); await syscoinRequest(f, 'sys_sign', [EXTERNAL_PSBT]);
    const first = f.view.getSnapshot().psbtReview; assert(first?.details);
    const signing = f.view.approvePsbt(first.id, first.revision), rejected = assert.rejects(signing); await settle();
    const selector = f.psbtHandoff().id; f.psbtHandoff().beforeSuiteOpen(Date.now() + 60000, job);
    f.view.backgroundSigning(); f.lock(); held.resolve(); await rejected;
    await f.view.cancelSigningHandoff(); await settle();
    assert.deepEqual(f.responses, [{ id: 10, result: { error: { code: 4001, message: 'User rejected' } } }]);
    assert.deepEqual(f.canceledPsbtJobs, [job]); f.unlock(); await settle(); await assert.rejects(f.view.resumeSigning(selector));
  } finally { held.resolve(); await f.controller.dispose(); }
});


for (const freshness of ['unproven', undefined, 'caller-claimed'] as const) test(`Trezor PSBT freshness ${freshness} cannot enter custody or become fresh after account selection`, async () => {
  const f = await connectedFixture({ utxo: true, hardware: 'Trezor' });
  try {
    const wire = { id: 10, session: f.session, method: 'sys_sign', params: [EXTERNAL_PSBT], freshness,
      chainId: dappCaipChain({ ...getUtxoNetwork('syscoin'), kind: 'syscoin' }), expiresAt: Date.now() + 300000, verification: UNKNOWN } as WalletConnectRequest;
    f.event({ type: 'request', request: wire }); await settle();
    assert.equal(f.psbtRequests.length, 0); assert.equal(f.view.getSnapshot().psbtReview, null);
    assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, 4200);
    f.selectEvm(); f.selectUtxo(); f.event({ type: 'request', request: wire }); await settle();
    assert.equal(f.psbtRequests.length, 0); assert.equal(f.psbtApprovals.length, 0);
  } finally { await f.controller.dispose(); }
});


for (const kind of ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'] as const) test(`Trezor ${kind} Suite return rebuilds the original request under a new unlock and requires a separate Confirm`, async () => {
  const f = await connectedFixture({ hardware: 'Trezor', accountId: 'trezor:60:0' }), held = Promise.withResolvers<void>(), now = Date.now;
  try {
    const params = kind === 'eth_sendTransaction' ? [{ from: ADDRESS, to: '0x' + '22'.repeat(20), value: '0x0' }] : kind === 'personal_sign' ? ['Hello Pali', ADDRESS] : [ADDRESS, { types: { EIP712Domain: [], Message: [{ name: 'text', type: 'string' }] }, primaryType: 'Message', domain: {}, message: { text: 'Hello Pali' } }];
    const first = await messageRequest(f, kind, params); assert(first); f.setSignWait(held.promise);
    const old = f.view.approveRequest(first.id, first.revision, true), rejected = assert.rejects(old); await settle();
    const handoff = f.signingHandoff(), selector = handoff.id;
    const absoluteDeadline = Date.now() + 60000;
    handoff.beforeSuiteOpen(absoluteDeadline, {})(true);
    f.view.backgroundSigning(); f.lock(); held.resolve(); await rejected; await settle();
    assert.equal(f.view.getSnapshot().signingReview, null); assert.equal(f.responses.length, 0); assert.equal(f.transactions.length, 0);
    await assert.rejects(f.view.resumeSigning(selector));
    f.unlock(); Date.now = () => absoluteDeadline - 15000;
    await settle(); await f.view.resumeSigning(selector); await settle();
    const fresh = f.view.getSnapshot().signingReview; assert(fresh); assert.notEqual(fresh.id, first.id);
    // A newly consented fee quote can outlive the old quote, but neither it
    // nor message review may extend the original absolute Suite deadline.
    assert(fresh.expiresAt <= absoluteDeadline);
    assert.equal(f.responses.length, 0); assert.equal(f.transactions.length, 0); assert.equal(f.pendingReads(), 1);
    await assert.rejects(f.view.approveRequest(first.id, first.revision, true));
    await f.view.approveRequest(fresh.id, fresh.revision, true);
    assert.equal(f.responses.length, 1); assert.equal(f.transactions.length, kind === 'eth_sendTransaction' ? 1 : 0);
    await assert.rejects(f.view.resumeSigning(selector));
  } finally { Date.now = now; held.resolve(); await f.controller.dispose(); }
});

for (const change of ['missing-wire', 'changed-wire', 'registration', 'session', 'revocation', 'back', 'expiry'] as const) test(`Trezor EVM Suite continuation refuses ${change} without returning a signature`, async () => {
  const f = await connectedFixture({ hardware: 'Trezor', accountId: 'trezor:60:0' }), held = Promise.withResolvers<void>(), now = Date.now;
  let clock = now(); Date.now = () => clock;
  const connectionId = f.view.getSnapshot().sessions[0]!.id;
  try {
    const first = await messageRequest(f); assert(first); f.setSignWait(held.promise);
    const old = f.view.approveRequest(first.id, first.revision, true), rejected = assert.rejects(old); await settle();
    const selector = f.signingHandoff().id, job = {}; f.signingHandoff().beforeSuiteOpen(clock + 60000, job);
    f.view.backgroundSigning(); f.lock(); held.resolve(); await rejected; await settle();
    if (change === 'missing-wire') f.setPendingOverride('missing');
    else if (change === 'changed-wire') f.setPendingOverride('method');
    else if (change === 'registration') f.changeRegistration();
    else if (change === 'session') f.event({ type: 'session-ended', topic: TOPIC });
    else if (change === 'revocation') await f.view.disconnect(connectionId);
    else if (change === 'back') await f.view.cancelSigningHandoff();
    else clock += 60001;
    f.unlock(); await settle(); await assert.rejects(f.view.resumeSigning(selector)); await settle();
    assert.equal(f.view.getSnapshot().signingReview, null);
    assert(!f.responses.some(value => 'result' in (value as { result: object }).result));
    assert.deepEqual(f.canceledPsbtJobs, [job]);
  } finally { Date.now = now; held.resolve(); await f.controller.dispose(); }
});

for (const stop of ['signature', 'response', 'ordinary-background'] as const) test(`Trezor EVM ${stop} cannot create a Suite resume capability`, async () => {
  const f = await connectedFixture({ hardware: 'Trezor', accountId: 'trezor:60:0' }), held = Promise.withResolvers<void>(), delivered = Promise.withResolvers<void>();
  try {
    const first = await messageRequest(f); assert(first); f.setSignWait(held.promise); f.setDispatchWait(delivered.promise);
    const old = f.view.approveRequest(first.id, first.revision, true), result = old.catch(() => undefined); await settle();
    const selector = f.signingHandoff().id;
    if (stop !== 'ordinary-background') f.signingHandoff().beforeSuiteOpen(Date.now() + 60000, {});
    if (stop === 'signature') f.signingHandoff().beforeSignature();
    if (stop === 'response') { held.resolve(); await settle(); assert.equal(f.handedOff.length, 1); }
    f.view.backgroundSigning(); f.lock(); held.resolve(); delivered.resolve(); await result; f.unlock(); await settle();
    await assert.rejects(f.view.resumeSigning(selector));
  } finally { held.resolve(); delivered.resolve(); await f.controller.dispose(); }
});


test('Trezor EVM resumption drains the old signer before pending lookup and preserves FIFO ahead of later messages', async () => {
  const f = await connectedFixture({ hardware: 'Trezor', accountId: 'trezor:60:0' }), held = Promise.withResolvers<void>();
  try {
    const first = await messageRequest(f); assert(first); f.setSignWait(held.promise);
    const old = f.view.approveRequest(first.id, first.revision, true), rejected = assert.rejects(old); await settle();
    const selector = f.signingHandoff().id; f.signingHandoff().beforeSuiteOpen(Date.now() + 60000, {});
    f.view.backgroundSigning(); f.lock(); f.unlock(); await settle();
    await messageRequest(f, 'personal_sign', ['Later request', ADDRESS], 11);
    assert.equal(f.view.getSnapshot().signingReview, null);
    const returning = f.view.resumeSigning(selector); await settle();
    assert.equal(f.pendingReads(), 0); assert.equal(f.signatures.length, 1);
    held.resolve(); await rejected; await returning; await settle();
    const review = f.view.getSnapshot().signingReview; assert(review?.kind === 'message'); assert.equal(review.message, 'Hello Pali');
    assert.equal(f.signatures.length, 1); assert.equal(f.responses.length, 0);
    await f.view.approveRequest(review.id, review.revision, true);
    await settle(); const next = f.view.getSnapshot().signingReview;
    assert(next?.kind === 'message'); assert.equal(next.message, 'Later request');
  } finally { held.resolve(); await f.controller.dispose(); }
});

test('a failed EVM Suite launch after background cancels only its exact public job', async () => {
  const f = await connectedFixture({ hardware: 'Trezor', accountId: 'trezor:60:0' }), held = Promise.withResolvers<void>(), job = {};
  try {
    const first = await messageRequest(f); assert(first); f.setSignWait(held.promise);
    const old = f.view.approveRequest(first.id, first.revision, true), rejected = assert.rejects(old); await settle();
    const selector = f.signingHandoff().id, launched = f.signingHandoff().beforeSuiteOpen(Date.now() + 60000, job);
    f.view.backgroundSigning(); f.lock(); held.resolve(); await rejected;
    launched(false); await settle(); f.unlock(); await settle();
    await assert.rejects(f.view.resumeSigning(selector));
    assert.deepEqual(f.canceledPsbtJobs, [job]); assert.equal(f.responses.length, 0);
  } finally { held.resolve(); await f.controller.dispose(); }
});


for (const method of ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'] as const)
  for (const freshness of ['unproven', undefined] as const)
    test(`Trezor ${method} refuses ${freshness} transport freshness before queue or custody and cannot upgrade on unlock`, async () => {
      const f = await connectedFixture({ hardware: 'Trezor', accountId: 'trezor:60:0' });
      try {
        const params = method === 'personal_sign' ? ['Hello Pali', ADDRESS] : method === 'eth_sendTransaction' ? [{ from: ADDRESS, to: '0x' + '22'.repeat(20), value: '0x0' }] : [ADDRESS, { types: { EIP712Domain: [], Message: [{ name: 'text', type: 'string' }] }, primaryType: 'Message', domain: {}, message: { text: 'Hello Pali' } }];
        const wire = { id: 10, session: f.session, method, params, freshness, chainId: 'eip155:1', expiresAt: Date.now() + 300000, verification: UNKNOWN } as WalletConnectRequest;
        f.event({ type: 'request', request: wire }); await settle();
        assert.equal(f.view.getSnapshot().signingReview, null); assert.equal(f.signatures.length, 0); assert.equal(f.preparedTransactions.length, 0); assert.equal(f.signingHandoff(), undefined);
        assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, 4200);
        f.lock(); f.unlock(); await settle();
        // Even a later trusted pending read claiming freshness cannot create the
        // descriptor that the original unproven admission was denied.
        f.setPendingOverride('fresh'); await assert.rejects(f.view.resumeSigning('request-1'));
        assert.equal(f.pendingReads(), 0); assert.equal(f.signatures.length, 0); assert.equal(f.preparedTransactions.length, 0);
        f.refresh(); f.event({ type: 'request', request: wire }); await settle();
        assert.equal(f.view.getSnapshot().signingReview, null); assert.equal(f.signatures.length, 0); assert.equal(f.preparedTransactions.length, 0);
      } finally { await f.controller.dispose(); }
    });

for (const hardware of [undefined, 'Ledger'] as const)
  for (const freshness of ['unproven', undefined] as const)
    test(`${hardware ?? 'software'} message policy still accepts ${freshness} non-Suite requests with explicit approval`, async () => {
      const f = await connectedFixture({ hardware, accountId: hardware ? 'ledger:60:0' : 'hd:60:0' });
      try {
        f.event({ type: 'request', request: { id: 10, session: f.session, method: 'personal_sign', params: ['Hello Pali', ADDRESS], freshness, chainId: 'eip155:1', expiresAt: Date.now() + 300000, verification: UNKNOWN } as WalletConnectRequest });
        await settle(); const review = f.view.getSnapshot().signingReview; assert(review?.kind === 'message'); assert.equal(f.signatures.length, 0);
        await f.view.approveRequest(review.id, review.revision, true); assert.equal(f.signatures.length, 1); assert.equal(f.responses.length, 1);
      } finally { await f.controller.dispose(); }
    });


for(const freshness of ['unproven',undefined] as const) test(`Smart account with a Trezor owner refuses ${freshness} dapp wire before custody`,async()=>{
  const f=await connectedFixture({smart:true,smartMessages:true,smartTrezor:true,accountId:'smart:60:0'});
  try{
    f.event({type:'request',request:{freshness,id:10,session:f.session,method:'personal_sign',params:['Hello Pali',ADDRESS],chainId:'eip155:1',expiresAt:Date.now()+300000,verification:UNKNOWN} as WalletConnectRequest});
    await settle();assert.equal(f.view.getSnapshot().signingReview,null);assert.equal(f.signatures.length,0);assert.equal(f.preparedTransactions.length,0);
    assert.equal((f.responses.at(-1) as {result:{error:{code:number}}}).result.error.code,4200);
  }finally{await f.controller.dispose();}
});

test('fresh Smart Trezor message rebuilds consent after unlock without changing selected account or automatically signing',async()=>{
  const f=await connectedFixture({smart:true,smartMessages:true,smartTrezor:true,accountId:'smart:60:0'}),held=Promise.withResolvers<void>();
  try{
    const first=await messageRequest(f);assert(first?.kind==='message');f.setSignWait(held.promise);
    const signing=f.view.approveRequest(first.id,first.revision,true),rejected=assert.rejects(signing);await settle();
    const handoff=f.signingHandoff(),deadline=Date.now()+60000;handoff.beforeSuiteOpen(deadline,{})(true);
    f.view.backgroundSigning();f.lock();held.resolve();await rejected;f.unlock();await settle();
    await f.view.resumeSigning(handoff.id);await settle();
    const fresh=f.view.getSnapshot().signingReview;assert(fresh?.kind==='message');assert.equal(fresh.needsAccountSwitch,false);assert(fresh.expiresAt<=deadline);
    assert.equal(f.signatures.length,1);assert.equal(f.responses.length,0);
    await f.view.approveRequest(fresh.id,fresh.revision,true);assert.equal(f.signatures.length,2);assert.equal(f.responses.length,1);
  }finally{held.resolve();await f.controller.dispose();}
});

test('connected Smart module inventory uses the shared public projection without RPC, signing or persistence', async () => {
  const f = await connectedFixture({ smart: true, moduleInventory: true, accountId: 'smart:60:0' });
  try {
    assert(f.session.namespaces.eip155!.methods.includes('wallet_getSmartAccountModules'));
    const persisted = JSON.stringify([...f.rows]);
    await messageRequest(f, 'wallet_getSmartAccountModules', []);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: {
      address: ADDRESS, chainId: '0x1', deployed: true,
      installed: [{ address: '0x' + '33'.repeat(20), id: 'ecdsa', moduleType: 1, name: undefined }],
      activeValidator: '0x' + '33'.repeat(20),
    } } });
    assert.deepEqual(f.moduleInventoryReads, [{ accountId: 'smart:60:0', networkId: 'ethereum' }]);
    assert.equal(f.readRequests.length, 0); assert.equal(f.signatures.length, 0); assert.equal(f.transactions.length, 0);
    assert.equal(f.view.getSnapshot().signingReview, null); assert.equal(JSON.stringify([...f.rows]), persisted);
  } finally { await f.controller.dispose(); }
});

test('connected EOA module inventory preserves the extension invalid-request behavior', async () => {
  const f = await connectedFixture({ moduleInventory: true });
  try {
    await messageRequest(f, 'wallet_getSmartAccountModules', []);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { error: { code: -32600, message: 'The connected account is not a smart account' } } });
    assert.equal(f.signatures.length, 0); assert.equal(f.transactions.length, 0);
  } finally { await f.controller.dispose(); }
});

for (const change of ['method', 'account'] as const) test(`Smart module inventory refuses a changed ${change} grant namespace`, async () => {
  const f = await connectedFixture({ smart: true, moduleInventory: true, accountId: 'smart:60:0' });
  try {
    if (change === 'method') Object.assign(f.session.namespaces.eip155!, { methods: f.session.namespaces.eip155!.methods.filter(method => method !== 'wallet_getSmartAccountModules') });
    else Object.assign(f.session.namespaces.eip155!, { accounts: [`eip155:1:0x${'22'.repeat(20)}`] });
    await messageRequest(f, 'wallet_getSmartAccountModules', []);
    const response = f.responses.at(-1) as { result: { error: { code: number } } };
    assert.equal(response.result.error.code, 4100); assert.equal(f.moduleInventoryReads.length, 0);
  } finally { await f.controller.dispose(); }
});

for (const change of ['lock', 'network', 'session'] as const) test(`Smart module inventory cannot deliver after ${change} revocation`, async () => {
  const f = await connectedFixture({ smart: true, moduleInventory: true, accountId: 'smart:60:0' });
  let release!: () => void;
  try {
    f.setResponseWait(new Promise(resolve => { release = resolve; }));
    await messageRequest(f, 'wallet_getSmartAccountModules', []);
    assert.equal(f.moduleInventoryReads.length, 1);
    if (change === 'lock') f.lock(); else if (change === 'network') f.selectChain(5700); else f.event({ type: 'session-ended', topic: TOPIC });
    release(); await settle();
    assert.equal(f.responses.length, 0); assert.equal(f.signatures.length, 0); assert.equal(f.transactions.length, 0);
  } finally { release?.(); await f.controller.dispose(); }
});

for (const type of ['Ledger', 'Trezor', 'UTXO'] as const) test(`Smart module inventory is not negotiated for ${type} accounts`, async () => {
  const f = await connectedFixture(type === 'UTXO' ? { moduleInventory: true, utxo: true }
    : { moduleInventory: true, hardware: type, accountId: `${type.toLowerCase()}:60:0` });
  try {
    assert(!Object.values(f.session.namespaces).some(namespace => namespace.methods.includes('wallet_getSmartAccountModules')));
    assert.equal(f.moduleInventoryReads.length, 0);
  } finally { await f.controller.dispose(); }
});

test('Smart module inventory cannot disclose after its response deadline expires', async t => {
  const f = await connectedFixture({ smart: true, moduleInventory: true, accountId: 'smart:60:0' });
  let release!: () => void;
  try {
    f.setResponseWait(new Promise(resolve => { release = resolve; }));
    const expiresAt = Date.now() + 1000;
    f.event({ type: 'request', request: { freshness: 'fresh', id: 10, session: f.session, chainId: 'eip155:1',
      method: 'wallet_getSmartAccountModules', params: [], expiresAt, verification: UNKNOWN } });
    await settle(); assert.equal(f.moduleInventoryReads.length, 1);
    t.mock.method(Date, 'now', () => expiresAt + 1);
    release(); await settle(); assert.equal(f.responses.length, 0);
    assert.equal(f.signatures.length, 0); assert.equal(f.transactions.length, 0);
  } finally { release?.(); await f.controller.dispose(); }
});

const REQUESTED_MODULE = '0x' + '77'.repeat(20);
const MODULE_INSTALL = SMART_ACCOUNT_MODULE_REQUEST_METHODS[0];
const MODULE_UNINSTALL = SMART_ACCOUNT_MODULE_REQUEST_METHODS[1];
const moduleParams = () => [{ address: REQUESTED_MODULE, name: 'Dapp validator', initData: '0x1234', riskAcknowledged: true, acknowledged: true }];
const connectedModuleFixture = (extra: Parameters<typeof connectedFixture>[0] = {}) => connectedFixture({ smart: true, moduleChanges: true, accountId: 'smart:60:0', ...extra });
async function confirmModulePayer(f: Awaited<ReturnType<typeof connectedModuleFixture>>, completing: Promise<void>) {
  await settle();
  const payer = f.view.getSnapshot().signingReview;
  assert(payer?.kind === 'smart-transaction' && payer.operation.payerReview);
  assert.equal(payer.operation.payerReview.transaction.nonce, '9');
  assert.equal(payer.operation.payerReview.maximumFeeUnits, '500000');
  await f.view.confirmSmartPayer(payer.id, payer.revision, payer.operation.payerReview.id);
  await completing;
}

test('dapp module install requires trusted risk acknowledgement and returns the extension response after both authorizations', async () => {
  const f = await connectedModuleFixture();
  try {
    const review = await messageRequest(f, MODULE_INSTALL, moduleParams());
    assert(review?.kind === 'smart-transaction' && review.operation.intent.kind === 'modules');
    assert.equal(review.operation.phase, 'authorize'); assert.equal(review.operation.authorization!.nonce, '7');
    assert.deepEqual(f.moduleChangeRequests[0], { method: MODULE_INSTALL, action: 'install', module: { address: REQUESTED_MODULE, name: 'Dapp validator', initData: '0x1234' } });
    assert(!Object.hasOwn(review.operation.intent.command.draft, 'riskAcknowledged'));
    await assert.rejects(f.view.approveRequest(review.id, review.revision, false), { code: 'UNSUPPORTED_REQUEST' });
    assert.equal(f.signatures.length, 0); assert.equal(f.transactions.length, 0);
    const fresh = f.view.getSnapshot().signingReview; assert(fresh?.kind === 'smart-transaction');
    const completing = f.view.approveRequest(fresh.id, fresh.revision, true);
    await confirmModulePayer(f, completing);
    assert.equal(f.signatures.length, 1); assert.equal(f.transactions.length, 1); assert.equal(f.moduleMetadataReads(), 1);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: { action: 'install', address: REQUESTED_MODULE, success: true } } });
    assert.equal(f.view.getSnapshot().signingReview, null); assert.equal(f.readRequests.length, 0); assert.equal(f.preparedTransactions.length, 0);
  } finally { await f.controller.dispose(); }
});

test('dapp module uninstall uses its existing Smart operation without custom-risk assent', async () => {
  const f = await connectedModuleFixture();
  try {
    const review = await messageRequest(f, MODULE_UNINSTALL, [{ address: REQUESTED_MODULE }]);
    assert(review?.kind === 'smart-transaction');
    await confirmModulePayer(f, f.view.approveRequest(review.id, review.revision, false));
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: { action: 'uninstall', address: REQUESTED_MODULE, success: true } } });
    assert.equal(f.signatures.length, 1); assert.equal(f.transactions.length, 1);
  } finally { await f.controller.dispose(); }
});

test('dapp module metadata-only retry waits for canonical observation and never signs or submits again', async () => {
  const f = await connectedModuleFixture();
  try {
    f.setModuleMetadataUnavailable(true);
    const review = await messageRequest(f, MODULE_INSTALL, moduleParams()); assert(review?.kind === 'smart-transaction');
    await confirmModulePayer(f, f.view.approveRequest(review.id, review.revision, true));
    let current = f.view.getSnapshot().signingReview; assert(current?.kind === 'smart-transaction');
    assert.equal(current.operation.phase, 'complete'); assert.equal(current.operation.metadataRefresh, 'failed');
    assert.equal(f.responses.length, 0);
    await assert.rejects(f.view.approveRequest(current.id, current.revision, true), { code: 'REQUEST_EXPIRED' });
    current = f.view.getSnapshot().signingReview; assert(current?.kind === 'smart-transaction');
    await f.view.retrySmartMetadata(current.id, current.revision);
    assert.equal(f.responses.length, 0); assert.equal(f.moduleMetadataReads(), 2);
    f.setModuleMetadataUnavailable(false);
    current = f.view.getSnapshot().signingReview; assert(current?.kind === 'smart-transaction');
    await f.view.retrySmartMetadata(current.id, current.revision);
    assert.equal(f.moduleMetadataReads(), 3); assert.equal(f.signatures.length, 1); assert.equal(f.transactions.length, 1);
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { result: { action: 'install', address: REQUESTED_MODULE, success: true } } });
  } finally { await f.controller.dispose(); }
});

for (const revoke of ['lock', 'chain', 'session', 'expiry'] as const) test(`dapp module payer cannot submit after ${revoke}`, async () => {
  const f = await connectedModuleFixture();
  let completing: Promise<void> | undefined;
  try {
    const review = await messageRequest(f, MODULE_INSTALL, moduleParams()); assert(review?.kind === 'smart-transaction');
    completing = f.view.approveRequest(review.id, review.revision, true).catch(() => undefined); await settle();
    const payer = f.view.getSnapshot().signingReview; assert(payer?.kind === 'smart-transaction' && payer.operation.payerReview);
    if (revoke === 'lock') f.lock(); else if (revoke === 'chain') f.selectChain(2);
    else if (revoke === 'session') f.event({ type: 'session-ended', topic: TOPIC });
    else f.event({ type: 'request-expired', id: 10 });
    await assert.rejects(f.view.confirmSmartPayer(payer.id, payer.revision, payer.operation.payerReview.id));
    await completing;
    assert.equal(f.transactions.length, 0);
    assert(!f.responses.some(value => 'result' in (value as { result: object }).result));
  } finally { await completing; await f.controller.dispose(); }
});

test('dapp module metadata retry cannot disclose after the request deadline', async t => {
  const f = await connectedModuleFixture();
  try {
    f.setModuleMetadataUnavailable(true);
    const review = await messageRequest(f, MODULE_INSTALL, moduleParams()); assert(review?.kind === 'smart-transaction');
    await confirmModulePayer(f, f.view.approveRequest(review.id, review.revision, true));
    const completed = f.view.getSnapshot().signingReview; assert(completed?.kind === 'smart-transaction');
    t.mock.method(Date, 'now', () => completed.expiresAt + 1);
    await assert.rejects(f.view.retrySmartMetadata(completed.id, completed.revision));
    assert.equal(f.responses.length, 0); assert.equal(f.signatures.length, 1); assert.equal(f.transactions.length, 1);
  } finally { await f.controller.dispose(); }
});

test('dapp module preflight preparation is retired before signing when its owner changes', async () => {
  const f = await connectedModuleFixture();
  let release!: () => void;
  try {
    f.setPreparationWait(new Promise(resolve => { release = resolve; }));
    await messageRequest(f, MODULE_INSTALL, moduleParams());
    f.selectChain(2); release(); await settle();
    assert.equal(f.signatures.length, 0); assert.equal(f.transactions.length, 0); assert.equal(f.view.getSnapshot().signingReview, null);
  } finally { release?.(); await f.controller.dispose(); }
});

test('dapp module action follows the connected account through the existing explicit account switch', async () => {
  const f = await connectedModuleFixture({ secondAccount: true });
  try {
    f.selectDisplayAccount('hd:60:1');
    const review = await messageRequest(f, MODULE_INSTALL, moduleParams()); assert(review);
    assert.equal(review.needsAccountSwitch, true); assert.equal(f.moduleChangeRequests.length, 0);
    await f.view.activateRequestAccount(review.id, review.revision);
    const prepared = f.view.getSnapshot().signingReview; assert(prepared?.kind === 'smart-transaction');
    assert.equal(prepared.needsAccountSwitch, false); assert.equal(f.moduleChangeRequests.length, 1);
  } finally { await f.controller.dispose(); }
});

for (const field of ['method', 'account'] as const) test(`dapp module request cannot bypass changed namespace ${field}`, async () => {
  const f = await connectedModuleFixture();
  try {
    if (field === 'method') Object.assign(f.session.namespaces.eip155!, { methods: f.session.namespaces.eip155!.methods.filter(method => method !== MODULE_INSTALL) });
    else Object.assign(f.session.namespaces.eip155!, { accounts: ['eip155:1:0x' + '22'.repeat(20)] });
    await messageRequest(f, MODULE_INSTALL, moduleParams());
    assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, 4100);
    assert.equal(f.moduleChangeRequests.length, 0); assert.equal(f.signatures.length, 0);
  } finally { await f.controller.dispose(); }
});

test('dapp module requests on an EOA preserve the explicit Smart-account error', async () => {
  const f = await connectedFixture({ moduleChanges: true });
  try {
    await messageRequest(f, MODULE_INSTALL, moduleParams());
    assert.deepEqual(f.responses.at(-1), { id: 10, result: { error: { code: -32600, message: 'The connected account is not a smart account' } } });
    assert.equal(f.moduleChangeRequests.length, 0); assert.equal(f.signatures.length, 0);
  } finally { await f.controller.dispose(); }
});

for (const hardware of ['Ledger', 'Trezor', 'UTXO'] as const) test(`dapp module requests are not negotiated for ${hardware}`, async () => {
  const f = await connectedFixture(hardware === 'UTXO' ? { moduleChanges: true, utxo: true } : { moduleChanges: true, hardware, accountId: `${hardware.toLowerCase()}:60:0` });
  try {
    assert(!Object.values(f.session.namespaces).some(namespace => namespace.methods.some(isMethod => SMART_ACCOUNT_MODULE_REQUEST_METHODS.includes(isMethod as typeof MODULE_INSTALL))));
  } finally { await f.controller.dispose(); }
});

for (const module of [{}, { address: REQUESTED_MODULE, initData: 'not-hex' }]) test(`dapp module semantic validation stays fail closed in the review: ${JSON.stringify(module)}`, async () => {
  const f = await connectedModuleFixture();
  try {
    const review = await messageRequest(f, MODULE_INSTALL, [module]); assert(review);
    assert.equal(review.error, 'TRANSACTION_UNAVAILABLE');
    assert.equal(f.signatures.length, 0); assert.equal(f.transactions.length, 0);
  } finally { await f.controller.dispose(); }
});

test('dapp module response uncertainty stays consumed without metadata retry or resubmission', async () => {
  const f = await connectedModuleFixture();
  try {
    const review = await messageRequest(f, MODULE_INSTALL, moduleParams()); assert(review?.kind === 'smart-transaction');
    f.failDispatch();
    const completing = f.view.approveRequest(review.id, review.revision, true), rejected = assert.rejects(completing, { code: 'DELIVERY_UNCERTAIN' });
    await confirmModulePayer(f, rejected);
    const consumed = f.view.getSnapshot().signingReview; assert(consumed?.kind === 'smart-transaction');
    await assert.rejects(f.view.retrySmartMetadata(consumed.id, consumed.revision));
    await assert.rejects(f.view.approveRequest(consumed.id, consumed.revision, true));
    assert.equal(f.signatures.length, 1); assert.equal(f.transactions.length, 1); assert.equal(f.handedOff.length, 1);
  } finally { await f.controller.dispose(); }
});

test('dapp module metadata retry is revoked while its canonical read is held', async () => {
  const f = await connectedModuleFixture(), held = Promise.withResolvers<void>();
  let waiting: Promise<unknown> | undefined;
  try {
    f.setModuleMetadataUnavailable(true);
    const review = await messageRequest(f, MODULE_INSTALL, moduleParams()); assert(review?.kind === 'smart-transaction');
    await confirmModulePayer(f, f.view.approveRequest(review.id, review.revision, true));
    const completed = f.view.getSnapshot().signingReview; assert(completed?.kind === 'smart-transaction');
    f.setModuleMetadataUnavailable(false); f.setModuleMetadataWait(held.promise);
    waiting = f.view.retrySmartMetadata(completed.id, completed.revision).catch(() => undefined);
    await settle(); f.lock(); held.resolve(); await waiting; await settle();
    assert(!f.responses.some(value => 'result' in (value as { result: object }).result));
    assert.equal(f.signatures.length, 1); assert.equal(f.transactions.length, 1);
  } finally { held.resolve(); await waiting; await f.controller.dispose(); }
});

test('dapp module Smart Trezor continuation rebuilds the same request and requires new risk acknowledgement', async () => {
  const f = await connectedModuleFixture({ smartTrezor: true }), held = Promise.withResolvers<void>();
  try {
    const first = await messageRequest(f, MODULE_INSTALL, moduleParams()); assert(first?.kind === 'smart-transaction');
    f.setSignWait(held.promise);
    const old = f.view.approveRequest(first.id, first.revision, true), rejected = assert.rejects(old); await settle();
    const handoff = f.signingHandoff(), selector = handoff.id;
    handoff.beforeSuiteOpen(Date.now() + 60000, {})(true);
    f.view.backgroundSigning(); f.lock(); held.resolve(); await rejected; await settle();
    f.unlock(); await settle(); await f.view.resumeSigning(selector); await settle();
    const fresh = f.view.getSnapshot().signingReview; assert(fresh?.kind === 'smart-transaction');
    assert.notEqual(fresh.id, first.id); assert.equal(f.moduleChangeRequests.length, 2);
    assert.deepEqual(f.moduleChangeRequests[0], f.moduleChangeRequests[1]);
    await assert.rejects(f.view.approveRequest(fresh.id, fresh.revision, false), { code: 'UNSUPPORTED_REQUEST' });
    const ready = f.view.getSnapshot().signingReview; assert(ready?.kind === 'smart-transaction');
    await confirmModulePayer(f, f.view.approveRequest(ready.id, ready.revision, true));
    assert.equal(f.signatures.length, 1); assert.equal(f.transactions.length, 1); assert.equal(f.responses.length, 1);
  } finally { held.resolve(); await f.controller.dispose(); }
});

for (const changedAfterSuspension of [false, true]) test(`prepared Smart Trezor metadata ${changedAfterSuspension ? 'cannot change after suspension' : 'survives canonical hydration before Suite departure'}`, async () => {
  const f = await connectedModuleFixture({ smartTrezor: true }), held = Promise.withResolvers<void>();
  try {
    f.setSmartSigningBinding('cached-undeployed-constructor');
    f.beforePreparedReturn(() => f.setSmartSigningBinding('hydrated-deployed-same-owner'));
    const first = await messageRequest(f, MODULE_INSTALL, moduleParams()); assert(first?.kind === 'smart-transaction');
    f.setSignWait(held.promise);
    const old = f.view.approveRequest(first.id, first.revision, true), rejected = assert.rejects(old); await settle();
    const handoff = f.signingHandoff(), selector = handoff.id, suiteDeadline = first.expiresAt - 1000, job = {};
    handoff.beforeSuiteOpen(suiteDeadline, job)(true);
    f.view.backgroundSigning(); f.lock(); held.resolve(); await rejected; await settle();
    if (changedAfterSuspension) f.setSmartSigningBinding('changed-owner-policy');
    f.unlock(); await settle();
    if (changedAfterSuspension) {
      await assert.rejects(f.view.resumeSigning(selector));
      assert.equal(f.view.getSnapshot().signingReview, null); assert.deepEqual(f.canceledPsbtJobs, [job]);
      assert.equal(f.signatures.length, 0); assert.equal(f.transactions.length, 0);
      return;
    }
    await f.view.resumeSigning(selector); await settle();
    const fresh = f.view.getSnapshot().signingReview; assert(fresh?.kind === 'smart-transaction');
    assert.notEqual(fresh.id, first.id); assert.equal(fresh.expiresAt, suiteDeadline);
    assert.deepEqual(f.moduleChangeRequests[0], f.moduleChangeRequests[1]);
    assert.equal(f.signatures.length, 0); assert.equal(f.transactions.length, 0);
    await assert.rejects(f.view.approveRequest(fresh.id, fresh.revision, false), { code: 'UNSUPPORTED_REQUEST' });
    const ready = f.view.getSnapshot().signingReview; assert(ready?.kind === 'smart-transaction');
    await confirmModulePayer(f, f.view.approveRequest(ready.id, ready.revision, true));
    assert.equal(f.signatures.length, 1); assert.equal(f.transactions.length, 1); assert.equal(f.responses.length, 1);
  } finally { held.resolve(); await f.controller.dispose(); }
});

test('ordinary prepared Smart transfers retain canonical hydration across the same Suite lifecycle', async () => {
  const f = await connectedFixture({ smart: true, smartTrezor: true, accountId: 'smart:60:0' }), held = Promise.withResolvers<void>();
  try {
    f.setSmartSigningBinding('cached-undeployed-constructor');
    f.beforePreparedReturn(() => f.setSmartSigningBinding('hydrated-deployed-same-owner'));
    const first = await messageRequest(f, 'eth_sendTransaction', [{ from: ADDRESS, to: '0x' + '22'.repeat(20), value: '0x0' }]);
    assert(first?.kind === 'smart-transaction'); f.setSignWait(held.promise);
    const old = f.view.approveRequest(first.id, first.revision, true), rejected = assert.rejects(old); await settle();
    const handoff = f.signingHandoff(), deadline = first.expiresAt - 1000;
    handoff.beforeSuiteOpen(deadline, {})(true);
    f.view.backgroundSigning(); f.lock(); held.resolve(); await rejected; await settle();
    f.unlock(); await settle(); await f.view.resumeSigning(handoff.id); await settle();
    const fresh = f.view.getSnapshot().signingReview; assert(fresh?.kind === 'smart-transaction');
    assert.notEqual(fresh.id, first.id); assert.equal(fresh.expiresAt, deadline);
    assert.equal(f.signatures.length, 0); assert.equal(f.transactions.length, 0);
    const completing = f.view.approveRequest(fresh.id, fresh.revision, false); await settle();
    const payer = f.view.getSnapshot().signingReview; assert(payer?.kind === 'smart-transaction' && payer.operation.payerReview);
    await f.view.confirmSmartPayer(payer.id, payer.revision, payer.operation.payerReview.id); await completing;
    assert.equal(f.signatures.length, 1); assert.equal(f.transactions.length, 1); assert.equal(f.responses.length, 1);
  } finally { held.resolve(); await f.controller.dispose(); }
});

for (const freshness of ['unproven', undefined] as const) test(`dapp module Smart Trezor refuses ${freshness} request freshness`, async () => {
  const f = await connectedModuleFixture({ smartTrezor: true });
  try {
    f.event({ type: 'request', request: { freshness, id: 10, session: f.session, chainId: 'eip155:1', method: MODULE_INSTALL,
      params: moduleParams(), expiresAt: Date.now() + 60000, verification: UNKNOWN } as WalletConnectRequest });
    await settle();
    assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, 4200);
    assert.equal(f.moduleChangeRequests.length, 0); assert.equal(f.signatures.length, 0);
  } finally { await f.controller.dispose(); }
});


for (const existingGrant of [true, false]) test(`Smart creation connects one counterfactual account with existing grant=${existingGrant}`, async () => {
  const f = await connectedFixture({ smartCreation: true });
  try {
    if (!existingGrant) {
      // A protocol session can outlive its separately stored origin grant.
      const permissions = (await f.repository).permissions(f.session.binding);
      await permissions.exclusive(async () => {
        const empty = { dapps: {}, pendingOrigins: [] };
        await permissions.write(empty); permissions.publish(empty);
      });
    }
    await messageRequest(f, 'wallet_prepareSmartAccount', [{ label: 'New dapp account', authenticator: { id: 'ecdsa' } }]);
    const review = f.view.getSnapshot().preparationReview; assert(review, JSON.stringify(f.view.getSnapshot()));
    assert.equal(review.requestedAuthenticatorId, 'ecdsa'); assert.equal(f.creationRequests.length, 0);
    await f.view.approveSmartPreparation(review.id, review.revision, false);
    assert.equal(f.creationRequests.length, 1); assert.equal(f.preparedAccountUpdates.length, 1);
    assert.equal(f.view.getSnapshot().selectedAccountId, 'smart:60:7');
    assert.equal(f.view.getSnapshot().sessions[0]?.accountLabel, 'New dapp account');
    assert.equal(f.view.getSnapshot().preparationReview, null);
    const response = f.responses.at(-1) as { id: number; result: { result: unknown } };
    assert.equal(response.id, 10); assert.deepEqual(response.result.result, { address: '0x' + '77'.repeat(20), chainId: '0x1' });
    assert.equal(f.signatures.length, 0); assert.equal(f.transactions.length, 0);
  } finally { await f.controller.dispose(); }
});

test('Smart creation defaults to unavailable native P256 instead of silently choosing ECDSA', async () => {
  const f = await connectedFixture({ smartCreation: true });
  try {
    await messageRequest(f, 'wallet_prepareSmartAccount', []);
    const review = f.view.getSnapshot().preparationReview; assert(review);
    assert.equal(review.requestedAuthenticatorId, 'p256-webauthn'); assert.equal(review.error, 'PREPARATION_UNAVAILABLE');
    await assert.rejects(f.view.approveSmartPreparation(review.id, review.revision, false));
    assert.equal(f.creationRequests.length, 0); assert.equal(f.preparedAccountUpdates.length, 0);
  } finally { await f.controller.dispose(); }
});

test('Smart creation remote external-owner acknowledgement cannot grant trusted consent', async () => {
  const f = await connectedFixture({ smartCreation: true });
  try {
    await messageRequest(f, 'wallet_prepareSmartAccount', [{ authenticator: { id: 'ecdsa', config: { owners: ['0x' + '99'.repeat(20)], threshold: 1 } }, externalOwnersAcknowledged: true }]);
    const review = f.view.getSnapshot().preparationReview; assert(review);
    assert.deepEqual(review.externalOwners, ['0x' + '99'.repeat(20)]);
    await assert.rejects(f.view.approveSmartPreparation(review.id, review.revision, false));
    assert.equal(f.creationRequests.length, 0); assert.equal(f.signatures.length, 0);
  } finally { await f.controller.dispose(); }
});

test('Smart creation refuses unproven restored requests without allocating an account', async () => {
  const f = await connectedFixture({ smartCreation: true });
  try {
    f.event({ type: 'request', request: { freshness: 'unproven', id: 94, session: f.session, method: 'wallet_prepareSmartAccount',
      chainId: 'eip155:1', params: [{ authenticator: { id: 'ecdsa' } }], verification: UNKNOWN, expiresAt: Date.now() + 60000 } });
    await settle(); assert.equal(f.view.getSnapshot().preparationReview, null);
    assert.equal(f.creationRequests.length, 0);
    assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, 4001);
  } finally { await f.controller.dispose(); }
});

test('Smart creation uncertain namespace update retires the original grant without reallocation', async () => {
  const f = await connectedFixture({ smartCreation: true });
  try {
    f.failCreationUpdate();
    await messageRequest(f, 'wallet_prepareSmartAccount', [{ authenticator: { id: 'ecdsa' } }]);
    const review = f.view.getSnapshot().preparationReview; assert(review);
    await assert.rejects(f.view.approveSmartPreparation(review.id, review.revision, false)); await settle();
    assert.equal(f.creationRequests.length, 1); assert.equal(f.preparedAccountUpdates.length, 1);
    assert.equal(f.view.getSnapshot().sessions.length, 0);
    assert.equal(f.remoteDisconnects.length, 1);
    await assert.rejects(f.view.approveSmartPreparation(review.id, review.revision, false));
    assert.equal(f.creationRequests.length, 1); assert.equal(f.signatures.length, 0);
  } finally { await f.controller.dispose(); }
});


for (const hardware of ['Ledger', 'Trezor'] as const) test(`Smart creation preserves the extension restriction for selected ${hardware}`, async () => {
  const f = await connectedFixture({ smartCreation: true, hardware, accountId: `${hardware.toLowerCase()}:60:0` });
  try {
    await messageRequest(f, 'wallet_prepareSmartAccount', [{ authenticator: { id: 'ecdsa' } }]);
    assert.equal(f.view.getSnapshot().preparationReview, null); assert.equal(f.creationRequests.length, 0);
    assert.equal((f.responses.at(-1) as { result: { error: { code: number } } }).result.error.code, 4874);
  } finally { await f.controller.dispose(); }
});

for (const boundary of ['Reject', 'lock', 'request expiry'] as const) test(`Smart creation ${boundary} during the held new-grant write cannot publish permission`, async () => {
  const f = await connectedFixture({ smartCreation: true }), held = Promise.withResolvers<void>();
  let rejecting: Promise<void> | undefined;
  const visibleGrants: string[] = [];
  const unsubscribe = f.view.subscribe(() => {
    for (const session of f.view.getSnapshot().sessions) visibleGrants.push(session.accountLabel);
  });
  try {
    f.beforeCreationGrantWrite(() => f.setStorageWait(held.promise));
    await messageRequest(f, 'wallet_prepareSmartAccount', [{ label: 'Pending creation grant', authenticator: { id: 'ecdsa' } }]);
    const review = f.view.getSnapshot().preparationReview; assert(review);
    const approving = f.view.approveSmartPreparation(review.id, review.revision, false), rejected = assert.rejects(approving);
    const permissions = (await f.repository).permissions(f.session.binding);
    for (let turn = 0; turn < 30 && !permissions.read().pendingOrigins.includes(ORIGIN); turn++) await settle();
    assert(permissions.read().pendingOrigins.includes(ORIGIN), 'The real shared grant commit must be waiting');
    if (boundary === 'Reject') rejecting = f.view.rejectSmartPreparation(review.id);
    else if (boundary === 'lock') f.lock();
    else f.event({ type: 'request-expired', id: 10 });
    await settle();
    held.resolve(); await rejected; await rejecting; await settle();
    assert.equal(permissions.read().dapps[ORIGIN], undefined);
    assert(!permissions.read().pendingOrigins.includes(ORIGIN));
    assert(!visibleGrants.includes('Pending creation grant'));
    assert.deepEqual(f.creationGrantPublications, [], 'Even a locked UI must never hide an active grant publication');
    assert.equal(f.creationRequests.length, 1); assert.equal(f.preparedAccountUpdates.length, 1);
    assert.equal(f.responses.some(response => (response as { id: number; result: { result?: unknown } }).id === 10 &&
      Object.hasOwn((response as { result: object }).result, 'result')), false);
  } finally { held.resolve(); unsubscribe(); await rejecting; await f.controller.dispose(); }
});
