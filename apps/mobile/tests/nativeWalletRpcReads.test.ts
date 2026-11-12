import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createNativeWalletReadHost, walletTokenScope } from '../src/custody/dappWalletReads.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { metadata, XPUB } from './publicWatchFixtures.ts';
import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import type { DappWalletTokens } from '../../../source/shared/dappWalletReads.ts';
import type { NativeConnectionAccount } from '../src/connections/host.ts';

const network = getNativeNetwork('ethereum');
const account: NativeConnectionAccount = { id: 'hd:60:1', index: 1, type: 'HDAccount', address: '0x' + '11'.repeat(20), xpub: 'public', label: 'Granted account' };
const token = { contractAddress: '0x' + '22'.repeat(20), name: 'Token', symbol: 'T', decimals: 18 };

test('loading passive wallet reads leaves the heavy Syscoin SDK entry lazy', () => {
  const require = createRequire(import.meta.url);
  assert.equal(require.cache[require.resolve('@sidhujag/sysweb3-keyring/cjs/transactions/syscoin-core.js')], undefined);
});

test('custom token reads combine only granted-chain saved metadata and cached balances without HTTP/discovery', async () => {
  let loads = 0;
  const cache = new Map<string, DappWalletTokens>();
  cache.set(walletTokenScope(account.id, account.address, network), { ethereum: [
    { ...token, chainId: 10, tokenSymbol: 'T', isNft: false, rawBalance: '999', balance: 999 },
    { ...token, chainId: 1, tokenSymbol: 'T', isNft: false, rawBalance: '0', balance: 0 },
  ], syscoin: [] });
  const host = createNativeWalletReadHost({ network: () => network,
    async fetch() { assert.fail('Token reads must not issue HTTP'); },
    async loadTokens(id, networkId, check) { check(); assert.equal(id, account.id); assert.equal(networkId, network.id); loads++; return { revision: 1, items: [token, { ...token, contractAddress: '0x' + '33'.repeat(20) }] }; },
    cachedTokens: key => cache.get(key), observeUtxo() { assert.fail('No UTXO discovery'); } });
  const result = await host.read('wallet_getTokens', account, new AbortController().signal, () => {}) as DappWalletTokens;
  assert.equal(loads, 1); assert.equal(result.ethereum.length, 2); assert.deepEqual(result.syscoin, []);
  assert.equal(result.ethereum[0]!.rawBalance, '0'); assert.equal(result.ethereum[0]!.balance, 0);
  assert.equal(Object.hasOwn(result.ethereum[1]!, 'balance'), false);
  cache.clear();
  const unknown = await host.read('wallet_getTokens', account, new AbortController().signal, () => {}) as DappWalletTokens;
  assert(unknown.ethereum.every(row => !Object.hasOwn(row, 'balance')));
});

test('custom EVM reads use the granted address, raw balance reader and SDK-style wei fee response', async () => {
  const calls: { method: string; params: string[] }[] = [];
  const host = createNativeWalletReadHost({ network: () => network, async loadTokens() { assert.fail('No token load'); },
    cachedTokens: () => undefined, observeUtxo() { assert.fail('No UTXO read'); }, async fetch(url, init) {
      assert.equal(url, network.rpcUrl); const call = JSON.parse(init.body as string); calls.push(call);
      return Response.json({ id: call.id, jsonrpc: '2.0', result: call.method === 'eth_chainId' ? '0x1' : call.method === 'eth_getBalance' ? '0xde0b6b3a7640000' : '0x123456789' });
    } });
  assert.equal(await host.read('wallet_getBalance', account, new AbortController().signal, () => {}), '1.0');
  assert.deepEqual(calls.find(call => call.method === 'eth_getBalance')!.params, [account.address, 'latest']);
  assert.equal(await host.read('wallet_estimateFee', account, new AbortController().signal, () => {}), BigInt('0x123456789').toString());
  assert.equal(calls.filter(call => call.method === 'eth_gasPrice').length, 1);
});

test('UTXO token read is cache-only and fee read retains the existing genesis-verified SDK route', async () => {
  const selected = getUtxoNetwork('syscoin'), identifier = parseUtxoPublicIdentifier(XPUB, selected);
  const owner = { ...account, id: 'hd:57:0', address: identifier.address, xpub: identifier.identifier };
  const calls: string[] = [];
  const host = createNativeWalletReadHost({ network: () => selected, async loadTokens() { assert.fail('No EVM token load'); },
    cachedTokens: key => key === walletTokenScope(owner.id, owner.address, selected) ? { ethereum: [], syscoin: [{ assetGuid: '123', chainId: 57, balance: '0' }] } : undefined,
    observeUtxo() {}, async fetch(url) {
      calls.push(url); const path = new URL(url).pathname;
      return Response.json(path.includes('block-index/0') ? { blockHash: selected.genesisHash } : path.includes('estimatefee') ? { result: '0.001024' }
        : path.includes('/xpub/') ? { address: identifier.identifier, balance: '100000000', unconfirmedBalance: '-1', unconfirmedTxs: 1, tokens: [] } : metadata(selected));
    } });
  assert.deepEqual(await host.read('wallet_getTokens', owner, new AbortController().signal, () => {}), { ethereum: [], syscoin: [{ assetGuid: '123', chainId: 57, balance: '0' }] });
  assert.deepEqual(calls, []);
  assert.equal(await host.read('wallet_estimateFee', owner, new AbortController().signal, () => {}), 0.000001);
  assert.equal((calls as string[]).filter(url => url.includes('estimatefee')).length, 1);
  assert.equal(await host.read('wallet_getBalance', owner, new AbortController().signal, () => {}), '0.99999999');
});

test('an unrepresentable public token chain ID is refused before reading metadata or HTTP', async () => {
  const host = createNativeWalletReadHost({ network: () => ({ ...network, chainId: '9007199254740993' }),
    async fetch() { assert.fail('No HTTP'); }, async loadTokens() { assert.fail('No metadata read'); },
    cachedTokens: () => undefined, observeUtxo() {} });
  await assert.rejects(host.read('wallet_getTokens', account, new AbortController().signal, () => {}), /Chain ID/);
});

test('authorized Bitcoin token reads return the empty container without storage or HTTP', async () => {
  const selected = getUtxoNetwork('bitcoin');
  assert.equal(selected.chainId, 0);
  const host = createNativeWalletReadHost({ network: () => selected,
    async fetch() { assert.fail('No Bitcoin token HTTP'); },
    async loadTokens() { assert.fail('No EVM metadata read'); },
    cachedTokens: () => undefined, observeUtxo() { assert.fail('No balance refresh'); } });
  assert.deepEqual(await host.read('wallet_getTokens', account, new AbortController().signal, () => {}), { ethereum: [], syscoin: [] });
});

for (const failure of ['changed', 'abort', 'offline'] as const) test(`wallet reads reject ${failure} instead of publishing stale data or a guessed fee`, async () => {
  let current = true;
  const abort = new AbortController();
  const host = createNativeWalletReadHost({ network: () => network, async loadTokens() { throw Error('unused'); }, cachedTokens: () => undefined, observeUtxo() {},
    async fetch(_url, init) {
      const call = JSON.parse(init.body as string);
      if (call.method !== 'eth_chainId') { if (failure === 'changed') current = false; else if (failure === 'abort') abort.abort(); else throw Error('offline'); }
      return Response.json({ id: call.id, jsonrpc: '2.0', result: call.method === 'eth_chainId' ? '0x1' : '0x123' });
    } });
  await assert.rejects(host.read('wallet_estimateFee', account, abort.signal, () => { if (!current) throw Error('CONTEXT_CHANGED'); }));
});
