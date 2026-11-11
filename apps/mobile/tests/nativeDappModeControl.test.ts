import { networkSelectionReceiptFixture } from './networkSelectionReceiptFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareNativeDappModeControl } from '../src/custody/dappModeControl.ts';
import { normalizeDappModeRequest } from '../../../source/shared/dappChainScope.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import type { NativeDappControlContext } from '../src/connections/controlRequests.ts';
import type { NativeNetworkSnapshot, NativeNetworkView } from '../src/custody/networkView.ts';
import { UTXO_ADDRESSES } from './publicWatchFixtures.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createNativeNetworkView } from '../src/custody/networkView.ts';
import { NativeDappControlRequests } from '../src/connections/controlRequests.ts';
import { CustodyRuntimeError, type CustodyRuntime } from '../src/custody/types.ts';
import type { NativeWalletCatalogueSnapshot } from '../src/custody/walletCatalogue.ts';
import type { WalletConnectRequest } from '../src/connections/walletConnect.ts';

const evm = getNativeNetwork('ethereum'), syscoin = getUtxoNetwork('syscoin');
function fixture(fault = false, afterSelection?: () => void) {
  const accounts = [
    { id: 'hd:60:0', type: 'HDAccount' as const, index: 0, slip44: 60, address: `0x${'11'.repeat(20)}`, label: 'Ethereum' },
    { id: 'hd:57:0', type: 'HDAccount' as const, index: 0, slip44: 57, address: UTXO_ADDRESSES.syscoin, label: 'Syscoin' },
  ];
  let context: NativeDappControlContext = { revision: 7, catalogueRevision: 3, activeAccountId: accounts[0]!.id, networkId: evm.id, networkLabel: evm.name, accounts };
  let snapshot: NativeNetworkSnapshot = { revision: 3, selectedId: evm.id, networks: [{ ...evm, canSign: true, registration: evm }, { ...syscoin, canSign: true }] };
  let selections = 0;
  const networks: NativeNetworkView = {
    getSnapshot: () => snapshot, getContextRevision: () => context.revision, subscribe: () => () => {}, cancel() {},
    async select(id, revision, catalogueRevision, onCommitted) {
      assert.equal(revision, context.revision); assert.equal(catalogueRevision, snapshot.revision); selections++;
      context = { ...context, revision: context.revision + 1, catalogueRevision: context.catalogueRevision + 1, networkId: id, activeAccountId: fault ? accounts[0]!.id : accounts[1]!.id };
      snapshot = { ...snapshot, revision: snapshot.revision + 1, selectedId: id };
      afterSelection?.();
      const receipt = networkSelectionReceiptFixture(syscoin, { networkId: id, accountId: accounts[1]!.id, address: accounts[1]!.address }, revision, catalogueRevision, () => {
        if (context.activeAccountId !== accounts[1]!.id || snapshot.selectedId !== id || context.revision !== revision + 1) throw new Error('CONTEXT_CHANGED');
      });
      onCommitted(receipt);
      return receipt;
    },
  };
  const ports = { networks, context: () => context, utxoNetworks: () => [syscoin] };
  return { ports, owner: { accountId: accounts[0]!.id, address: accounts[0]!.address, networkId: evm.id }, selections: () => selections };
}
test('existing-group family selection retains the full registered network and exact intended account', async () => {
  const f = fixture();
  const prepared = prepareNativeDappModeControl(f.ports, normalizeDappModeRequest('sys_changeUTXOEVM', [{ chainId: 57 }]), f.owner, new AbortController().signal, () => {});
  assert.equal(prepared.details.kind, 'network-switch'); assert.equal(f.selections(), 0);
  const result = await prepared.commit(() => {}, () => {}); result.assertCurrent(); assert.equal(f.selections(), 1);
  assert.equal(f.ports.context().activeAccountId, 'hd:57:0'); prepared.dispose();
});
test('a different post-selection account cannot replace the previewed group', async () => {
  const f = fixture(true);
  const prepared = prepareNativeDappModeControl(f.ports, normalizeDappModeRequest('sys_changeUTXOEVM', [{ chainId: 57 }]), f.owner, new AbortController().signal, () => {});
  let committed = 0;
  await assert.rejects(prepared.commit(() => {}, () => { committed++; }), /CONTEXT_CHANGED/);
  assert.equal(committed, 0); prepared.dispose();
});
test('a proven mode selection reports its commit before an expired request postcheck', async () => {
  let expired = false, committed = 0;
  const f = fixture(false, () => { expired = true; });
  const check = () => { if (expired) throw new Error('REQUEST_EXPIRED'); };
  const prepared = prepareNativeDappModeControl(f.ports, normalizeDappModeRequest('sys_changeUTXOEVM', [{ chainId: 57 }]), f.owner, new AbortController().signal, check);
  try {
    await assert.rejects(prepared.commit(check, () => { committed++; }), /REQUEST_EXPIRED/);
    assert.equal(f.selections(), 1);
    assert.equal(committed, 1);
  } finally { prepared.dispose(); }
});
test('mode selection refuses an absent required commit notification before mutation', async () => {
  const f = fixture();
  const prepared = prepareNativeDappModeControl(f.ports, normalizeDappModeRequest('sys_changeUTXOEVM', [{ chainId: 57 }]), f.owner, new AbortController().signal, () => {});
  try {
    await assert.rejects(prepared.commit(() => {}, undefined as never), /CONTEXT_CHANGED/);
    assert.equal(f.selections(), 0);
  } finally { prepared.dispose(); }
});

for (const committed of [false, true]) test(`real authority ${committed ? 'held post-persistence readback expiry retires a proven mode change' : 'precommit failure cannot report a committed mode change'}`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const readNow = Date.now; let now = readNow(); Date.now = () => now;
  const readEntered = Promise.withResolvers<void>(), readGate = Promise.withResolvers<void>();
  const evm = getNativeNetwork('ethereum'), target = getUtxoNetwork('syscoin');
  const accounts = [
    { id: 'hd:60:0', index: 0, type: 'HDAccount' as const, slip44: 60, address: `0x${'11'.repeat(20)}`, label: 'Ethereum' },
    { id: 'hd:57:0', index: 0, type: 'HDAccount' as const, slip44: 57, address: UTXO_ADDRESSES.syscoin, label: 'Syscoin' },
  ];
  let catalogue: NativeWalletCatalogueSnapshot = { revision: 1, active: { accountId: accounts[0]!.id, networkId: evm.id }, accounts, networks: [evm], utxoNetworks: [target] };
  let persisted = false, unlocked = false;
  const runtime: CustodyRuntime = {
    session: { async createWallet() { assert.fail('No wallet creation'); }, async importWallet() { assert.fail('No wallet import'); }, async unlock() { unlocked = true; return { authenticated: true }; },
      async lock() { unlocked = false; }, async readSelectedAddress() { assert(unlocked); return accounts.find(account => account.id === catalogue.active.accountId)!.address; } },
    storage: { async close() {}, async readState() { if (persisted) { readEntered.resolve(); await readGate.promise; } return { presence: 'existing', backup: 'confirmed' }; } },
    accounts: { isAuthenticationRefusal: () => false, supported: () => true, getSnapshot: () => catalogue, reserve() { throw Error('No account mutation'); } },
    networks: { getSelectedId: () => catalogue.active.networkId, reserve(id, revision) { assert.equal(id, target.id); assert.equal(revision, 1); return { cancel() {}, async execute(check) {
      check(); if (!committed) throw new CustodyRuntimeError('OPERATION_FAILED');
      catalogue = { ...catalogue, revision: 2, active: { accountId: accounts[1]!.id, networkId: target.id } }; persisted = true;
      return Object.freeze({ sourceCatalogueRevision: revision, target, selection: { ...catalogue.active, address: accounts[1]!.address }, assertCurrent() {
        assert.equal(catalogue.revision, 2); assert.equal(catalogue.active.networkId, target.id); assert.equal(catalogue.active.accountId, accounts[1]!.id);
      } });
    } }; } },
  };
  const authority = new NativeCustodyAuthority({ open: async () => runtime });
  const retired: WalletConnectRequest[] = [], responses: unknown[] = [];
  let manager: NativeDappControlRequests | undefined;
  try {
    await authority.initialize(); await authority.unlock();
    const contextRevision = authority.getSnapshot().revision;
    const networks = createNativeNetworkView(authority, { utxoSendAvailable: true, fetch: async () => { assert.fail('Mode selection must not use HTTP'); } });
    const context = () => { const state = authority.getSnapshot(), value = authority.getCatalogue(); return state.phase === 'ready' && value ? { revision: state.revision, catalogueRevision: value.revision, activeAccountId: value.active.accountId, networkId: value.active.networkId, networkLabel: 'Ethereum', accounts: value.accounts } : null; };
    const wire: WalletConnectRequest = { freshness: 'fresh', id: 1, method: 'sys_changeUTXOEVM', params: [{ chainId: 57 }], chainId: 'eip155:1', expiresAt: now + 60000, verification: { validation: 'UNKNOWN', isScam: false },
      session: { binding: { topic: 'ab'.repeat(32), peerPublicKey: 'cd'.repeat(32), origin: 'https://dapp.example' }, expiry: Math.floor(now / 1000) + 600, metadata: { name: 'Dapp', description: '', url: 'https://dapp.example', icons: [] }, namespaces: {} } };
    manager = new NativeDappControlRequests({ host: () => ({ context, async prepare(request, owner, signal, check) { assert('kind' in request); return prepareNativeDappModeControl({ networks, context, utxoNetworks: () => [target] }, request, owner, signal, check); } }),
      foreground: () => true, changed() {}, checkSite: async () => ({ isBlacklisted: false }), async retireCommitted(value) { retired.push(value); },
      async respond(_wire, response, check) { check(); if (wire.expiresAt <= now) throw Error('REQUEST_EXPIRED'); responses.push(response); } });
    manager.enqueue(wire, normalizeDappModeRequest(wire.method, wire.params), { networkFamily: 'ethereum', order: 1, accountId: accounts[0]!.id, address: accounts[0]!.address, networkId: evm.id, networkLabel: 'Ethereum', accountLabel: 'Account', chainId: '1', assertCurrent() { assert.equal(authority.getSnapshot().revision, contextRevision); }, assertSessionCurrent() {} });
    await new Promise<void>(resolve => setImmediate(resolve));
    const approving = manager.approve('control-1'), rejection = assert.rejects(approving);
    if (committed) {
      await readEntered.promise;
      assert.equal(catalogue.active.networkId, target.id); assert.equal(authority.getSnapshot().phase, 'authenticating');
      now += 60001; t.mock.timers.tick(60001);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(authority.getSnapshot().phase, 'locked'); readGate.resolve();
    }
    await rejection;
    assert.equal(catalogue.active.networkId, committed ? target.id : evm.id);
    assert.deepEqual(retired, committed ? [wire] : []);
    assert.equal(responses.some(value => Object.hasOwn(value as object, 'result')), false);
    assert.equal(manager.size, 0);
  } finally { readGate.resolve(); Date.now = readNow; await manager?.dispose(); await authority.dispose(); t.mock.timers.reset(); }
});
