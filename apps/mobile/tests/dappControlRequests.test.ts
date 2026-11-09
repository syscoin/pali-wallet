import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NativeDappControlRequests,
  type NativeDappControlHost,
} from '../src/connections/controlRequests.ts';
import { createDappReturnTarget } from '../src/connections/pairingReturn.ts';
import { normalizeDappWalletControl } from '../../../source/shared/dappWalletControl.ts';
import { EthereumRpcErrorHandler } from '../../../source/helpers/errors/errorClassesHandlers.ts';
import type { WalletConnectRequest } from '../src/connections/walletConnect.ts';
import { normalizeDappModeRequest } from '../../../source/shared/dappChainScope.ts';

const address = `0x${'11'.repeat(20)}`;
const request = normalizeDappWalletControl('wallet_switchEthereumChain', [
  { chainId: '0xa' },
]);
const verification = { validation: 'UNKNOWN' as const, isScam: false };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
test('control admission rejects a missing required retirement port before opening any host', () => {
  let opened = 0;
  for (const missing of [undefined, null, false])
    assert.throws(() => new NativeDappControlRequests({
      host() { opened++; assert.fail('No host may open'); },
      foreground: () => true, changed() {},
      checkSite: async () => { assert.fail('No site request may start'); },
      respond: async () => { assert.fail('No response may start'); },
      retireCommitted: missing as never,
    }), /Committed control retirement is required/);
  assert.equal(opened, 0);
});
function fixture(
  options: {
    preparation?: Promise<void>;
    commit?: Promise<void>;
    blocked?: boolean;
    transition?: boolean;
    valid?: 'INVALID';
    foreground?: boolean;
    rpcFailure?: boolean;
    afterMutation?: () => void;
  } = {}
) {
  let source = 0,
    connected = true,
    alive = true,
    foreground = options.foreground ?? true,
    blacklist = options.blocked ?? false;
  const wire: WalletConnectRequest = {
    id: 7,
    expiresAt: Date.now() + 60000,
    method: 'wallet_switchEthereumChain',
    chainId: 'eip155:1',
    params: [{ chainId: '0xa' }],
    verification: { ...verification, validation: options.valid ?? 'UNKNOWN' },
    session: {
      binding: {
        topic: 'ab'.repeat(32),
        peerPublicKey: 'cd'.repeat(32),
        origin: 'https://claimed.example',
      },
      metadata: {
        name: 'Unverified claimed name',
        description: '',
        url: 'https://claimed.example',
        icons: [],
      },
      expiry: Math.floor(Date.now() / 1000) + 600,
      namespaces: {
        eip155: {
          accounts: [`eip155:1:${address}`],
          methods: ['wallet_switchEthereumChain'],
          events: [],
        },
      },
    },
  };
  const calls = {
    prepare: 0,
    commit: 0,
    dispose: 0,
    responses: [] as { wire: WalletConnectRequest; response: unknown }[],
    retiredCommits: [] as WalletConnectRequest[],
  };
  const sessionCheck = () => {
    if (!connected || !alive) throw new Error('STALE_SESSION');
  };
  const check = () => {
    sessionCheck();
    if (source !== 0) throw new Error('STALE_CONTEXT');
  };
  const host: NativeDappControlHost = {
    context: () => null,
    async prepare(_request, owner, signal, requestCheck) {
      calls.prepare++;
      if (options.rpcFailure)
        throw new EthereumRpcErrorHandler(4902, 'Chain not found');
      assert.equal(owner.address, address);
      await options.preparation;
      requestCheck();
      return {
        details: {
          kind: 'network-switch',
          chainId: '10',
          name: 'Observed chain',
          rpcUrl: 'https://wallet-rpc.example',
          symbol: 'ETH',
        },
        assertCurrent() {
          requestCheck();
          if (signal.aborted || source !== 0) throw new Error('STALE_PREPARED');
        },
        async commit(commitCheck, onNetworkCommitted) {
          calls.commit++;
          commitCheck();
          await options.commit;
          commitCheck();
          if (options.transition) { source = 1; onNetworkCommitted(); }
          if (options.afterMutation) { options.afterMutation(); commitCheck(); }
          return {
            result: null,
            assertCurrent() {
              commitCheck();
              if (source !== (options.transition ? 1 : 0))
                throw new Error('STALE_COMMIT');
            },
          };
        },
        dispose() {
          calls.dispose++;
        },
      };
    },
  };
  const manager = new NativeDappControlRequests({
    host: () => host,
    foreground: () => foreground,
    changed() {},
    checkSite: async () => ({ isBlacklisted: blacklist }),
    async retireCommitted(wire) { calls.retiredCommits.push(wire); },
    async respond(sent, response, responseCheck) {
      responseCheck();
      calls.responses.push({ wire: sent, response });
    },
  });
  const enqueue = () =>
    manager.enqueue(wire, request, {
      order: 1,
      accountId: 'hd:60:0',
      networkId: 'ethereum',
      accountLabel: 'Account',
      address,
      networkLabel: 'Ethereum',
      networkFamily: 'ethereum',
      chainId: '1',
      assertCurrent: check,
      assertSessionCurrent: sessionCheck,
    });
  return {
    manager,
    calls,
    wire,
    enqueue,
    changeSource: () => {
      source++;
    },
    disconnect: () => {
      connected = false;
    },
    retireOwner: () => {
      alive = false;
    },
    block: () => {
      blacklist = true;
    },
    foreground: () => {
      foreground = true;
    },
  };
}
test('a validated already-in-family mode intent responds without a second user approval', async () => {
  const f = fixture();
  try {
    const wire = { ...f.wire, method: 'eth_changeUTXOEVM', params: [{ chainId: 10 }] };
    f.manager.enqueue(wire, normalizeDappModeRequest(wire.method, wire.params), {
      order: 1, accountId: 'hd:60:0', networkId: 'ethereum', networkFamily: 'ethereum', accountLabel: 'Account', address, networkLabel: 'Ethereum', chainId: '1', assertCurrent() {}, assertSessionCurrent() {},
    });
    await settle();
    assert.equal(f.calls.prepare, 1); assert.equal(f.calls.commit, 1);
    assert.equal(f.manager.review(1), null);
    assert.deepEqual(f.calls.responses.map(value => value.response), [{ result: null }]);
  } finally { await f.manager.dispose(); }
});

test('unverified metadata stays public review data and cannot commit before explicit approval', async () => {
  const f = fixture();
  try {
    f.enqueue();
    await settle();
    const review = f.manager.review(3)!;
    assert.equal(review.appName, 'Unverified claimed name');
    assert.equal(review.origin, 'https://claimed.example');
    assert.equal(review.verification.validation, 'UNKNOWN');
    assert.equal(review.details?.kind, 'network-switch');
    assert.equal(f.calls.commit, 0);
    await f.manager.approve(review.id);
    assert.equal(f.calls.commit, 1);
    assert.equal(f.calls.responses[0]!.wire, f.wire);
    assert.deepEqual(f.calls.responses[0]!.response, { result: null });
    assert.equal(f.manager.size, 0);
  } finally {
    f.manager.clear();
  }
});
test('invalid or blacklisted source never reaches provider preparation', async () => {
  for (const options of [{ valid: 'INVALID' as const }, { blocked: true }]) {
    const f = fixture(options);
    try {
      f.enqueue();
      await settle();
      assert.equal(f.calls.prepare, 0);
      assert.ok(f.manager.review(1)?.error);
      await assert.rejects(f.manager.approve('control-1'));
    } finally {
      f.manager.clear();
    }
  }
});

test('unknown-chain preparation returns 4902 to its originating request so the dapp can ask to add it', async () => {
  const f = fixture({ rpcFailure: true });
  try {
    f.enqueue();
    await settle();
    assert.equal(f.manager.size, 0);
    assert.equal(f.calls.commit, 0);
    assert.deepEqual(f.calls.responses[0]!.response, {
      error: { code: 4902, message: 'Chain not found' },
    });
    assert.equal(f.calls.responses[0]!.wire, f.wire);
  } finally {
    f.manager.clear();
  }
});
test('approval rereads the blacklist and refuses a newly blocked source', async () => {
  const f = fixture();
  try {
    f.enqueue();
    await settle();
    f.block();
    await assert.rejects(f.manager.approve('control-1'), /BLOCKED_SITE/);
    assert.equal(f.calls.commit, 0);
  } finally {
    f.manager.clear();
  }
});
test('normal network transition retains the originating response without extending namespaces', async () => {
  const f = fixture({ transition: true });
  const namespaces = JSON.stringify(f.wire.session.namespaces);
  try {
    f.enqueue();
    await settle();
    await f.manager.approve('control-1');
    assert.equal(f.calls.commit, 1);
    assert.equal(f.calls.responses.length, 1);
    assert.equal(JSON.stringify(f.wire.session.namespaces), namespaces);
  } finally {
    f.manager.clear();
  }
});
test('a known network mutation is retired when its host postcheck expires before returning a receipt', async () => {
  const readNow = Date.now; let now = readNow(); Date.now = () => now;
  const f = fixture({ transition: true, afterMutation: () => { now += 60001; } });
  try {
    f.enqueue(); await settle();
    await assert.rejects(f.manager.approve('control-1'), /REQUEST_EXPIRED/);
    assert.equal(f.calls.commit, 1);
    assert.deepEqual(f.calls.retiredCommits, [f.wire]);
    assert.deepEqual(f.calls.responses, []);
    assert.equal(f.manager.size, 0);
  } finally { Date.now = readNow; f.manager.clear(); }
});
test('context changes before approval revoke its capability', async () => {
  const f = fixture();
  try {
    f.enqueue();
    await settle();
    f.changeSource();
    f.manager.revalidate();
    await assert.rejects(f.manager.approve('control-1'));
    assert.equal(f.calls.commit, 0);
    assert.equal(f.calls.dispose, 1);
  } finally {
    f.manager.clear();
  }
});
test('disconnect during commit cannot deliver a result to a replacement session', async () => {
  const pending = deferred();
  const f = fixture({ commit: pending.promise });
  try {
    f.enqueue();
    await settle();
    const approving = f.manager.approve('control-1');
    await settle();
    f.disconnect();
    f.manager.revalidate();
    pending.resolve();
    await assert.rejects(approving);
    assert.equal(f.calls.responses.length, 0);
  } finally {
    f.manager.clear();
  }
});
test('duplicate approval taps admit exactly one commit', async () => {
  const pending = deferred();
  const f = fixture({ commit: pending.promise });
  try {
    f.enqueue();
    await settle();
    const approving = f.manager.approve('control-1');
    await assert.rejects(f.manager.approve('control-1'));
    pending.resolve();
    await approving;
    assert.equal(f.calls.commit, 1);
  } finally {
    f.manager.clear();
  }
});
test('earlier signing work keeps control preparation queued until its foreground turn', async () => {
  const f = fixture({ foreground: false });
  try {
    f.enqueue();
    await settle();
    assert.equal(f.calls.prepare, 0);
    assert.equal(f.manager.review(0), null);
    f.foreground();
    await f.manager.prepare();
    assert.equal(f.calls.prepare, 1);
    assert.ok(f.manager.review(1));
  } finally {
    f.manager.clear();
  }
});
test('explicit rejection retires an idle review and responds only on its original wire', async () => {
  const f = fixture();
  try {
    f.enqueue();
    await settle();
    await f.manager.reject('control-1');
    assert.equal(f.calls.commit, 0);
    assert.equal(f.calls.responses[0]!.wire, f.wire);
    assert.deepEqual(f.calls.responses[0]!.response, {
      error: { code: 4001, message: 'User rejected or request expired' },
    });
  } finally {
    f.manager.clear();
  }
});
test('expired wire cannot enter the request queue', () => {
  const f = fixture();
  try {
    const expired = { ...f.wire, expiresAt: Date.now() - 1 };
    assert.throws(
      () =>
        f.manager.enqueue(expired, request, {
          order: 1,
          accountId: 'hd:60:0',
          networkId: 'ethereum',
          accountLabel: 'Account',
          address,
          networkLabel: 'Ethereum',
      networkFamily: 'ethereum',
          chainId: '1',
          assertCurrent() {},
          assertSessionCurrent() {},
        }),
      /REQUEST_EXPIRED/
    );
    assert.equal(f.calls.prepare, 0);
  } finally {
    f.manager.clear();
  }
});

test('disposal revokes immediately and joins a held control operation before returning', async () => {
  const pending = deferred();
  const f = fixture({ commit: pending.promise });
  f.enqueue();
  await settle();
  const approving = f.manager.approve('control-1');
  const rejected = assert.rejects(approving);
  await settle();
  let closed = false;
  const closing = f.manager.dispose().then(() => {
    closed = true;
  });
  assert.equal(f.manager.size, 0);
  await settle();
  assert.equal(closed, false);
  pending.resolve();
  await rejected;
  await closing;
  assert.equal(closed, true);
  assert.equal(f.calls.responses.length, 0);
  assert.throws(f.enqueue, /REQUEST_EXPIRED/);
});
test('return targets never accept redirects, executable schemes, credentials, paths or claimed verification', () => {
  for (const origin of [
    'javascript:alert(1)',
    'dapp://authorize?x=1',
    'http://claimed.example',
    'https://user@claimed.example',
    'https://claimed.example/pay',
    'https://claimed.example?send=1',
    'https://claimed.example#send',
  ])
    assert.equal(createDappReturnTarget(origin, verification), null);
  const target = createDappReturnTarget(
    'https://claimed.example',
    verification
  )!;
  assert.equal(target.url, 'https://claimed.example/');
  assert.equal(target.verification.validation, 'UNKNOWN');
  assert.equal(
    createDappReturnTarget('https://claimed.example', {
      validation: 'INVALID',
      isScam: false,
    }),
    null
  );
  assert.equal(
    createDappReturnTarget('https://claimed.example', {
      validation: 'VALID',
      isScam: true,
    }),
    null
  );
});
