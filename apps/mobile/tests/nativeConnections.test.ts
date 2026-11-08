import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeConnectionsController } from '../src/connections/controller.ts';
import type { NativeConnectionHost } from '../src/connections/host.ts';
import type {
  WalletConnectTransportEvent,
  WalletConnectSession,
  WalletConnectProposal,
} from '../src/connections/walletConnect.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';
import { openNativeConnectionRepository } from '../src/connections/storage.ts';

const TOPIC = 'a1'.repeat(32),
  PEER = 'b2'.repeat(32),
  PAIRING = 'c3'.repeat(32);
const ADDRESS = '0x' + '11'.repeat(20),
  ORIGIN = 'https://reported.example';
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
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
  let emissionWait: Promise<void> = Promise.resolve();
  let pairWait: Promise<void> = Promise.resolve();
  let disconnectWait: Promise<void> = Promise.resolve();
  let rejectFailure: Error | undefined;
  let pairFailure: { error: Error; beforeHandle: boolean } | undefined;
  let selectedChainId = 1;
  let pairingExpiry = Date.now() + 300000;
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
    context: () => ({
      network: { ...network, chainId: selectedChainId } as ReturnType<
        NativeConnectionHost['context']
      >['network'],
      networkId: 'ethereum',
      networkLabel: 'Ethereum',
      activeAccountId: snapshot.phase === 'ready' ? 'hd:60:0' : null,
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
        methods: ['eth_accounts', 'eth_chainId'],
        events: ['accountsChanged', 'chainChanged'],
      },
    },
  };
  const proposal: WalletConnectProposal = {
    id: 3,
    pairingTopic: PAIRING,
    peerPublicKey: PEER,
    metadata: session.metadata,
    requiredNamespaces: {},
    optionalNamespaces: {
      eip155: {
        chains: ['eip155:1'],
        methods: ['eth_accounts', 'eth_chainId', 'personal_sign'],
        events: ['accountsChanged'],
      },
    },
  };
  const controller = new NativeConnectionsController({
    source: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(() => listener(snapshot));
        return () => listeners.clear();
      },
    },
    openHost: async () => ({ ...host, repository: await repository }),
    preparePlatform: async () => undefined,
    projectId: 'public-fixture-id',
    metadata: {
      name: 'Pali',
      description: '',
      url: 'https://paliwallet.com',
      icons: [],
    },
    openTransport: async (options) => {
      opened++;
      await openWait;
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
            false
          );
          await approveWait;
          return session;
        },
        reject: async () => {
          if (rejectFailure) throw rejectFailure;
        },
        disconnect: async () => {
          await disconnectWait;
        },
        respond: async (_binding, id, result, guard) => {
          await responseWait;
          guard();
          responses.push({ id, result });
        },
        emit: async (_binding, chain, value, guard) => {
          await emissionWait;
          guard();
          assert(session.namespaces.eip155!.chains!.includes(chain));
          emissionScopes.push(chain);
          emissions.push(value);
        },
        sessions: async () => [],
        close: async () => {
          closed++;
        },
      };
    },
  });
  return {
    controller,
    view: controller.view,
    rows,
    responses,
    emissions,
    emissionScopes,
    session,
    proposal,
    event: (value: WalletConnectTransportEvent) => event(value),
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

test('required signing methods remain unavailable and cancel affects only the new pairing', async () => {
  const f = fixture();
  await settle();
  await f.view.pair('wc:fixture');
  try {
    f.event({
      type: 'proposal',
      proposal: {
        ...f.proposal,
        requiredNamespaces: { eip155: { methods: ['personal_sign'] } },
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
