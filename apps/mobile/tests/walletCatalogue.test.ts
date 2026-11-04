import { createNativeNetwork, getNativeNetwork } from '../src/custody/networkContext.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeAddress } from 'ethers/transaction';
import { Wallet, HDNodeWallet } from 'ethers/wallet';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import { createNativeSignedRecordView } from '../src/custody/sharedSignedRecords.ts';
import { SigningKey } from 'ethers/crypto';
import { NativeActivityHistory } from '../src/activity/historyStore.ts';

import { NativeWalletCatalogue, WALLET_CATALOGUE_KEY, WalletCatalogueError } from '../src/custody/walletCatalogue.ts';
import { AccountRecoveryRequiredError } from '../../../source/wallet/accountRecords.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection, type SqlHook } from './storageHelpers.ts';
import { createAccountRecordTestFixture, ACCOUNT_FIXTURE_PHRASE } from './accountRecordTestFixture.ts';

// Public secp256k1 generator; never a wallet secret.
const PUBLIC_KEY = SigningKey.computePublicKey(HDNodeWallet.fromPhrase(ACCOUNT_FIXTURE_PHRASE).publicKey, false);
const ADDRESS = computeAddress(PUBLIC_KEY);
const current = () => undefined;
const invalidCatalogue = (error: unknown) => error instanceof WalletCatalogueError && error.code === 'CATALOGUE_INVALID' ||
  error instanceof AccountRecoveryRequiredError || error instanceof Error && error.message === 'Invalid EVM registration fingerprint';
async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-catalogue-'));
  const file = path.join(directory, 'wallet.sqlite');
  let owned = nodeConnection(file, hooks);
  let storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, true);
  const sdk = await createAccountRecordTestFixture();
  await storage.keyringStorage.createManyIfAbsent(sdk.pair);
  const identity = { walletFingerprint: await storage.getWalletFingerprint(), ...sdk.identity };
  await storage.keyringStorage.set(WALLET_CATALOGUE_KEY, sdk.record(identity.walletFingerprint));
  return {
    identity, sdk,
    get storage() { return storage; },
    async reopen() {
      await storage.close().catch(() => undefined);
      owned = nodeConnection(file);
      storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, false);
    },
    async cleanup() { await sdk.close(); await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); },
  };
}

async function signedStore(f: Awaited<ReturnType<typeof fixture>>) {
  const session = { keyring: f.sdk.keyring, assertCurrent: current };
  await f.storage.recovery.bindIdentity(f.identity.walletFingerprint, {
    address: ADDRESS, publicKey: PUBLIC_KEY.toLowerCase(),
    profileId: await session.keyring.getPrivateRecordProfileId(),
  }, current);
  const records = new EvmSignedRecords(f.storage.signedRecords, () => 1);
  return { records, session, view: (address: string, index: number, network = getNativeNetwork('ethereum')) =>
    createNativeSignedRecordView(records, session, f.identity.walletFingerprint, { index, type: 'HDAccount', address }, network) };
}

test('new wallet catalogue creation is durable, idempotent and exposes no key or fingerprint', async () => {
  const f = await fixture();
  try {
    const before = await f.storage.keyringStorage.get('vault');
    const snapshot = await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current);
    assert.equal(snapshot.accounts[0]?.address, ADDRESS);
    assert.deepEqual(snapshot.active, { accountId: 'hd:60:0', networkId: 'ethereum' });
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.accounts[0]), true);
    assert.equal('publicKey' in snapshot.accounts[0]!, false);
    assert.equal('walletFingerprint' in snapshot, false);
    const committed = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    assert.equal(typeof (committed as any).groups[0].accounts.HDAccount[0].xprv, 'string');
    assert(!JSON.stringify(snapshot).includes('xprv'));
    await f.reopen();
    assert.deepEqual(await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current), snapshot);
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), committed);
    assert.equal(await f.storage.keyringStorage.get('vault'), before);
  } finally { await f.cleanup(); }
});

for (const point of ['before-commit', 'lost-ack'] as const) {
  test(`catalogue ${point} requires reopen and preserves the original wallet`, async () => {
    let enabled = false;
    const fail: SqlHook = (kind, sql) => {
      if (enabled && kind === 'exec' && sql === 'COMMIT') { enabled = false; throw Error('simulated interruption'); }
    };
    const f = await fixture(point === 'lost-ack' ? { after: fail } : { before: fail });
    try {
      const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
      await catalogue.reconcile(f.identity, current);
      enabled = true;
      await assert.rejects(catalogue.mutate(0,{kind:'rename',id:'hd:60:0',label:'Committed edit'},current));
      await assert.rejects(catalogue.reconcile(f.identity, current), /CATALOGUE_REOPEN_REQUIRED/);
      await f.reopen();
      assert.equal(await f.storage.getWalletFingerprint(), f.identity.walletFingerprint);
      const prior = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
      assert.equal((prior as any).groups[0].accounts.HDAccount[0].label === 'Committed edit', point === 'lost-ack');
      const resumed = await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current);
      assert.equal(resumed.accounts[0]?.address, ADDRESS);
      if (point === 'lost-ack') assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), prior);
    } finally { await f.cleanup(); }
  });
}

test('corrupt, foreign-wallet and unsupported catalogues are preserved without replacement', async () => {
  const f = await fixture();
  try {
    await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current);
    const original = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as Record<string, any>;
    const cases = [
      { ...original, version: 3 },
      { ...original, walletFingerprint: 'aa'.repeat(32) },
      { ...original, xprv: 'forbidden field' },
      ...['address','xpub','id'].map(field => { const value=structuredClone(original); value.groups[0].accounts.HDAccount[0][field]=field==='address'?'0x1111111111111111111111111111111111111111':field==='xpub'?'0x04':1; return value; }),
      { ...original, networks: [{ ...original.networks[0], rpcUrl: 'https://untrusted.invalid' }] },
      { ...original, active: { accountId: 'hd:60:1', networkId: 'ethereum' } },
    ];
    for (const value of cases) {
      await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, value);
      await assert.rejects(new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current), invalidCatalogue);
      assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), value);
    }
    await assert.rejects(new NativeWalletCatalogue(f.storage.keyringStorage).reconcile({ ...f.identity, publicKey: '0x04' }, current), /CATALOGUE_INVALID/);
    await assert.rejects(new NativeWalletCatalogue(f.storage.keyringStorage).reconcile({ ...f.identity, address: '0x1111111111111111111111111111111111111111' }, current), /CATALOGUE_INVALID/);
  } finally { await f.cleanup(); }
});

for (const phase of ['read', 'commit'] as const) {
  test(`revocation during catalogue ${phase} cannot publish stale context`, async () => {
    let enabled = false;
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const hook: SqlHook = async (kind, sql) => {
      if (enabled && (phase === 'read' ? kind === 'get' && sql.includes('FROM keyring_records WHERE key = ?') : kind === 'exec' && sql === 'COMMIT')) {
        enabled = false; entered(); await held;
      }
    };
    const f = await fixture({ after: hook });
    try {
      const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
      let generation = 0;
      const guard = () => { if (generation !== 0) throw Error('CANCELLED'); };
      if (phase === 'commit') await catalogue.reconcile(f.identity, guard);
      const before = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
      enabled = true;
      const pending = phase === 'read' ? catalogue.reconcile(f.identity, guard) : catalogue.mutate(0,{kind:'rename',id:'hd:60:0',label:'Committed'},guard);
      await reached;
      generation++;
      release();
      await assert.rejects(pending, /CANCELLED/);
      const value = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
      if (phase === 'read') assert.deepEqual(value,before);
      else assert.equal((value as any).groups[0].accounts.HDAccount[0].label,'Committed');
      if (phase === 'commit') await assert.rejects(catalogue.reconcile(f.identity, current), /CATALOGUE_REOPEN_REQUIRED/);
      await f.reopen();
      assert.equal((await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current)).accounts[0]?.address, ADDRESS);
    } finally { release(); await f.cleanup(); }
  });
}

test('single-flight admission and atomic independent creators preserve one catalogue', async () => {
  const f = await fixture();
  try {
    const first = new NativeWalletCatalogue(f.storage.keyringStorage);
    const pending = first.reconcile(f.identity, current);
    await assert.rejects(first.reconcile(f.identity, current), /CATALOGUE_BUSY/);
    const second = new NativeWalletCatalogue(f.storage.keyringStorage);
    const [left, right] = await Promise.all([pending, second.reconcile(f.identity, current)]);
    assert.deepEqual(left, right);
    const record = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    await assert.rejects(new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, async () => undefined), /CATALOGUE_CONTEXT_CHANGED/);
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), record);
  } finally { await f.cleanup(); }
});


test('a reentrant current-context callback cannot start a second initialization', async () => {
  const f = await fixture();
  try {
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let reentered: Promise<unknown> | undefined;
    const result = await catalogue.reconcile(f.identity, () => {
      if (!reentered) {
        reentered = catalogue.reconcile(f.identity, current);
        void reentered.catch(() => undefined);
      }
    });
    await assert.rejects(reentered!, /CATALOGUE_BUSY/);
    assert.equal(result.accounts[0]?.address, ADDRESS);
  } finally { await f.cleanup(); }
});


const derived = (index: number) => {
  const publicKey = HDNodeWallet.fromPhrase(ACCOUNT_FIXTURE_PHRASE, undefined, `m/44'/60'/0'/0/${index}`).publicKey;
  return { address: computeAddress(publicKey), publicKey };
};

test('SDK-created HD gaps retain explicit identities and reuse the free SDK slot', async () => {
  const f=await fixture();
  try {
    const catalogue=new NativeWalletCatalogue(f.storage.keyringStorage);
    let state=await catalogue.reconcile(f.identity,current);
    state=await catalogue.mutate(state.revision,{kind:'create',account:await f.sdk.derive(1,'Savings')},current);
    await assert.rejects(catalogue.mutate(state.revision,{kind:'remove',id:'hd:60:1'},current),/CATALOGUE_NOT_REMOVABLE/);
    state=await catalogue.mutate(state.revision,{kind:'select',id:'hd:60:0'},current);
    await assert.rejects(catalogue.mutate(state.revision,{kind:'remove',id:'hd:60:0'},current),/CATALOGUE_NOT_REMOVABLE/);
    state=await catalogue.mutate(state.revision,{kind:'remove',id:'hd:60:1'},current);
    assert.deepEqual(Object.keys(catalogue.privateRecords.groups[0]!.accounts.HDAccount),['0']);
    f.sdk.useRecord(catalogue.privateRecords);
    const replacement=await f.sdk.keyring.addNewAccount('Gap replacement');assert.equal(replacement.id,1);
    state=await catalogue.mutate(state.revision,{kind:'create',account:replacement},current);
    assert.equal(state.accounts.find(account=>account.index===1)!.address,derived(1).address);
    const stored=await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    for(const field of ['nextIndex','retiredIndices','nextImportedIndex','retiredImportedIndices'])assert(!Object.hasOwn(stored as object,field));
    await f.reopen();assert.deepEqual(await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity,current),state);
  } finally {await f.cleanup();}
});

test('stale catalogue revision and independent CAS writers cannot overwrite committed account changes', async () => {
  const f = await fixture();
  try {
    const first = new NativeWalletCatalogue(f.storage.keyringStorage);
    const second = new NativeWalletCatalogue(f.storage.keyringStorage);
    const initial = await first.reconcile(f.identity, current);
    await second.reconcile(f.identity, current);
    const next = await first.mutate(initial.revision, { kind: 'create', account: await f.sdk.derive(1, 'Savings') }, current);
    await assert.rejects(first.mutate(initial.revision, { kind: 'rename', id: 'hd:60:0', label: 'Stale' }, current), /CATALOGUE_CONTEXT_CHANGED/);
    await assert.rejects(second.mutate(initial.revision, { kind: 'rename', id: 'hd:60:0', label: 'Racing' }, current), /CATALOGUE_CONTEXT_CHANGED/);
    assert.deepEqual(await second.reconcile(f.identity, current), next);
  } finally { await f.cleanup(); }
});

test('complete encrypted accounts reopen without requesting freshly derived identities',async()=>{
 const f=await fixture();try{
  const catalogue=new NativeWalletCatalogue(f.storage.keyringStorage);await catalogue.reconcile(f.identity,current);
  const state=await catalogue.mutate(0,{kind:'create',account:await f.sdk.derive(1,'Savings')},current);
  const before=await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
  f.sdk.keyring.deriveEvmHdRuntimeAccount=async()=>{throw Error('rederivation must not run');};
  assert.deepEqual(await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity,current),state);
  assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY),before);
 }finally{await f.cleanup();}
});

test('indeterminate CAS outcome quarantines a catalogue until a fresh instance reconciles', async () => {
  const f = await fixture();
  try {
    const port = { ...f.storage.keyringStorage, async compareAndSet(...args: Parameters<typeof f.storage.keyringStorage.compareAndSet>) {
      await f.storage.keyringStorage.compareAndSet(...args);
      return undefined as unknown as boolean;
    } };
    const catalogue = new NativeWalletCatalogue(port);
    const state = await catalogue.reconcile(f.identity, current);
    await assert.rejects(catalogue.mutate(state.revision, { kind: 'rename', id: 'hd:60:0', label: 'Renamed' }, current), /CATALOGUE_INVALID/);
    assert.equal(catalogue.requiresReopen, true);
    await assert.rejects(catalogue.reconcile(f.identity, current), /CATALOGUE_REOPEN_REQUIRED/);
    assert.equal((await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current)).accounts[0]?.label, 'Renamed');
  } finally { await f.cleanup(); }
});

test('signed raw records survive 70 account removals and cold reopen', async () => {
  const f = await fixture();
  try {
    const store = await signedStore(f);
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let state = await catalogue.reconcile(f.identity, current);
    const expected: { address: string; hash: string; raw: string }[] = [];
    for (let index = 1; index <= 70; index++) {
      state = await catalogue.mutate(state.revision, { kind: 'create', account: await f.sdk.derive(index) }, current);
      const signer = HDNodeWallet.fromPhrase(ACCOUNT_FIXTURE_PHRASE, undefined, `m/44'/60'/0'/0/${index}`);
      const view = store.view(signer.address, index);
      const raw = await signer.signTransaction({ type: 2, chainId: 1, nonce: 0, to: ADDRESS, value: 1n, gasLimit: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
      const signed = await view.saveSigned(raw);
      await view.transition(signed.hash, 'attempted');
      await view.transition(signed.hash, 'confirmed');
      state = await catalogue.mutate(state.revision, { kind: 'select', id: 'hd:60:0' }, current);
      state = await catalogue.mutate(state.revision, { kind: 'remove', id: `hd:60:${index}` }, current);
      assert.equal((await store.records.readExact(store.session, '1', signer.address, signed.hash))!.rawTransaction, raw);
      expected.push({ address: signer.address, hash: signed.hash, raw });
    }
    assert.equal(state.accounts.length, 1);
    assert.equal(Object.keys(catalogue.privateRecords.groups[0]!.accounts.HDAccount).length, 1);
    assert.equal(await store.records.validate(store.session), 70);
    const profile = await store.session.keyring.getPrivateRecordProfileId();
    const encoded = await f.storage.signedRecords.read(profile);
    assert.equal(encoded!.includes(expected[0]!.raw), false, 'raw wire bytes remain encrypted at rest');
    await f.reopen();
    assert.equal(await f.storage.signedRecords.read(profile), encoded);
    const reopened = new NativeWalletCatalogue(f.storage.keyringStorage);
    state = await reopened.reconcile(f.identity, current);
    const retained = new EvmSignedRecords(f.storage.signedRecords);
    assert.equal(await retained.validate(store.session), 70);
    for (const item of expected) {
      const row = await retained.readExact(store.session, '1', item.address, item.hash);
      assert.equal(row!.rawTransaction, item.raw);
      assert.equal(row!.phase, 'confirmed');
    }
    state = await reopened.mutate(state.revision, { kind: 'create', account: await f.sdk.derive(1, 'Restored') }, current);
    assert.equal(state.accounts.find((account) => account.index === 1)?.address, derived(1).address);
    assert.equal(await retained.validate(store.session), 70);
  } finally { await f.cleanup(); }
});

test('a losing catalogue CAS preserves the winning account edit and retained signed record', async () => {
  const f = await fixture();
  try {
    const store = await signedStore(f);
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let state = await catalogue.reconcile(f.identity, current);
    state = await catalogue.mutate(state.revision, { kind: 'create', account: await f.sdk.derive(1, 'Savings') }, current);
    state = await catalogue.mutate(state.revision, { kind: 'select', id: 'hd:60:0' }, current);
    const signer = new Wallet('0x' + '3'.padStart(64, '0'));
    const raw = await signer.signTransaction({ type: 2, chainId: 1, nonce: 0, to: ADDRESS, value: 1, gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 });
    const signed = await store.view(signer.address, 1).saveSigned(raw);
    const profile = await store.session.keyring.getPrivateRecordProfileId();
    const before = await f.storage.signedRecords.read(profile);
    const winner = new NativeWalletCatalogue(f.storage.keyringStorage);
    await winner.reconcile(f.identity, current);
    let raced = false;
    const port = { ...f.storage.keyringStorage,
      async compareAndSet(...args: Parameters<typeof f.storage.keyringStorage.compareAndSet>) {
        if (!raced) { raced = true; await winner.mutate(state.revision, { kind: 'rename', id: 'hd:60:0', label: 'Concurrent label' }, current); }
        return f.storage.keyringStorage.compareAndSet(...args);
      } };
    const loser = new NativeWalletCatalogue(port);
    await loser.reconcile(f.identity, current);
    await assert.rejects(loser.mutate(state.revision, { kind: 'remove', id: 'hd:60:1' }, current), /CATALOGUE_CONTEXT_CHANGED/);
    const saved = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as any;
    assert.equal(Object.keys(saved.groups[0].accounts.HDAccount).length, 2);
    assert.equal(saved.groups[0].accounts.HDAccount[0].label, 'Concurrent label');
    assert.equal(await f.storage.signedRecords.read(profile), before);
    assert.equal((await store.records.readExact(store.session, '1', signer.address, signed.hash))!.rawTransaction, raw);
  } finally { await f.cleanup(); }
});

test('complete account maps preserve more than twenty entries and sparse SDK indices',async()=>{
 const f=await fixture();try{
  let catalogue=new NativeWalletCatalogue(f.storage.keyringStorage);let state=await catalogue.reconcile(f.identity,current);
  for(let index=1;index<=21;index++)state=await catalogue.mutate(state.revision,{kind:'create',account:await f.sdk.derive(index)},current);
  assert.equal(state.accounts.length,22);
  state=await catalogue.mutate(state.revision,{kind:'create',account:await f.sdk.derive(4096)},current);
  const before=await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
  await f.reopen();catalogue=new NativeWalletCatalogue(f.storage.keyringStorage);state=await catalogue.reconcile(f.identity,current);
  assert.equal(state.accounts.find(account=>account.index===4096)!.address,derived(4096).address);
  const invalid={...await f.sdk.derive(22),id:Number.MAX_SAFE_INTEGER+1};
  await assert.rejects(catalogue.mutate(state.revision,{kind:'create',account:invalid},current));
  assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY),before);
 }finally{await f.cleanup();}
});

test('one canonical catalogue shape rejects incomplete development formats without writes', async () => {
  const f = await fixture();
  try {
    await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current);
    const original = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as Record<string, any>;
    const missing = { ...original }; delete missing.groups;
    for (const row of [{ ...original, version: 2 }, missing, { ...original, networks: [{ ...original.networks[0], rpcUrl: 'https://changed.example' }] }]) {
      await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, row);
      await assert.rejects(new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current), invalidCatalogue);
      assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), row);
    }
  } finally { await f.cleanup(); }
});

test('custom registration survives reopen, explicit edits and removal without default rewriting', async () => {
  const f = await fixture();
  try {
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let state = await catalogue.reconcile(f.identity, current);
    const custom = createNativeNetwork({ id: 'custom:421614', name: 'Custom test network', kind: 'evm', chainId: '421614', rpcUrl: 'https://rpc.example/custom', slip44: 60, symbol: 'GAS', decimals: 18, testnet: true });
    state = await catalogue.mutate(state.revision, { kind: 'save-network', registration: custom }, current);
    state = await catalogue.mutate(state.revision, { kind: 'select-network', id: custom.id }, current);
    assert.deepEqual({...state.networks.find((network) => network.id === custom.id)!}, {...custom});
    const row = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    await f.reopen();
    const reopened = new NativeWalletCatalogue(f.storage.keyringStorage);
    state = await reopened.reconcile(f.identity, current);
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), row);
    assert.equal(state.active.networkId, custom.id);
    await assert.rejects(reopened.mutate(state.revision, { kind: 'remove-network', id: custom.id }, current));
    state = await reopened.mutate(state.revision, { kind: 'select-network', id: 'ethereum' }, current);
    state = await reopened.mutate(state.revision, { kind: 'remove-network', id: custom.id }, current);
    assert.equal(state.networks.some((network) => network.id === custom.id), false);
  } finally { await f.cleanup(); }
});

test('padded network text and 32-character symbol survive real storage and cold reopen without weakening its byte limit', async () => {
  const f = await fixture();
  try {
    let catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let state = await catalogue.reconcile(f.identity, current);
    const registration = createNativeNetwork({ id: 'custom:31337', name: `  ${'Long network '.repeat(8)}  `,
      symbol: ` ${'x'.repeat(32)} `, kind: 'evm', chainId: '31337', rpcUrl: 'https://rpc.example/long', slip44: 60, decimals: 18, testnet: true });
    state = await catalogue.mutate(state.revision, { kind: 'save-network', registration }, current);
    const before = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    await f.reopen();
    catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    state = await catalogue.reconcile(f.identity, current);
    assert.deepEqual(state.networks.find((network) => network.id === registration.id), registration);
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), before);
    const oversized = createNativeNetwork({ ...registration, name: 'N'.repeat(4 * 1024 * 1024) });
    await assert.rejects(catalogue.mutate(state.revision, { kind: 'save-network', registration: oversized }, current));
    assert.deepEqual(await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY), before);
  } finally { await f.cleanup(); }
});

test('network selection preserves HD identity and counters while stale writers cannot replace it', async () => {
  const f = await fixture();
  try {
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    const start = await catalogue.reconcile(f.identity, current);
    const next = await catalogue.mutate(start.revision, { kind: 'select-network', id: 'rollux' }, current);
    assert.deepEqual(next.accounts, start.accounts);
    assert.equal(Object.keys(catalogue.privateRecords.groups[0]!.accounts.HDAccount).length, 1);
    assert.equal(next.active.networkId, 'rollux');
    await assert.rejects(catalogue.mutate(start.revision, { kind: 'select-network', id: 'base' }, current), /CATALOGUE_CONTEXT_CHANGED/);
    await f.reopen();
    assert.equal((await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current)).active.networkId, 'rollux');
  } finally { await f.cleanup(); }
});


test('catalogue removal retains signed records from every chain without owning the runtime pending guard', async () => {
  const f = await fixture();
  try {
    const store = await signedStore(f);
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let state = await catalogue.reconcile(f.identity, current);
    state = await catalogue.mutate(state.revision, { kind: 'create', account: await f.sdk.derive(1, 'Savings') }, current);
    state = await catalogue.mutate(state.revision, { kind: 'select', id: 'hd:60:0' }, current);
    const signer = new Wallet('0x' + '3'.padStart(64, '0'));
    const raw = await signer.signTransaction({ type: 2, chainId: 1, nonce: 0, to: ADDRESS, value: 1, gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 });
    const first = await store.view(signer.address, 1).saveSigned(raw);
    await store.records.updatePhase(store.session, '1', signer.address, first.hash, 'nonce-consumed');
    const baseRaw = await signer.signTransaction({ type: 2, chainId: 8453, nonce: 0, to: ADDRESS, value: 1, gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 });
    const second = await store.view(signer.address, 1, getNativeNetwork('base')).saveSigned(baseRaw);
    const profile = await store.session.keyring.getPrivateRecordProfileId();
    const encoded = await f.storage.signedRecords.read(profile);
    state = await catalogue.mutate(state.revision, { kind: 'remove', id: 'hd:60:1' }, current);
    assert.equal(state.accounts.length, 1);
    assert.equal(await f.storage.signedRecords.read(profile), encoded);
    assert.equal((await store.records.readExact(store.session, '1', signer.address, first.hash))!.rawTransaction, raw);
    assert.equal((await store.records.readExact(store.session, '8453', signer.address, second.hash))!.rawTransaction, baseRaw);
    assert.equal((await store.records.readExact(store.session, '8453', signer.address, second.hash))!.phase, 'signed');
  } finally { await f.cleanup(); }
});

test('same-chain RPC/name edits preserve wire bytes, signer identity, tokens and archived history', async () => {
  const f = await fixture();
  try {
    const { NativeTokenRegistry } = await import('../src/portfolio/tokenRegistry.ts');
    const { createActivityScope } = await import('../src/activity/types.ts');
    const store = await signedStore(f);
    const catalogue = new NativeWalletCatalogue(f.storage.keyringStorage);
    let state = await catalogue.reconcile(f.identity, current);
    const before = getNativeNetwork('ethereum', state.networks);
    const signer = new Wallet('0x' + '1'.padStart(64, '0'));
    const owner = { walletFingerprint: f.identity.walletFingerprint, address: signer.address, chainId: '1' };
    const history = new NativeActivityHistory(f.storage.keyringStorage);
    const originalView = store.view(signer.address, 0, before);
    const previousRaw = await signer.signTransaction({ type: 2, chainId: 1, nonce: 0, to: '0x1111111111111111111111111111111111111111', value: 2n, gasLimit: 25200n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
    const previous = await originalView.saveSigned(previousRaw);
    await originalView.transition(previous.hash, 'confirmed');
    const previousActivity = (await originalView.activities()).records[0];
    assert.ok(previousActivity?.recipient);
    await history.archiveTerminal({ ...previousActivity, recipient: previousActivity.recipient, phase: 'confirmed' }, current);
    const previousHistory = await history.load(createActivityScope(owner.walletFingerprint, 'hd:60:0', owner.address, before), current);
    const raw = await signer.signTransaction({ type: 2, chainId: 1, nonce: 1, to: '0x1111111111111111111111111111111111111111', value: 1n, gasLimit: 25200n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
    const pending = await originalView.saveSigned(raw); await originalView.transition(pending.hash, 'attempted');
    const original = await store.records.readExact(store.session, '1', signer.address, pending.hash);
    const tokens = new NativeTokenRegistry(f.storage.keyringStorage);
    const scope = { ...owner, accountId: 'hd:60:0', network: before.id, registrationHash: before.registrationHash };
    const token = { contractAddress: '0x2222222222222222222222222222222222222222', name: 'Token', symbol: 'T', decimals: 6 };
    await tokens.add(scope, 0, token, current);
    const profile = await store.session.keyring.getPrivateRecordProfileId();
    const encoded = await f.storage.signedRecords.read(profile);
    const edited = createNativeNetwork({ ...before, name: 'Ethereum custom provider', rpcUrl: 'https://other.example/rpc' });
    state = await catalogue.mutate(state.revision, { kind: 'save-network', registration: edited }, current);
    const changed = store.view(signer.address, 0, edited);
    assert.equal((await changed.load())!.rawTransaction, raw);
    assert.equal(await f.storage.signedRecords.read(profile), encoded);
    assert.deepEqual(await store.records.readExact(store.session, '1', signer.address, pending.hash), original);
    assert.deepEqual(original!.signer, { id: 0, type: 'HDAccount' });
    assert.equal(original!.chainId, '1'); assert.equal(original!.from, signer.address.toLowerCase());
    assert.deepEqual((await tokens.load({ ...scope, registrationHash: edited.registrationHash }, current)).items, [token]);
    assert.deepEqual(await history.load(createActivityScope(owner.walletFingerprint, 'hd:60:0', owner.address, edited), current), previousHistory);
    await changed.transition(pending.hash, 'confirmed');
    const activity = (await changed.activities()).records.at(-1);
    assert.ok(activity?.recipient); assert.equal(activity.phase, 'confirmed');
    await history.archiveTerminal({ ...activity, recipient: activity.recipient, phase: 'confirmed' }, current);
    assert.deepEqual(new Set((await history.load(createActivityScope(owner.walletFingerprint, 'hd:60:0', owner.address, edited), current)).archived.map((row) => row.hash)), new Set([previous.hash, pending.hash]));
    await f.reopen();
    await new NativeWalletCatalogue(f.storage.keyringStorage).reconcile(f.identity, current);
    const retained = new EvmSignedRecords(f.storage.signedRecords);
    const reopened = createNativeSignedRecordView(retained, store.session, f.identity.walletFingerprint, { index: 0, type: 'HDAccount', address: signer.address }, edited);
    assert.equal((await reopened.load())!.rawTransaction, raw);
    assert.deepEqual((await retained.readExact(store.session, '1', signer.address, pending.hash))!.signer, original!.signer);
  } finally { await f.cleanup(); }
});
