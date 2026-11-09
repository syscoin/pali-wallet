import { networkSelectionReceiptFixture } from './networkSelectionReceiptFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeDappControlHost } from '../src/custody/dappControl.ts';
import {
  createNativeNetwork,
  type NativeNetworkRegistration,
} from '../src/custody/networkContext.ts';
import type {
  NativeNetworkSnapshot,
  NativeNetworkView,
} from '../src/custody/networkView.ts';
import { normalizeDappWalletControl } from '../../../source/shared/dappWalletControl.ts';
import type { NativeDappControlContext } from '../src/connections/controlRequests.ts';

const address = `0x${'12'.repeat(20)}`,
  owner = { accountId: 'hd:60:0', networkId: 'ethereum', address };
const registration = (id: string, chainId: string) =>
  createNativeNetwork({
    id,
    chainId,
    kind: 'evm',
    name: `Observed chain ${chainId}`,
    slip44: 60,
    rpcUrl: `https://rpc${chainId}.example`,
    symbol: 'ETH',
    decimals: 18,
    testnet: false,
  });
const first = registration('ethereum', '1'),
  second = registration('optimism', '10');
const row = (value: NativeNetworkRegistration) => ({
  id: value.id,
  name: value.name,
  symbol: value.symbol,
  testnet: value.testnet,
  canSign: true,
  registration: value,
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture(wait?: Promise<void>, options: { utxo?: boolean; unexpectedAccount?: boolean; unexpectedRevision?: boolean; afterSelection?: () => void } = {}) {
  let context: NativeDappControlContext = { revision: 1, catalogueRevision: 1, activeAccountId: options.utxo ? 'hd:57:0' : owner.accountId, networkId: options.utxo ? 'syscoin' : owner.networkId, networkLabel: 'Ethereum', accounts: [{ id: owner.accountId, address, index: 0, type: 'HDAccount' as const, slip44: 60, label: 'Account' }, { id: 'hd:60:1', address: `0x${'34'.repeat(20)}`, index: 1, type: 'HDAccount' as const, slip44: 60, label: 'Display default' }] },
    cancelled = false;
  let snapshot: NativeNetworkSnapshot = {
    revision: 1,
    selectedId: context.networkId,
    networks: [row(first), row(second)],
  };
  const calls = { select: 0, save: 0, cancel: 0, fetch: 0, asset: 0 };
  const networks: NativeNetworkView = {
    async loadCatalogue() {
      throw new Error('Catalogue offline');
    },
    getSnapshot: () => snapshot,
    getContextRevision: () => context.revision,
    subscribe: () => () => {},
    async select(id, revision, catalogueRevision, onCommitted) {
      assert.equal(revision, context.revision);
      assert.equal(catalogueRevision, snapshot.revision);
      calls.select++;
      await wait;
      if (cancelled) throw new Error('CANCELLED');
      context = { ...context, networkId: id, activeAccountId: options.unexpectedAccount ? owner.accountId : options.utxo ? 'hd:60:1' : context.activeAccountId, revision: context.revision + (options.unexpectedRevision ? 2 : 1), catalogueRevision: context.catalogueRevision + 1 };
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        selectedId: id,
      };
      const target = snapshot.networks.find(network => network.id === id)?.registration;
      if (!target) throw new Error('Invalid fixture target');
      const accountId = options.utxo ? 'hd:60:1' : owner.accountId;
      const selectedAddress = context.accounts.find(account => account.id === accountId)!.address;
      options.afterSelection?.();
      const receipt = networkSelectionReceiptFixture(target, { accountId, address: selectedAddress, networkId: id }, revision, catalogueRevision, () => {
        if (context.activeAccountId !== accountId || context.revision !== revision + 1 || snapshot.revision !== catalogueRevision + 1 || snapshot.selectedId !== id) throw new Error('CONTEXT_CHANGED');
      });
      onCommitted(receipt);
      return receipt;
    },
    async save(value, revision, catalogueRevision) {
      assert.equal(revision, context.revision);
      assert.equal(catalogueRevision, snapshot.revision);
      calls.save++;
      context = { ...context, revision: context.revision + 1, catalogueRevision: context.catalogueRevision + 1 };
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        networks: [...snapshot.networks, row(value)],
      };
    },
    cancel() {
      cancelled = true;
      calls.cancel++;
    },
  };
  const host = createNativeDappControlHost({
    networks,
    utxoNetworks: () => [],
    context: () => context,
    previewNetworkSelection: id => ({ accountId: options.utxo ? 'hd:60:1' : context.activeAccountId, address: options.utxo ? `0x${'34'.repeat(20)}` : address, networkId: id }),
    async fetch(_url, init) {
      calls.fetch++;
      const input = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: input.id, result: '0x89' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    },
    async prepareWatchAsset() {
      calls.asset++;
      throw new Error('Observed asset port');
    },
  });
  return {
    host,
    calls,
    snapshot: () => snapshot,
    replace: () => {
      snapshot = { ...snapshot, revision: snapshot.revision + 1 };
    },
    changeAccount: () => {
      context = { ...context, activeAccountId: 'hd:60:1' };
    },
  };
}
test('switch capability admits only the saved endpoint and retains a post-transition guard', async () => {
  const f = fixture();
  const controller = new AbortController();
  const prepared = await f.host.prepare(
    normalizeDappWalletControl('wallet_switchEthereumChain', [
      { chainId: '0xa' },
    ]),
    owner,
    controller.signal,
    () => {}
  );
  try {
    assert.equal(prepared.details.kind, 'network-switch');
    assert.equal(
      'rpcUrl' in prepared.details && prepared.details.rpcUrl,
      second.rpcUrl
    );
    assert.equal(f.calls.select, 0);
    const result = await prepared.commit(() => {}, () => {});
    assert.equal(result.result, null);
    result.assertCurrent();
    assert.equal(f.snapshot().selectedId, second.id);
    f.replace();
    assert.throws(result.assertCurrent);
    assert.equal(f.calls.select, 1);
  } finally {
    prepared.dispose();
  }
});
test('unknown switch fails with 4902 before provider I/O', async () => {
  const f = fixture();
  await assert.rejects(
    f.host.prepare(
      normalizeDappWalletControl('wallet_switchEthereumChain', [
        { chainId: '0x89' },
      ]),
      owner,
      new AbortController().signal,
      () => {}
    ),
    { code: 4902 }
  );
  assert.equal(f.calls.fetch, 0);
  assert.equal(f.calls.select, 0);
});
for (const fault of ['none', 'account', 'revision'] as const) test(`cross-family switch binds the exact catalogue preview (${fault})`, async () => {
  const f = fixture(undefined, { utxo: true, unexpectedAccount: fault === 'account', unexpectedRevision: fault === 'revision' });
  const prepared = await f.host.prepare(normalizeDappWalletControl('wallet_switchEthereumChain', [{ chainId: '0x1' }]), { ...owner, networkId: 'syscoin' }, new AbortController().signal, () => {});
  try {
    assert.equal(prepared.details.kind, 'network-switch');
    if (fault === 'none') {
      const result = await prepared.commit(() => {}, () => {});
      result.assertCurrent();
      assert.equal(f.host.context()?.activeAccountId, 'hd:60:1');
      assert.equal(f.host.context()?.networkId, 'ethereum');
    } else await assert.rejects(prepared.commit(() => {}, () => {}), /CONTEXT_CHANGED/);
    assert.equal(f.calls.select, 1);
  } finally { prepared.dispose(); }
});
test('a proven EVM selection notifies before an expired caller postcheck without reporting success', async () => {
  let expired = false, committed = 0;
  const f = fixture(undefined, { afterSelection: () => { expired = true; } });
  const check = () => { if (expired) throw new Error('REQUEST_EXPIRED'); };
  const prepared = await f.host.prepare(normalizeDappWalletControl('wallet_switchEthereumChain', [{ chainId: '0xa' }]), owner, new AbortController().signal, check);
  try {
    await assert.rejects(prepared.commit(check, () => { committed++; }), /REQUEST_EXPIRED/);
    assert.equal(f.calls.select, 1);
    assert.equal(f.snapshot().selectedId, second.id);
    assert.equal(committed, 1);
  } finally { prepared.dispose(); }
});
test('EVM selection refuses an absent required commit notification before mutation', async () => {
  const f = fixture();
  const prepared = await f.host.prepare(normalizeDappWalletControl('wallet_switchEthereumChain', [{ chainId: '0xa' }]), owner, new AbortController().signal, () => {});
  try {
    await assert.rejects(prepared.commit(() => {}, undefined as never), /CONTEXT_CHANGED/);
    assert.equal(f.calls.select, 0);
    assert.equal(f.calls.save, 0); assert.equal(f.calls.fetch, 0);
  } finally { prepared.dispose(); }
});
test('adding a known chain never replaces its RPC with the proposed endpoint', async () => {
  const f = fixture();
  const prepared = await f.host.prepare(
    normalizeDappWalletControl('wallet_addEthereumChain', [
      { chainId: '0xa', rpcUrls: ['https://untrusted.example'] },
    ]),
    owner,
    new AbortController().signal,
    () => {}
  );
  try {
    assert.equal(
      'rpcUrl' in prepared.details && prepared.details.rpcUrl,
      second.rpcUrl
    );
    await prepared.commit(() => {}, () => {});
    assert.equal(f.calls.save, 0);
    assert.equal(f.calls.fetch, 0);
    assert.equal(f.snapshot().selectedId, first.id);
  } finally {
    prepared.dispose();
  }
});
test('new registration verifies the provider before review and uses existing guarded network save', async () => {
  const f = fixture();
  const prepared = await f.host.prepare(
    normalizeDappWalletControl('wallet_addEthereumChain', [
      {
        chainId: '0x89',
        chainName: 'Requested label',
        nativeCurrency: { symbol: 'POL', decimals: 18 },
        rpcUrls: ['https://rpc137.example'],
      },
    ]),
    owner,
    new AbortController().signal,
    () => {}
  );
  try {
    assert.equal(f.calls.fetch, 1);
    assert.equal(f.calls.save, 0);
    const result = await prepared.commit(() => {}, () => {});
    result.assertCurrent();
    assert.equal(f.calls.save, 1);
    assert.equal(f.snapshot().selectedId, first.id);
    assert.ok(
      f.snapshot().networks.some((row) => row.registration?.chainId === '137')
    );
  } finally {
    prepared.dispose();
  }
});
test('catalogue replacement or account change invalidates the reviewed capability', async () => {
  for (const change of ['catalogue', 'account']) {
    const f = fixture();
    const prepared = await f.host.prepare(
      normalizeDappWalletControl('wallet_switchEthereumChain', [
        { chainId: '0xa' },
      ]),
      owner,
      new AbortController().signal,
      () => {}
    );
    try {
      if (change === 'catalogue') f.replace();
      else f.changeAccount();
      await assert.rejects(prepared.commit(() => {}, () => {}));
      assert.equal(f.calls.select, 0);
    } finally {
      prepared.dispose();
    }
  }
});
test('request abort cancels its admitted network operation and cannot select later', async () => {
  const wait = deferred();
  const f = fixture(wait.promise),
    controller = new AbortController();
  const prepared = await f.host.prepare(
    normalizeDappWalletControl('wallet_switchEthereumChain', [
      { chainId: '0xa' },
    ]),
    owner,
    controller.signal,
    () => {}
  );
  try {
    const committing = prepared.commit(() => {}, () => {});
    controller.abort();
    wait.resolve();
    await assert.rejects(committing);
    assert.equal(f.calls.cancel, 1);
    assert.equal(f.snapshot().selectedId, first.id);
  } finally {
    prepared.dispose();
  }
});
