import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeWalletCatalogue, WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { getUtxoSdkNetwork } from '../src/core/utxoNetworks.ts';
import { createPublicAccountStorage, PUBLIC_ACCOUNTS_KEY } from '../src/core/publicAccountStorage.ts';
import { WatchOnlyAuthority } from '../src/core/watchOnlyAuthority.ts';
import { nativeNotificationChoices, watchNotificationChoices } from '../src/notifications/choices.ts';
import { stageInitialWallet } from '../../../source/wallet/accountRecovery.ts';
import { encodeEcdsaValidatorInitData, getConfiguredAuthenticatorAddress, getPaliSmartAccountDescriptor } from '../../../source/utils/smartAccount/account.ts';
import { derivePaliSmartAccountDeployment } from '../../../source/utils/smartAccount/counterfactual.ts';
import { getPaliSmartAccountFactoryAddress, PALI_SMART_ACCOUNT_VERSION } from '../../../source/utils/smartAccount/contracts.ts';
import { createAccountRecordTestFixture, ACCOUNT_FIXTURE_PHRASE, ACCOUNT_FIXTURE_PASSWORD } from './accountRecordTestFixture.ts';
import { keyRecord, UTXO_ADDRESSES } from './publicWatchFixtures.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';

const current = () => undefined;

function smartAccount(chainId: number, index: number, owner: string) {
  const factoryAddress = getPaliSmartAccountFactoryAddress(chainId);
  const descriptor = getPaliSmartAccountDescriptor({ accountIndex: index, accountVersion: PALI_SMART_ACCOUNT_VERSION,
    anchor: `pali:eip155:${chainId}:${owner.toLowerCase()}:smart-account-v1`, chainId, factoryAddress });
  const auth = { module: 'ecdsa' as const, validator: getConfiguredAuthenticatorAddress(chainId, 'ecdsa'), data: encodeEcdsaValidatorInitData([owner], 1) };
  const deployment = derivePaliSmartAccountDeployment({ ...auth, factoryAddress, deploySalt: descriptor.deploymentSalt });
  return { id: index, address: deployment.address, xpub: deployment.address, xprv: '', label: `Smart ${chainId}`,
    balances: { syscoin: -1, ethereum: -1 }, isSmartAccount: true, isImported: false, isLedgerWallet: false, isTrezorWallet: false,
    smartAccount: { chainId, contractVersion: PALI_SMART_ACCOUNT_VERSION, factoryAddress, descriptor,
      deploymentSalt: descriptor.deploymentSalt, deploymentAuth: { validator: auth.validator, data: auth.data }, auth, isDeployed: false } };
}

test('monitoring projects every saved group without derivation or writes, preserving xpubs and Smart account chain restrictions', async () => {
  const fixture = await createAccountRecordTestFixture();
  try {
    const binding = 'ab'.repeat(32), base = fixture.record(binding);
    const evm = structuredClone(base.groups[0]!);
    evm.accounts.HDAccount[1] = await fixture.derive(1, 'Inactive EVM account');
    evm.accounts.SmartAccount[0] = smartAccount(1, 0, fixture.identity.address);
    evm.accounts.SmartAccount[1] = smartAccount(Number(getNativeNetwork('base').chainId), 1, fixture.identity.address);
    const syscoin = await stageInitialWallet({ key: '57', phrase: ACCOUNT_FIXTURE_PHRASE, password: ACCOUNT_FIXTURE_PASSWORD,
      network: getUtxoSdkNetwork('syscoin') }, { assertCurrent: current });
    const bitcoin = await stageInitialWallet({ key: '0', phrase: ACCOUNT_FIXTURE_PHRASE, password: ACCOUNT_FIXTURE_PASSWORD,
      network: getUtxoSdkNetwork('bitcoin') }, { assertCurrent: current });
    const record = { ...base, groups: [evm, ...syscoin.groups, ...bitcoin.groups], active: { accountId: 'hd:57:0', networkId: 'syscoin' } };
    let reads = 0;
    const storage: KeyringStoragePort = {
      async get(key) { reads++; assert.equal(key, WALLET_CATALOGUE_KEY); return structuredClone(record); },
      async set() { throw Error('Monitoring must not persist'); }, async deleteItem() { throw Error('Monitoring must not delete'); },
      async createManyIfAbsent() { throw Error('Monitoring must not create'); }, async compareAndSet() { throw Error('Monitoring must not change selection'); },
      async compareAndSetMany() { throw Error('Monitoring must not commit'); },
    };
    const catalogue = new NativeWalletCatalogue(storage);
    const active = await catalogue.reconcile({ walletFingerprint: binding, ...fixture.identity }, current);
    assert(active.accounts.every(account => account.slip44 === 57), 'the ordinary view is restricted to the active group');
    const readCount = reads;
    const before = catalogue.privateRecords;
    const monitoring = catalogue.getMonitoringSnapshot()!;
    const choices = nativeNotificationChoices(monitoring);
    assert.equal(reads, readCount, 'the producer performs no storage read or derivation');
    assert.deepEqual(catalogue.privateRecords, before);
    assert.deepEqual(monitoring.accounts.map(entry => entry.account.id).sort(), ['hd:0:0', 'hd:57:0', 'hd:60:0', 'hd:60:1', 'smart:60:0', 'smart:60:1']);
    for (const [id, group] of [['hd:57:0', syscoin.groups[0]!], ['hd:0:0', bitcoin.groups[0]!]] as const) {
      const item = monitoring.accounts.find(entry => entry.account.id === id)!;
      assert.equal(item.identifier, group.accounts.HDAccount[0]!.xpub);
      assert.equal(item.isAccount, true);
      assert.equal(item.kind, 'utxo');
      assert.equal(choices.find(choice => choice.scope.accountId === id)?.scope.identifier, item.identifier);
    }
    for (const id of ['hd:60:0', 'hd:60:1']) {
      const targets = choices.filter(choice => choice.scope.accountId === id);
      assert.deepEqual(targets.map(choice => choice.scope.network.id), monitoring.networks.map(network => network.id));
      assert(targets.every(choice => choice.scope.identifier === undefined && choice.scope.isAccount === undefined));
      assert(targets.every(choice => choice.scope.accountAddress === monitoring.accounts.find(entry => entry.account.id === id)!.account.address));
      for (const choice of targets) assert.equal(choice.scope.network, monitoring.networks.find(network => network.id === choice.scope.network.id));
    }
    for (const id of ['smart:60:0', 'smart:60:1']) {
      const account = monitoring.accounts.find(entry => entry.account.id === id)!.account;
      const targets = choices.filter(choice => choice.scope.accountId === id);
      assert(targets.length > 0);
      assert(targets.every(choice => String(choice.scope.network.chainId) === String(account.smartAccount!.chainId) && choice.scope.guardian === true));
    }
    const encoded = JSON.stringify({ monitoring, choices });
    for (const forbidden of ['xprv', 'privateKey', 'walletFingerprint', 'deploymentAuth', 'guardianRecoveryIntents', 'recovery', 'mnemonic', ACCOUNT_FIXTURE_PHRASE, ACCOUNT_FIXTURE_PASSWORD])
      assert(!encoded.includes(forbidden), `public monitoring excludes ${forbidden}`);
    for (const group of before.groups) for (const type of Object.values(group.accounts)) for (const account of Object.values(type))
      if (account.xprv) assert(!encoded.includes(account.xprv), 'encrypted key material stays within custody');
    assert(Object.isFrozen(monitoring) && Object.isFrozen(monitoring.accounts) && monitoring.accounts.every(Object.isFrozen));
  } finally { await fixture.close(); }
});

test('watch monitoring preserves explicit EVM mappings and saved UTXO descriptors without reads or selection changes', async () => {
  const address = `0x${'11'.repeat(20)}`;
  const key = keyRecord(); assert(key.kind === 'utxo-public');
  const descriptor = keyRecord('descriptor', 'bitcoin', `sh(wpkh(${key.identifier}/0/*))`);
  assert(descriptor.kind === 'utxo-public');
  const raw = JSON.stringify({ version: 1, records: [descriptor,
    { kind: 'address', id: 'shared', name: 'Shared EVM', addresses: { ethereum: address, base: address } },
    { kind: 'address', id: 'fixed', name: 'Fixed SYS', addresses: { syscoin: UTXO_ADDRESSES.syscoin } },
  ] });
  let reads = 0, writes = 0, balanceReads = 0;
  const repository = createPublicAccountStorage({ async get(key) { reads++; return key === PUBLIC_ACCOUNTS_KEY ? raw : null; }, async set() { writes++; throw Error('No writes'); } });
  const owner = await WatchOnlyAuthority.openRecords({ repository: repository.records,
    reader: { async readBalance() { balanceReads++; throw Error('No balance read'); } }, signal: new AbortController().signal });
  assert.throws(() => owner.getMonitoringEntries(), /locked/);
  owner.unlock();
  const before = owner.getSnapshot(), readCount = reads;
  const entries = owner.getMonitoringEntries(), choices = watchNotificationChoices(owner);
  assert.equal(owner.getSnapshot(), before);
  assert.equal(reads, readCount); assert.equal(writes, 0); assert.equal(balanceReads, 0);
  assert.deepEqual(entries.filter(entry => entry.accountId === 'shared').map(entry => entry.network.id), ['ethereum', 'base']);
  assert(entries.filter(entry => entry.accountId === 'shared').every(entry => entry.address === address && entry.identifier === address && !entry.isAccount));
  assert.equal(entries.find(entry => entry.accountId === 'descriptor')?.identifier, descriptor.identifier);
  assert.equal(entries.find(entry => entry.accountId === 'descriptor')?.isAccount, true);
  assert.equal(entries.find(entry => entry.accountId === 'fixed')?.identifier, UTXO_ADDRESSES.syscoin);
  assert.equal(entries.find(entry => entry.accountId === 'fixed')?.isAccount, false);
  assert.deepEqual(choices.map(choice => choice.scope.id).sort(), ['watch:descriptor:bitcoin', 'watch:fixed:syscoin', 'watch:shared:base', 'watch:shared:ethereum']);
  assert.equal(choices.find(choice => choice.scope.accountId === 'descriptor')?.scope.identifier, descriptor.identifier);
  assert(!/xprv|privateKey|mnemonic|walletFingerprint|vault/.test(JSON.stringify({ entries, choices })));
  owner.lock();
  assert.throws(() => watchNotificationChoices(owner), /locked/);
});
