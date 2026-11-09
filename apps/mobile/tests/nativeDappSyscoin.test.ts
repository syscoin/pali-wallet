import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeDappSyscoinHost } from '../src/custody/dappSyscoin.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import { normalizeDappSyscoinRead } from '../../../source/shared/dappSyscoinReads.ts';
import { UTXO_SUMMARY_OBSERVATION } from '../../../source/shared/utxoDetailFreshness.ts';
import { metadata, XPUB } from './publicWatchFixtures.ts';
import type { NativeConnectionAccount } from '../src/connections/host.ts';

const network = getUtxoNetwork('syscoin'), identifier = parseUtxoPublicIdentifier(XPUB, network);
const account: NativeConnectionAccount = { id: 'hd:57:0', index: 0, type: 'HDAccount', xpub: identifier.identifier, address: identifier.address, label: 'Syscoin account' };
function fixture(fault?: 'genesis' | 'owner') {
  let valid = true;
  const calls: string[] = [], publicCalls: unknown[] = [];
  const check = () => { if (!valid) throw new Error('CONTEXT_CHANGED'); };
  const host = createNativeDappSyscoinHost({
    source: { getSnapshot: () => ({ phase: 'ready', revision: 1, presence: 'existing', backup: 'confirmed', account: { network: 'syscoin', address: account.address }, error: null }),
      getCatalogue: () => ({ revision: 1, active: { networkId: 'syscoin', accountId: account.id }, accounts: [], networks: [], utxoNetworks: [network] }) },
    async readPublic(method, owner, change, signal, guard) { guard(); assert.equal(signal.aborted, false); publicCalls.push({ method, owner, change }); return 'public-value'; },
    async fetch(url) {
      calls.push(url); const route = new URL(url).pathname;
      if (fault === 'owner') valid = false;
      let result: unknown;
      if (route === '/api/v2/' || route === '/api/v2') result = metadata(network);
      else if (route === '/api/v2/block-index/0') result = { blockHash: fault === 'genesis' ? network.genesisHash.slice(0, 32) + 'ff'.repeat(16) : network.genesisHash };
      else if (route.startsWith('/api/v2/block-index/')) result = { blockHash: 'ab'.repeat(32) };
      else if (route.startsWith('/api/v2/xpub/')) result = { txs: 1, unconfirmedTxs: 0, totalPages: 1, transactions: [{ txid: 'cd'.repeat(32), addressValueIn: '0', addressValueOut: '1', localAcknowledgedInputs: { backend: 'private' }, [UTXO_SUMMARY_OBSERVATION]: 'local' }] };
      else throw new Error('Unexpected path');
      return Response.json(result);
    },
  });
  return { host, check, calls, publicCalls };
}
test('public read admission retains the canonical stable address/key and real narrow SDK method boundary', async () => {
  const f = fixture(), signal = new AbortController().signal;
  assert.equal(f.host.anchor(account.xpub), account.address);
  assert.equal(await f.host.read(normalizeDappSyscoinRead('sys_getPublicKey', []), account, signal, f.check), account.xpub);
  assert.equal(await f.host.read(normalizeDappSyscoinRead('sys_getBip32Path', [{ isChangeAddress: true }]), account, signal, f.check), 'public-value');
  assert.deepEqual(f.publicCalls, [{ method: 'getBip32Path', owner: { accountId: account.id, xpub: account.xpub }, change: true }]);
  assert.deepEqual(f.calls, []);
});
test('public history reuses account-relative shared history and drops local provenance after full-genesis observation', async () => {
  const f = fixture();
  const result = await f.host.read(normalizeDappSyscoinRead('sys_getTransactions', []), account, new AbortController().signal, f.check);
  assert.deepEqual(result, [{ txid: 'cd'.repeat(32), addressValueIn: '0', addressValueOut: '1' }]);
  assert.equal(f.calls.filter(url => url.includes('/xpub/')).length, 1);
  assert(f.calls.every(url => url.startsWith(network.endpoint)));
});
for (const fault of ['genesis', 'owner'] as const) test(`history refuses ${fault} changes even when a CAIP prefix would still match`, async () => {
  const f = fixture(fault);
  await assert.rejects(f.host.read(normalizeDappSyscoinRead('sys_getTransactions', []), account, new AbortController().signal, f.check));
  assert.equal(f.calls.filter(url => url.includes('/xpub/')).length, 0);
});
