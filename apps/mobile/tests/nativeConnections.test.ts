import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeConnectionsController } from '../src/connections/controller.ts';
import type { NativeConnectionHost } from '../src/connections/host.ts';
import type {
  WalletConnectTransportEvent,
  WalletConnectSession,
  WalletConnectProposal,
  WalletConnectVerification,
} from '../src/connections/walletConnect.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';
import type { INetwork, KeyringAccountType } from '../../../source/types/network.ts';
import { openNativeConnectionRepository } from '../src/connections/storage.ts';
import { captureEvmFeeApproval } from '../../../source/shared/evmFeeApproval.ts';
import type { NativeSigningReview } from '../src/connections/types.ts';
import { snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { Interface } from 'ethers/abi';
import { summarizeApproval, type ApprovalContractMetadata } from '../../../source/shared/approval.ts';

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
function fixture(options: {
  secondAccount?: boolean;
  restoring?: boolean;
  openFailures?: number;
  inventoryFailures?: number;
} = {}) {
  const { secondAccount = false } = options;
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
  let signWait: Promise<void> = Promise.resolve();
  let preparationError: Error | undefined;
  let preparationWait: Promise<void> = Promise.resolve();
  let approvalMetadata: ApprovalContractMetadata | undefined;
  const preparedTransactions: Record<string, unknown>[] = [];
  let activationWait: Promise<void> = Promise.resolve();
  let siteBlocked = false;
  let siteWait: Promise<void> = Promise.resolve();
  let blacklistedAddress = false;
  let selectedAccountId = 'hd:60:0';
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
  let dispatchWait: Promise<void> = Promise.resolve();
  let dispatchFailure: Error | undefined;
  const handedOff: unknown[] = [];
  let emissionWait: Promise<void> = Promise.resolve();
  let pairWait: Promise<void> = Promise.resolve();
  let disconnectWait: Promise<void> = Promise.resolve();
  let rejectFailure: Error | undefined;
  let pairFailure: { error: Error; beforeHandle: boolean } | undefined;
  let selectedChainId = 1;
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
  const host: Omit<NativeConnectionHost, 'repository'> = {
    walletBindingId: 'd4'.repeat(32),
    assertOwner() {},
    sessionGeneration: () => snapshot.revision,
    async activateRequestAccount(accountId, guard) {
      guard();
      await activationWait;
      guard();
      selectedAccountId = accountId;
      snapshot = { ...snapshot, revision: snapshot.revision + 1 };
      for (const listener of listeners) listener();
      guard();
    },
    async signMessage(input) {
      input.approval.assertCurrent();
      assert.equal(input.accountId, selectedAccountId);
      signatures.push(input.request);
      await signWait;
      input.approval.assertCurrent();
      return '0x' + '12'.repeat(65);
    },
    async prepareTransaction(input, check) {
      check();
      await preparationWait;
      check();
      if (preparationError) throw preparationError;
      input.approval.assertCurrent();
      assert.equal(input.accountId, selectedAccountId);
      const value = input.transaction as Record<string, unknown>;
      preparedTransactions.push(value);
      const transaction = snapshotPreparedEvmTransaction({
        from: ADDRESS, to: value.to ?? null, chainId: '1', value: BigInt(value.value as string ?? '0').toString(),
        data: String(value.data ?? '0x'), nonce: BigInt(value.nonce as string ?? '0').toString(), gasLimit: '50000',
        type: 2, accessList: value.accessList ?? [], maxFeePerGas: '10', maxPriorityFeePerGas: '1',
      });
      const fee = captureEvmFeeApproval(transaction, 'fixture', Math.floor(performance.now()) + 60000);
      return {
        transaction,
        maximumFeeUnits: fee.maximumFeeUnits,
        maximumTotalUnits: fee.maximumTotalUnits,
        expiresAtMonotonicMilliseconds: fee.expiresAtMonotonicMilliseconds,
        approval: transaction.to ? summarizeApproval(transaction.data, transaction.to, approvalMetadata) : null,
        async submit(guard, onBroadcast) {
          guard();
          input.approval.assertCurrent();
          transactions.push(fee.transaction);
          const hash = '0x' + '34'.repeat(32);
          onBroadcast(hash);
          return hash;
        },
      };
    },
    context: () => ({
      network: { ...network, chainId: selectedChainId } as ReturnType<
        NativeConnectionHost['context']
      >['network'],
      networkId: 'ethereum',
      networkLabel: 'Ethereum',
      activeAccountId: snapshot.phase === 'ready' ? selectedAccountId : null,
      unlocked: snapshot.phase === 'ready',
      accounts:
        snapshot.phase === 'ready'
          ? [
              {
                id: 'hd:60:0',
                index: 0,
                type: 'HDAccount',
                address: ADDRESS,
                xpub: 'private-host-public-xpub',
                label: 'Account 1',
              },
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
      eip155: {
        accounts: [`eip155:1:${ADDRESS}`],
        chains: ['eip155:1'],
        methods: [
          'eth_accounts',
          'eth_chainId',
          'eth_sendTransaction',
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
    pairingTopic: PAIRING,
    peerPublicKey: PEER,
    metadata: session.metadata,
    verification: UNKNOWN,
    requiredNamespaces: {},
    optionalNamespaces: {
      eip155: {
        chains: ['eip155:1'],
        methods: [
          'eth_accounts',
          'eth_chainId',
          'eth_sendTransaction',
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
            accountType: 'HDAccount' as KeyringAccountType,
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
    openHost: async () => ({ ...host, repository: await restoredRepository }),
    preparePlatform: async () => undefined,
    checkSite: async () => {
      await siteWait;
      return { isBlacklisted: siteBlocked };
    },
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
    openTransport: async (options) => {
      opened++;
      transportEvents.push(options.onEvent);
      await openWait;
      if (openFailures-- > 0)
        throw new Error('Transport temporarily unavailable');
      event = options.onEvent;
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
          assert.equal(
            namespaces.eip155!.methods.includes('personal_sign'),
            true
          );
          await approveWait;
          Object.assign(session, { namespaces });
          return session;
        },
        reject: async () => {
          if (rejectFailure) throw rejectFailure;
        },
        disconnect: async () => {
          await disconnectWait;
        },
        respond: async (_binding, id, result, guard, onDispatch) => {
          await responseWait;
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
    controller,
    view: controller.view,
    rows,
    responses,
    handedOff,
    setDispatchWait(value: Promise<void>) {
      dispatchWait = value;
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
    event: (value: WalletConnectTransportEvent) => event(value),
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
    closed: () => closed,
    pairCanceled: () => pairCanceled,
    refresh() {
      snapshot = { ...snapshot, revision: snapshot.revision + 1 };
      for (const listener of listeners) listener();
    },
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
      request: {
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
      request: {
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
      request: {
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
      request: {
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
    const rejected = assert.rejects(oldPair, { message: 'old SDK failure' });
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
    const rejected = assert.rejects(pairing, { message: 'SDK failure' });
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
        request: {
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
    options.accountId ?? 'hd:60:0',
    'ethereum',
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
    request: {
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
      request: {
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
      request: {
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

for (const method of ['personal_sign', 'eth_sendTransaction'] as const) {
  test(`an asynchronous connection failure retires a pending ${method} review`, async () => {
    const f = await connectedFixture();
    let release!: () => void;
    try {
      const params = method === 'personal_sign'
        ? ['Pending message', ADDRESS]
        : [{ from: ADDRESS, to: '0x' + '22'.repeat(20), value: '0x1' }];
      const review = await messageRequest(f, method, params);
      assert.ok(review);
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
