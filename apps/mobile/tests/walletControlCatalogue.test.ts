import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeWalletCatalogue, WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';
import { createAccountRecordTestFixture, ACCOUNT_FIXTURE_PHRASE, ACCOUNT_FIXTURE_PASSWORD } from './accountRecordTestFixture.ts';
import { getUtxoSdkNetwork } from '../src/core/utxoNetworks.ts';
import { stageInitialWallet } from '../../../source/wallet/accountRecovery.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';
const check = () => undefined;

test('public control catalogue proves inactive EVM accounts and previews the exact saved family default', async () => {
  const fixture = await createAccountRecordTestFixture();
  try {
    const binding = 'ab'.repeat(32), base = fixture.record(binding);
    const utxo = await stageInitialWallet({ key: '57', phrase: ACCOUNT_FIXTURE_PHRASE, password: ACCOUNT_FIXTURE_PASSWORD, network: getUtxoSdkNetwork('syscoin') }, { assertCurrent: check });
    const second = await fixture.derive(1, 'Saved EVM default');
    const evmGroup = structuredClone(base.groups[0]!);
    evmGroup.accounts.HDAccount[1] = second;
    const groups = [{ ...evmGroup, activeAccount: { type: 'HDAccount' as const, id: 1 } }, ...utxo.groups];
    let saved: unknown = { ...base, groups, active: { accountId: 'hd:57:0', networkId: 'syscoin' } }, writes = 0;
    const storage: KeyringStoragePort = {
      async get(key) { assert.equal(key, WALLET_CATALOGUE_KEY); return structuredClone(saved); },
      async set() { throw new Error('Unexpected set'); }, async deleteItem() { throw new Error('Unexpected delete'); },
      async createManyIfAbsent() { throw new Error('Unexpected create'); },
      async compareAndSet(_key, expected, next, _remove, guard) {
        guard?.(); assert.equal(JSON.stringify(saved), JSON.stringify(expected)); saved = structuredClone(next); writes++; return true;
      },
      async compareAndSetMany() { throw new Error('Unexpected removal'); },
    };
    const catalogue = new NativeWalletCatalogue(storage);
    const selected = await catalogue.reconcile({ walletFingerprint: binding, ...fixture.identity }, check);
    assert(selected.accounts.every(account => account.slip44 === 57));
    const controls = catalogue.getControlSnapshot()!;
    assert.equal(controls, catalogue.getControlSnapshot());
    assert(controls.accounts.some(account => account.id === 'hd:60:0' && account.address === fixture.identity.address));
    assert(controls.accounts.some(account => account.id === 'hd:60:1' && account.address === second.address));
    assert(!/xprv|xpub|walletFingerprint|publicKey|vault/.test(JSON.stringify(controls)));
    const preview = catalogue.previewNetworkSelection('ethereum', controls.revision);
    assert.deepEqual(preview, { accountId: 'hd:60:1', address: second.address, networkId: 'ethereum' });
    assert.equal(writes, 0);
    const switched = await catalogue.mutate(controls.revision, { kind: 'select-network', id: 'ethereum' }, check);
    assert.equal(switched.active.accountId, preview.accountId);
    assert.equal(switched.active.networkId, preview.networkId);
    assert.equal(switched.accounts.find(account => account.id === preview.accountId)?.address, preview.address);
    assert.throws(() => catalogue.previewNetworkSelection('rollux', controls.revision), /CATALOGUE_CONTEXT_CHANGED/);
    assert.equal(writes, 1);
    assert.equal(Object.isFrozen(controls.accounts), true);
    assert.equal(Object.isFrozen(controls.accounts[0]), true);
  } finally { await fixture.close(); }
});
