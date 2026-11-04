import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeNetworkView } from '../src/custody/networkView.ts';
import { NATIVE_NETWORKS } from '../src/custody/networkContext.ts';
import type { NativeWalletCatalogueSnapshot } from '../src/custody/walletCatalogue.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';

const address = '0x52908400098527886E0F7030069857D2E4169EE7';
function fixture() {
  let state: CustodySnapshot = { phase: 'ready', revision: 12, presence: 'existing', backup: 'confirmed', account: { network: 'ethereum', address }, error: null };
  let catalogue: NativeWalletCatalogueSnapshot | null = Object.freeze<NativeWalletCatalogueSnapshot>({ revision: 3, removed: [], accounts: [], networks: NATIVE_NETWORKS, active: { accountId: 'hd:60:0', networkId: 'ethereum' } });
  const listeners = new Set<(value: CustodySnapshot) => void>();
  const requests: unknown[][] = [];
  let cancels = 0;
  const authority = {
    getSnapshot: () => state,
    getCatalogue: () => catalogue,
    subscribe(listener: (value: CustodySnapshot) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async selectNetwork(...args: [string, number, number]) { requests.push(args); },
    cancelAccountOperation() { cancels++; },
  };
  const view = createNativeNetworkView(authority);
  return { view, requests, listeners, cancels: () => cancels,
    set(next: CustodySnapshot, nextCatalogue: NativeWalletCatalogueSnapshot | null) {
      state = next; catalogue = nextCatalogue;
      for (const listener of listeners) listener(state);
    } };
}

test('network projection is stable, frozen, public-only and labels unsupported signing capabilities', () => {
  const f = fixture(); const first = f.view.getSnapshot()!;
  assert.equal(f.view.getSnapshot(), first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.networks), true);
  assert.equal(first.selectedId, 'ethereum');
  assert.equal(first.revision, 3);
  assert.equal(first.networks.length, 7);
  assert.deepEqual(first.networks.filter(network => network.canSign).map(network => network.id), ['ethereum']);
  for (const network of first.networks) {
    assert.equal(Object.isFrozen(network), true);
    assert.deepEqual(Object.keys(network).sort(), ['canSign', 'id', 'name', 'symbol', 'testnet']);
  }
  assert.equal(f.requests.length, 0);
});

test('network selection forwards both captured revisions and teardown removes observation', async () => {
  const f = fixture(); let updates = 0;
  const stop = f.view.subscribe(() => updates++);
  await f.view.select('base', f.view.getContextRevision(), f.view.getSnapshot()!.revision);
  assert.deepEqual(f.requests, [['base', 12, 3]]);
  f.set({ phase: 'locked', revision: 13, presence: 'existing', backup: 'confirmed', account: null, error: null }, null);
  assert.equal(updates, 1);
  assert.equal(f.view.getSnapshot(), null);
  f.view.cancel(); assert.equal(f.cancels(), 1);
  stop(); assert.equal(f.listeners.size, 0);
});
