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

const evm = getNativeNetwork('ethereum'), syscoin = getUtxoNetwork('syscoin');
function fixture(fault = false) {
  const accounts = [
    { id: 'hd:60:0', type: 'HDAccount' as const, index: 0, slip44: 60, address: `0x${'11'.repeat(20)}`, label: 'Ethereum' },
    { id: 'hd:57:0', type: 'HDAccount' as const, index: 0, slip44: 57, address: UTXO_ADDRESSES.syscoin, label: 'Syscoin' },
  ];
  let context: NativeDappControlContext = { revision: 7, catalogueRevision: 3, activeAccountId: accounts[0]!.id, networkId: evm.id, networkLabel: evm.name, accounts };
  let snapshot: NativeNetworkSnapshot = { revision: 3, selectedId: evm.id, networks: [{ ...evm, canSign: true, registration: evm }, { ...syscoin, canSign: true }] };
  let selections = 0;
  const networks: NativeNetworkView = {
    getSnapshot: () => snapshot, getContextRevision: () => context.revision, subscribe: () => () => {}, cancel() {},
    async select(id, revision, catalogueRevision) {
      assert.equal(revision, context.revision); assert.equal(catalogueRevision, snapshot.revision); selections++;
      context = { ...context, revision: context.revision + 1, catalogueRevision: context.catalogueRevision + 1, networkId: id, activeAccountId: fault ? accounts[0]!.id : accounts[1]!.id };
      snapshot = { ...snapshot, revision: snapshot.revision + 1, selectedId: id };
      return networkSelectionReceiptFixture(syscoin, { networkId: id, accountId: accounts[1]!.id, address: accounts[1]!.address }, revision, catalogueRevision, () => {
        if (context.activeAccountId !== accounts[1]!.id || snapshot.selectedId !== id || context.revision !== revision + 1) throw new Error('CONTEXT_CHANGED');
      });
    },
  };
  const ports = { networks, context: () => context, utxoNetworks: () => [syscoin] };
  return { ports, owner: { accountId: accounts[0]!.id, address: accounts[0]!.address, networkId: evm.id }, selections: () => selections };
}
test('existing-group family selection retains the full registered network and exact intended account', async () => {
  const f = fixture();
  const prepared = prepareNativeDappModeControl(f.ports, normalizeDappModeRequest('sys_changeUTXOEVM', [{ chainId: 57 }]), f.owner, new AbortController().signal, () => {});
  assert.equal(prepared.details.kind, 'network-switch'); assert.equal(f.selections(), 0);
  const result = await prepared.commit(() => {}); result.assertCurrent(); assert.equal(f.selections(), 1);
  assert.equal(f.ports.context().activeAccountId, 'hd:57:0'); prepared.dispose();
});
test('a different post-selection account cannot replace the previewed group', async () => {
  const f = fixture(true);
  const prepared = prepareNativeDappModeControl(f.ports, normalizeDappModeRequest('sys_changeUTXOEVM', [{ chainId: 57 }]), f.owner, new AbortController().signal, () => {});
  await assert.rejects(prepared.commit(() => {}), /CONTEXT_CHANGED/); prepared.dispose();
});
